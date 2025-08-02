// PlayerSession service: single source of truth for per-guild playback queue with persistence
// Uses collection "music_queues" to snapshot queue state and lightweight session metadata.
// Integrates with Moonlink player to ensure consistent enqueue/dequeue and resume strategies.

import { createMusicSettings } from "./musicSettings.js";
import { normalizeTrack } from "../utils/trackFactory.js";

const QUEUE_COLLECTION = "music_queues";

export class PlayerSession {
  constructor(ctx, moonlink, guildId) {
    this.ctx = ctx;
    this.logger = ctx.logger;
    this.mongo = ctx.mongo;
    this.moonlink = moonlink;
    this.guildId = guildId;

    this.settings = createMusicSettings(ctx);

    // In-memory working state (authoritative while process is alive)
    this.queue = []; // list of normalized tracks
    this.current = null; // normalized current track
    this.textChannelId = null;
    this.voiceChannelId = null;

    // Debounced persist control
    this._persistTimer = null;
    this._dirty = false;
  }

  // Mongo helpers
  async _col() {
    try {
      return await this.mongo.getCollection(QUEUE_COLLECTION);
    } catch (e) {
      this.logger?.warn?.("[PlayerSession] getCollection failed", { error: e?.message });
      return null;
    }
  }

  _markDirty() {
    this._dirty = true;
    if (this._persistTimer) clearTimeout(this._persistTimer);
    // Persist after a short delay to batch operations
    this._persistTimer = setTimeout(() => this.persist().catch(() => {}), 500);
  }

  // Load snapshot from DB into memory
  async load() {
    const col = await this._col();
    if (!col) return false;

    const doc = await col.findOne({ guildId: this.guildId });
    if (!doc) return false;

    try {
      this.queue = Array.isArray(doc.queue) ? doc.queue : [];
      this.current = doc.current || null;
      this.textChannelId = doc.textChannelId || null;
      this.voiceChannelId = doc.voiceChannelId || null;
      return true;
    } catch (e) {
      this.logger?.warn?.("[PlayerSession] load parse error", { error: e?.message });
      return false;
    }
  }

  // Persist snapshot to DB
  async persist() {
    if (!this._dirty) return true;
    const col = await this._col();
    if (!col) return false;

    const doc = {
      guildId: this.guildId,
      queue: this.queue,
      current: this.current,
      textChannelId: this.textChannelId,
      voiceChannelId: this.voiceChannelId,
      updatedAt: new Date()
    };

    try {
      await col.updateOne({ guildId: this.guildId }, { $set: doc }, { upsert: true });
      this._dirty = false;
      return true;
    } catch (e) {
      this.logger?.warn?.("[PlayerSession] persist failed", { error: e?.message });
      return false;
    }
  }

  // Ensure a Moonlink player exists and is connected
  async _ensurePlayer({ voiceChannelId, textChannelId } = {}) {
    let player = this.moonlink.players.get(this.guildId);
    if (!player) {
      player = this.moonlink.players.create({
        guildId: this.guildId,
        voiceChannelId: String(voiceChannelId || this.voiceChannelId || ""),
        textChannelId: String(textChannelId || this.textChannelId || ""),
        volume: await this.settings.getVolume(this.guildId).catch(() => 20)
      });
      try {
        if (typeof player.connect === "function") await player.connect();
        else if (typeof player.updateVoiceState === "function") await player.updateVoiceState({ voiceChannelId: String(voiceChannelId || this.voiceChannelId) });
      } catch (e) {
        this.logger?.warn?.("[PlayerSession] player connect failed", { error: e?.message });
      }
    }
    return player;
  }

  // Public API

  setChannels({ voiceChannelId, textChannelId }) {
    if (voiceChannelId) this.voiceChannelId = String(voiceChannelId);
    if (textChannelId) this.textChannelId = String(textChannelId);
    this._markDirty();
  }

  getQueue() {
    return this.queue.slice();
  }

  getCurrent() {
    return this.current;
  }

  getLength() {
    return this.queue.length;
  }

  clear() {
    this.queue = [];
    this._markDirty();
  }

  shuffle() {
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    this._markDirty();
  }

  removeAt(index) {
    if (index >= 0 && index < this.queue.length) {
      this.queue.splice(index, 1);
      this._markDirty();
      return true;
    }
    return false;
  }

  move(from, to) {
    if (from === to) return true;
    if (from < 0 || from >= this.queue.length) return false;
    if (to < 0 || to >= this.queue.length) return false;
    const [item] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, item);
    this._markDirty();
    return true;
  }

  enqueue(rawTrack, { requesterId } = {}) {
    const maxQueuePromise = this.settings.getMaxQueue(this.guildId).catch(() => 500);
    const t = normalizeTrack(rawTrack, { requesterId });
    if (!t) return { ok: false, reason: "invalid_track" };
    return Promise.resolve(maxQueuePromise).then((limit) => {
      const cap = Number(limit) || 500;
      if (this.queue.length >= cap) return { ok: false, reason: "queue_limit" };
      this.queue.push(t);
      this._markDirty();
      return { ok: true, track: t };
    });
  }

  insertAt(index, rawTrack, { requesterId } = {}) {
    const t = normalizeTrack(rawTrack, { requesterId });
    if (!t) return { ok: false, reason: "invalid_track" };
    const clamped = Math.max(0, Math.min(index, this.queue.length));
    this.queue.splice(clamped, 0, t);
    this._markDirty();
    return { ok: true, track: t };
  }

  // Start playback if idle, otherwise just enqueue; returns action taken
  async playOrQueue(rawTrack, requesterId) {
    const add = await this.enqueue(rawTrack, { requesterId });
    if (!add.ok) return add;

    // Ensure channels are known to avoid starting without a target
    if (!this.voiceChannelId || !this.textChannelId) {
      return { ok: false, reason: "missing_channels" };
    }

    const player = await this._ensurePlayer({});
    // Ensure sane defaults prior to playback
    try {
      if (typeof player.setAutoPlay === "function") player.setAutoPlay(true);
      else player.autoPlay = true;
    } catch {}
    try {
      if (typeof player.setVolume === "function") {
        const vol = await this.settings.getVolume(this.guildId).catch(() => 20);
        await player.setVolume(Number.isFinite(vol) ? vol : 20);
      }
    } catch {}

    if (!player.playing) {
      try {
        this.current = add.track;
        this._markDirty();
        await player.play(add.track._raw || add.track);
        return { ok: true, started: true, track: add.track };
      } catch (e) {
        return { ok: false, reason: "play_failed", error: e };
      }
    }
    return { ok: true, started: false, track: add.track };
  }

  async skip() {
    const player = this.moonlink.players.get(this.guildId);
    if (!player) return { ok: false, reason: "no_player" };

    // Remove current (index 0) then play next if exists
    if (this.queue.length > 0) this.queue.shift();
    else this.current = null;
    this._markDirty();

    if (this.queue.length > 0) {
      const next = this.queue[0];
      try {
        this.current = next;
        this._markDirty();
        await this._ensurePlayer({});
        await player.play(next._raw || next);
        return { ok: true, ended: false, now: next };
      } catch (e) {
        return { ok: false, reason: "play_failed", error: e };
      }
    }

    // Nothing queued; respect autoplay setting on the player (Moonlink auto behavior)
    if (player?.autoPlay === true) {
      try {
        if (typeof player.skip === "function") await player.skip();
        else if (typeof player.stop === "function") await player.stop();
      } catch {}
      return { ok: true, ended: false, now: null, note: "autoplay_continues" };
    }

    try { player.destroy?.(); } catch {}
    this.current = null;
    this._markDirty();
    return { ok: true, ended: true, now: null };
  }

  // For use on trackEnd event to continue playback
  async onTrackEnd() {
    if (this.queue.length > 0) this.queue.shift();
    this._markDirty();

    const player = this.moonlink.players.get(this.guildId);
    if (this.queue.length > 0) {
      const next = this.queue[0];
      try {
        this.current = next;
        this._markDirty();
        await player.play(next._raw || next);
        return true;
      } catch (e) {
        this.logger?.warn?.("[PlayerSession] onTrackEnd play next failed", { error: e?.message });
        return false;
      }
    }
    // No next; let autoplay handle if enabled; otherwise caller can destroy or inactivity service will clean up
    return false;
  }
}

// Factory/registry for sessions per guild
export class PlayerSessionRegistry {
  constructor(ctx, moonlink) {
    this.ctx = ctx;
    this.moonlink = moonlink;
    this.map = new Map(); // guildId -> PlayerSession
  }

  get(guildId) {
    let s = this.map.get(guildId);
    if (!s) {
      s = new PlayerSession(this.ctx, this.moonlink, guildId);
      this.map.set(guildId, s);
    }
    return s;
  }

  delete(guildId) {
    this.map.delete(guildId);
  }
}

export async function createPlayerSessionRegistry(ctx, moonlink) {
  return new PlayerSessionRegistry(ctx, moonlink);
}
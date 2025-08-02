// MusicSettings service: centralizes per-guild music settings with caching and Mongo persistence
// Collection name aligned with existing usage: "music_guild_settings"

const DEFAULTS = {
  volume: 20,
  autoplay: true,
  loop: "off", // "off" | "track" | "queue"
  inactivityTimeoutMs: 300000, // 5 minutes
  maxQueue: 500,
  djRoleId: null,
  announceChannelId: null
};

export class MusicSettings {
  constructor(ctx) {
    this.ctx = ctx;
    this.logger = ctx.logger;
    this.mongo = ctx.mongo;
    this.cache = new Map(); // guildId -> settings
    this.collectionName = "music_guild_settings";
  }

  async _col() {
    try {
      return await this.mongo.getCollection(this.collectionName);
    } catch (e) {
      this.logger?.warn?.("[MusicSettings] getCollection failed", { error: e?.message });
      return null;
    }
  }

  _applyDefaults(raw = {}) {
    return {
      guildId: raw.guildId,
      volume: typeof raw.volume === "number" ? raw.volume : DEFAULTS.volume,
      autoplay: typeof raw.autoplay === "boolean" ? raw.autoplay : DEFAULTS.autoplay,
      loop: ["off", "track", "queue"].includes(raw.loop) ? raw.loop : DEFAULTS.loop,
      inactivityTimeoutMs: Number.isFinite(raw.inactivityTimeoutMs) ? raw.inactivityTimeoutMs : DEFAULTS.inactivityTimeoutMs,
      maxQueue: Number.isFinite(raw.maxQueue) ? raw.maxQueue : DEFAULTS.maxQueue,
      djRoleId: raw.djRoleId ?? DEFAULTS.djRoleId,
      announceChannelId: raw.announceChannelId ?? DEFAULTS.announceChannelId,
      updatedAt: raw.updatedAt ? new Date(raw.updatedAt) : new Date()
    };
  }

  _cacheGet(guildId) {
    return this.cache.get(guildId);
  }

  _cacheSet(guildId, settings) {
    this.cache.set(guildId, settings);
  }

  async get(guildId) {
    const cached = this._cacheGet(guildId);
    if (cached) return cached;

    const col = await this._col();
    if (!col) {
      const def = this._applyDefaults({ guildId });
      this._cacheSet(guildId, def);
      return def;
    }

    const doc = await col.findOne({ guildId });
    const settings = this._applyDefaults({ guildId, ...(doc || {}) });
    this._cacheSet(guildId, settings);
    return settings;
  }

  async set(guildId, partial) {
    const col = await this._col();
    const patch = { ...partial, updatedAt: new Date() };

    if (!col) {
      // No DB available; update cache only
      const merged = this._applyDefaults({ guildId, ...(this._cacheGet(guildId) || {}), ...patch });
      this._cacheSet(guildId, merged);
      return merged;
    }

    await col.updateOne({ guildId }, { $set: { guildId, ...patch } }, { upsert: true });
    const fresh = this._applyDefaults({ guildId, ...(this._cacheGet(guildId) || {}), ...patch });
    this._cacheSet(guildId, fresh);
    return fresh;
  }

  // Convenience getters/setters
  async getVolume(guildId) { return (await this.get(guildId)).volume; }
  async setVolume(guildId, volume) { return this.set(guildId, { volume: Math.max(1, Math.min(100, Number(volume) || DEFAULTS.volume)) }); }

  async getAutoplay(guildId) { return (await this.get(guildId)).autoplay; }
  async setAutoplay(guildId, autoplay) { return this.set(guildId, { autoplay: Boolean(autoplay) }); }

  async getLoop(guildId) { return (await this.get(guildId)).loop; }
  async setLoop(guildId, loop) {
    const value = ["off", "track", "queue"].includes(loop) ? loop : "off";
    return this.set(guildId, { loop: value });
  }

  async getInactivityTimeoutMs(guildId) { return (await this.get(guildId)).inactivityTimeoutMs; }
  async setInactivityTimeoutMs(guildId, ms) {
    const n = Number(ms);
    return this.set(guildId, { inactivityTimeoutMs: Number.isFinite(n) ? Math.max(60000, n) : DEFAULTS.inactivityTimeoutMs });
  }

  async getMaxQueue(guildId) { return (await this.get(guildId)).maxQueue; }
  async setMaxQueue(guildId, n) {
    const v = Number(n);
    return this.set(guildId, { maxQueue: Number.isFinite(v) ? Math.max(1, v) : DEFAULTS.maxQueue });
  }

  async getDjRoleId(guildId) { return (await this.get(guildId)).djRoleId; }
  async setDjRoleId(guildId, roleId) { return this.set(guildId, { djRoleId: roleId || null }); }

  async getAnnounceChannelId(guildId) { return (await this.get(guildId)).announceChannelId; }
  async setAnnounceChannelId(guildId, channelId) { return this.set(guildId, { announceChannelId: channelId || null }); }
}

// Factory for convenience in module initialization
export function createMusicSettings(ctx) {
  return new MusicSettings(ctx);
}
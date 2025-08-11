
import { Collection } from 'discord.js';

/**
 * Manages the music queue for a single guild.
 */
class GuildQueue {
  constructor(ctx, guildId) {
    this.ctx = ctx;
    this.guildId = guildId;
    this.tracks = [];
    this.isPlaying = false;
    this.nowPlayingMessage = null;
    this.volume = 100;
    this.textChannelId = null; // Add this line
  this.lastStartAt = 0; // timestamp of last player 'start' event
  }

  /**
   * Adds tracks to the queue.
   * @param {import('shoukaku').Track[]} tracks - The tracks to add.
   * @param {import('discord.js').User} requestedBy - The user who requested the tracks.
   */
  add(tracks, requestedBy) {
    for (const track of tracks) {
      this.tracks.push({ track, requestedBy });
    }
  }

  /**
   * Gets the next track in the queue.
   * @returns {{track: import('shoukaku').Track, requestedBy: import('discord.js').User} | null}
   */
  next() {
    return this.tracks.shift() || null;
  }

  /**
   * Clears the entire queue.
   */
  clear() {
    this.tracks = [];
  }

  /**
   * Gets the current queue.
   * @returns {{track: import('shoukaku').Track, requestedBy: import('discord.js').User}[]}
   */
  getQueue() {
    return this.tracks;
  }
  
  /**
   * Shuffles the queue.
   */
  shuffle() {
    for (let i = this.tracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
  }
}

/**
 * Manages all guild queues.
 */
export class QueueManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.queues = new Collection();
  }

  /**
   * Gets or creates a queue for a guild.
   * @param {string} guildId - The ID of the guild.
   * @returns {GuildQueue}
   */
  get(guildId) {
    if (!this.queues.has(guildId)) {
      this.queues.set(guildId, new GuildQueue(this.ctx, guildId));
    }
    return this.queues.get(guildId);
  }

  /**
   * Deletes a queue for a guild.
   * @param {string} guildId - The ID of the guild.
   */
  destroy(guildId) {
    return this.queues.delete(guildId);
  }
}

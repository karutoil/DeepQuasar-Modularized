/**
 * Cooldown and rate limit service for TempVC.
 * Provides per-user cooldown checks for VC creation to prevent spam.
 */
import { repo } from "./repository.js";

export function cooldownService(ctx) {
  const { logger } = ctx;
  // In-memory cooldowns: key = guildId:userId -> expiresAt
  const map = new Map();

  function key(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  function now() {
    return Date.now();
  }

  return {
    /**
     * Check whether a user is currently under cooldown.
     * Returns remaining milliseconds if cooling down, or 0 if allowed.
     */
    check(guildId, userId) {
      const k = key(guildId, userId);
      const exp = map.get(k);
      const diff = (exp || 0) - now();
      return diff > 0 ? diff : 0;
    },

    /**
     * Start a cooldown for a user. Duration in ms.
     */
    start(guildId, userId, durationMs) {
      if (!durationMs || durationMs <= 0) return;
      const k = key(guildId, userId);
      map.set(k, now() + durationMs);
    },

    /**
     * Clear any cooldown for a user.
     */
    clear(guildId, userId) {
      map.delete(key(guildId, userId));
    },
  };
}
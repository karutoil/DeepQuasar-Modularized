/**
 * State service: in-memory cache + write-through persistence for TempVC presence and lastActiveAt.
 * Provides lightweight helpers to snapshot presence and update activity, designed to be called
 * from voice events and command handlers. Keeps cache per channel with TTL to reduce DB calls.
 */
import { repo } from "./repository.js";

export function stateService(ctx) {
  const { client, logger } = ctx;
  const { collections } = repo(ctx);

  // In-memory cache: channelId -> { memberIds: string[], lastSnapshotAt: number }
  const cache = new Map();
  const TTL_MS = 15_000; // 15s snapshot TTL

  function setCache(channelId, memberIds) {
    cache.set(channelId, { memberIds, lastSnapshotAt: Date.now() });
  }

  function getCache(channelId) {
    const entry = cache.get(channelId);
    if (!entry) return null;
    if (Date.now() - entry.lastSnapshotAt > TTL_MS) {
      cache.delete(channelId);
      return null;
    }
    return entry.memberIds;
  }

  async function fetchMembers(channelId) {
    try {
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (!ch || !("members" in ch)) return [];
      return Array.from(ch.members.keys());
    } catch (e) {
      logger.warn("[TempVC] stateService.fetchMembers error", { channelId, error: e?.message });
      return [];
    }
  }

  return {
    /**
     * Snapshot presence for a voice channel, using cache TTL to avoid thrashing.
     * Persists to tempvc_channels.presence and updates lastActiveAt.
     */
    async snapshotPresence(channelId, { force = false } = {}) {
      let memberIds = getCache(channelId);
      if (!memberIds || force) {
        memberIds = await fetchMembers(channelId);
        setCache(channelId, memberIds);
      }
      const chCol = await collections.channels();
      await chCol.updateOne(
        { _id: channelId },
        { $set: { "presence.memberIds": memberIds, "presence.lastSnapshotAt": new Date(), lastActiveAt: new Date() } }
      );
      return memberIds;
    },

    /**
     * Mark activity on a channel without a full presence fetch.
     */
    async touch(channelId) {
      const chCol = await collections.channels();
      await chCol.updateOne(
        { _id: channelId },
        { $set: { lastActiveAt: new Date() } }
      );
    },

    /**
     * Clear memory cache for a channel (e.g., on deletion).
     */
    invalidate(channelId) {
      cache.delete(channelId);
    },
  };
}
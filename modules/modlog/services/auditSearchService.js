import { Collection } from "discord.js";
import { clamp, matchesReason, matchesTimeRange, matchesUsers, matchesObjects } from "../utils/filters.js";

/**
 * Search audit logs with server-side narrowing when possible, then client-side filters.
 * Supports ALL events by iterating windows. Applies caps and pagination.
 */
export async function searchAuditLogs(ctx, guild, filters) {
  const { logger, config } = ctx;
  const {
    type, executorId, targetId,
    channelId, roleId, emojiId, webhookId, integrationId,
    since, until, reasonContains,
    page, pageSize
  } = filters;

  const maxFetch = Number(config.get?.("MODLOG_MAX_FETCH", 300));
  const desired = clamp(pageSize, 1, 25);

  let fetchedCount = 0;
  let before = undefined;
  const collected = [];

  logger.debug("[ModLog] searchAuditLogs start", {
    guildId: guild?.id,
    type,
    executorId,
    targetId,
    since: since ? since.toISOString?.() : null,
    until: until ? until.toISOString?.() : null,
    page,
    pageSize,
    maxFetch
  });

  // When type is provided, we can narrow via API. When null => iterate all types windowed.
  // discord.js fetchAuditLogs supports options: { type, limit, before }
  while (fetchedCount < maxFetch) {
    try {
      // fetch in chunks (Discord allows up to 100; choose 100 for efficiency)
      const limit = Math.min(100, maxFetch - fetchedCount);
      const options = { limit };
      if (type != null) options.type = type;
      if (before) options.before = before;

      logger.debug("[ModLog] fetchAuditLogs call", { options });

      const logs = await guild.fetchAuditLogs(options);
      const entries = logs?.entries || new Collection();

      logger.debug("[ModLog] fetchAuditLogs result", { batch: entries.size });

      if (!entries.size) break;

      // Update cursor: entries are ordered by creation time desc; set before to smallest id seen
      const ids = [...entries.keys()];
      before = ids[ids.length - 1];

      for (const entry of entries.values()) {
        fetchedCount++;

        // Time range filter first to prune quickly
        if (!matchesTimeRange(entry, since, until)) continue;
        // Users
        if (!matchesUsers(entry, executorId, targetId)) continue;
        // Objects
        if (!matchesObjects(entry, { channelId, roleId, emojiId, webhookId, integrationId })) continue;
        // Reason contains
        if (!matchesReason(entry, reasonContains)) continue;

        collected.push(entry);
      }

      // Stop early if oldest fetched entry is older than 'since' and type narrowing is on
      if (since && entries.size > 0) {
        const last = entries.at(entries.size - 1);
        if (last?.createdAt && last.createdAt.getTime() < since.getTime()) {
          logger.debug("[ModLog] early stop: last older than since");
          break;
        }
      }

      // If we got fewer than limit, likely exhausted
      if (entries.size < limit) {
        logger.debug("[ModLog] pagination exhausted");
        break;
      }
    } catch (e) {
      logger.warn("[ModLog] fetchAuditLogs error; stopping pagination", { error: e?.message || e });
      break;
    }
  }

  // Sort ascending by time for stable pagination in UI
  collected.sort((a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0));

  const total = collected.length;
  const totalPages = Math.max(1, Math.ceil(total / desired));
  const safePage = clamp(page, 1, totalPages);
  const start = (safePage - 1) * desired;
  const end = Math.min(total, start + desired);
  const items = collected.slice(start, end);

  logger.debug("[ModLog] searchAuditLogs done", { total, totalPages, safePage, start, end, itemsCount: items.length });

  return {
    items,
    meta: {
      total,
      page: safePage,
      pageSize: desired,
      totalPages,
      type
    }
  };
}
/**
 * Integrity and cleanup service for Temporary Voice Channels.
 * - Startup scan and summary
 * - Hourly integrity reconciliation (permissions, ownership, orphan cleanup)
 * - Idle checks and scheduled deletions
 * - Downtime metrics and restart log
 */
import { repo } from "./repository.js";
import { settingsService } from "./settingsService.js";

export function integrityService(ctx) {
  const { client, logger } = ctx;
  const { collections } = repo(ctx);
  const settings = settingsService(ctx);

  async function listGuildVoiceChannels(guildId) {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return [];
    await guild.channels.fetch().catch(() => null);
    return guild.channels.cache.filter((c) => c?.type === 2 /* GuildVoice */).map((c) => c);
  }

  // Respect idle threshold only (no grace period) when deciding deletions
  function shouldDeleteByIdle(doc, now, idleTimeoutSec) {
    if (!idleTimeoutSec || idleTimeoutSec <= 0) return false;
    const last = doc.lastActiveAt ? new Date(doc.lastActiveAt).getTime() : new Date(doc.createdAt).getTime();
    const idleMs = idleTimeoutSec * 1000;
    return now - last >= idleMs;
  }

  async function deleteChannelSafe(channelId, reason) {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel && channel.deletable) {
        await channel.delete(reason).catch(() => null);
      }
    } catch (e) {
      logger.warn("[TempVC] deleteChannelSafe error", { channelId, error: e?.message });
    }
  }

  async function reconcilePermissions(guildId, channel, doc, guildSettings) {
    // Placeholder: compute overwrite diff from guildSettings.defaultPermissionsTemplate,
    // rolePermissionTemplates, and doc.state.locked/userLimit.
    // Apply only if drift detected or permsVersion mismatch.
    // This is a stub; real logic will live in services/channelService.js
    return;
  }

  async function reassessOwnership(guildId, channel, doc, guildSettings) {
    // Placeholder: if owner missing and users present, pick next eligible and update ownerId.
    // This is a stub; real logic will live in services/ownerService.js
    return;
  }

  async function cleanupOrphans(guildId, knownVoiceIds) {
    const cursor = await collections.find("channels", { guildId, deletedAt: { $in: [null, undefined] } });
    const active = await cursor.toArray();
    const activeIds = new Set(active.map((x) => x._id));
    const known = new Set(knownVoiceIds);
    const toDelete = [];
    for (const id of activeIds) {
      if (!known.has(id)) toDelete.push(id);
    }
    let cleaned = 0;
    for (const chId of toDelete) {
      const col = await collections.channels();
      await col.updateOne({ _id: chId }, { $set: { deletedAt: new Date() } });
      await deleteChannelSafe(chId, "TempVC: orphan cleanup");
      cleaned++;
    }
    return cleaned;
  }

  async function processScheduledDeletions() {
    const now = Date.now();
    const cursor = await collections.find("channels", {
      deletedAt: { $in: [null, undefined] },
      scheduledDeletionAt: { $ne: null, $lte: new Date(now) },
    });
    let count = 0;
    const chCol = await collections.channels();
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      await chCol.updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } });
      await deleteChannelSafe(doc._id, "TempVC: scheduled deletion");
      count++;
    }
    if (count) logger.info("[TempVC] Scheduled deletions processed", { count });
  }

  async function runIdleChecks() {
    // MongoDB Server API v1: distinct is not allowed with apiStrict:true.
    // Use aggregation as a compatible alternative.
    const aggCursor = await (await collections.find("channels", { deletedAt: { $in: [null, undefined] } }))
      .toArray()
      .then((docs) => Array.from(new Set(docs.map((d) => d.guildId))));
    const guildIds = aggCursor;
    const now = Date.now();

    for (const guildId of guildIds) {
      const conf = await settings.get(guildId);
      const idle = conf.idleTimeoutSec;
      const grace = conf.gracePeriodSec;

      const docs = await (await collections.find("channels", { guildId, deletedAt: { $in: [null, undefined] } })).toArray();
      for (const doc of docs) {
        try {
          // Fetch channel and current members
          const channel = await ctx.client.channels.fetch(doc._id).catch(() => null);
          const memberCount = channel?.members?.size || 0;

          // If empty: schedule deletion or immediate based on settings
          if (memberCount === 0) {
            if (shouldDeleteByIdle(doc, now, idle, grace)) {
              const chCol = await collections.channels();
              await chCol.updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } });
              await deleteChannelSafe(doc._id, "TempVC: idle timeout");
            } else {
              // set scheduledDeletionAt once when threshold crossed
              const last = doc.lastActiveAt ? new Date(doc.lastActiveAt).getTime() : new Date(doc.createdAt).getTime();
              const scheduledAt = last + idle * 1000 + grace * 1000;
              if (!doc.scheduledDeletionAt || new Date(doc.scheduledDeletionAt).getTime() !== scheduledAt) {
                const chCol = await collections.channels();
                await chCol.updateOne(
                  { _id: doc._id },
                  { $set: { scheduledDeletionAt: new Date(scheduledAt) } }
                );
              }
            }
          } else {
            // Has members: clear scheduled deletion marker
            if (doc.scheduledDeletionAt) {
              const chCol = await collections.channels();
              await chCol.updateOne(
                { _id: doc._id },
                { $unset: { scheduledDeletionAt: "" }, $set: { lastActiveAt: new Date() } }
              );
            }
          }
        } catch (e) {
          logger.warn("[TempVC] runIdleChecks error on channel", { channelId: doc?._id, error: e?.message });
        }
      }
    }
  }

  async function runHourlyIntegrityScan() {
    // MongoDB Server API v1: replace distinct with client-side unique set
    const docsForDistinct = await (await collections.find("channels", { deletedAt: { $in: [null, undefined] } })).toArray();
    const guildIds = Array.from(new Set(docsForDistinct.map((d) => d.guildId)));
    let totalReconciled = 0;
    let totalReassigned = 0;
    let totalCleaned = 0;

    for (const guildId of guildIds) {
      const conf = await settings.get(guildId);
      const voiceChannels = await listGuildVoiceChannels(guildId);
      const knownIds = [];
      for (const ch of voiceChannels) knownIds.push(ch.id);

      // Clean up orphans (records with no channel)
      totalCleaned += await cleanupOrphans(guildId, knownIds);

      // Reconcile all active temp VCs
      const docs = await (await collections.find("channels", { guildId, deletedAt: { $in: [null, undefined] } })).toArray();
      for (const doc of docs) {
        const channel = voiceChannels.find((c) => c.id === doc._id);
        if (!channel) continue;

        await reconcilePermissions(guildId, channel, doc, conf);
        totalReconciled++;

        await reassessOwnership(guildId, channel, doc, conf);
        // totalReassigned is updated in ownerService stub eventually
      }
    }

    if (totalReconciled || totalCleaned || totalReassigned) {
      logger.info("[TempVC] Hourly integrity scan summary", {
        reconciled: totalReconciled,
        reassigned: totalReassigned,
        cleanedOrphans: totalCleaned,
      });
    }
  }

  return {
    runIdleChecks,
    processScheduledDeletions,
    runHourlyIntegrityScan,
  };
}

/**
 * Perform startup integrity scan and downtime accounting.
 * Should be called from module postReady.
 */
export async function integrityStartupScan(ctx) {
  const { logger } = ctx;
  const { collections } = repo(ctx);
  const settings = settingsService(ctx);

  let recovered = 0;
  let cleaned = 0;
  let reassigned = 0;
  let deleted = 0;
  let inconsistenciesFound = 0;

  // Load all records (including those already marked deleted) so we can purge DB ghosts too
  // Previously we filtered to { deletedAt: null }, which missed records already soft-deleted.
  // We need to sweep both active and soft-deleted to ensure DB is consistent with Discord.
  const allDocs = await (await collections.find("channels", {})).toArray();
  const guildIds = Array.from(new Set(allDocs.map((d) => d.guildId)));

  logger.debug?.("[TempVC] Startup integrity scan: begin", { totalDocs: allDocs.length, guilds: guildIds.length });

  for (const guildId of guildIds) {
    const conf = await settings.get(guildId);

    // Load live voice channels
    const voiceChannels = await (async () => {
      try {
        const guild = ctx.client.guilds.cache.get(guildId) || await ctx.client.guilds.fetch(guildId);
        await guild.channels.fetch().catch(() => null);
        return guild.channels.cache.filter((c) => c?.type === 2).map((c) => c);
      } catch (e) {
        logger.warn("[TempVC] Startup scan: failed to load guild channels", { guildId, error: e?.message });
        return [];
      }
    })();

    const docs = allDocs.filter((d) => d.guildId === guildId);
    logger.debug?.("[TempVC] Startup integrity scan: guild", { guildId, candidates: docs.length, liveVoiceCount: voiceChannels.length });

    for (const doc of docs) {
      // Always re-fetch to avoid stale cache; prefer live fetch over cached map
      let ch = null;
      try { ch = await ctx.client.channels.fetch(doc._id); } catch (e) {
        logger.debug?.("[TempVC] Startup scan: fetch error", { channelId: doc._id, guildId, error: e?.message });
      }

      if (!ch) {
        // DB fallback: Hard-delete DB record if Discord channel does not exist or fetch failed
        try {
          const chCol = await collections.channels();
          await chCol.deleteOne({ _id: doc._id });
          cleaned++;
          logger.debug?.("[TempVC] Startup scan: DB record removed (channel missing)", { channelId: doc._id, guildId });
        } catch (dbErr) {
          logger.warn("[TempVC] Startup scan: DB delete failed for missing channel", { channelId: doc._id, guildId, error: dbErr?.message });
        }
        continue;
      }

      // If channel exists but is not a GuildVoice, remove the record
      if (String(ch.type) !== "2") {
        try {
          const chCol = await collections.channels();
          await chCol.deleteOne({ _id: doc._id });
          cleaned++;
          logger.debug?.("[TempVC] Startup scan: DB record removed (not a voice channel)", { channelId: doc._id, guildId, type: ch.type });
        } catch (dbErr) {
          logger.warn("[TempVC] Startup scan: DB delete failed for non-voice channel", { channelId: doc._id, guildId, error: dbErr?.message });
        }
        continue;
      }

      try {
        // Attempt to refresh the channel object for accurate member count
        try { await ch.fetch?.().catch(() => null); } catch {}
        const memberCount = ch?.members?.size || 0;
        logger.debug?.("[TempVC] Startup scan: channel state", { channelId: doc._id, guildId, memberCount });

        if (memberCount === 0) {
          // Immediate delete if empty on startup (ignore grace) — ensure Discord and DB are both cleaned
          let deletedDiscord = false;
          try {
            await ch.delete("TempVC: startup cleanup (empty)");
            deletedDiscord = true;
            logger.info("[TempVC] Startup scan: channel deleted (empty)", { channelId: doc._id, guildId });
          } catch (err) {
            logger.warn("[TempVC] Startup delete failed; trying overwrite+retry", { channelId: doc._id, guildId, error: err?.message });
            try {
              const me = ch.guild?.members?.me;
              if (me) {
                await ch.permissionOverwrites?.edit?.(me.id, { ManageChannels: true }).catch(() => null);
              }
              await ch.delete("TempVC: startup cleanup (empty, retry)");
              deletedDiscord = true;
              logger.info("[TempVC] Startup scan: channel deleted on retry", { channelId: doc._id, guildId });
            } catch (err2) {
              logger.warn("[TempVC] Startup delete second attempt failed", { channelId: doc._id, guildId, error: err2?.message });
            }
          }
          // Remove DB record unconditionally to avoid ghosts
          try {
            const chCol = await collections.channels();
            await chCol.deleteOne({ _id: doc._id });
            logger.debug?.("[TempVC] Startup scan: DB record removed (post-delete)", { channelId: doc._id, guildId, deletedDiscord });
          } catch (dbErr) {
            logger.warn("[TempVC] Startup DB delete failed", { channelId: doc._id, guildId, error: dbErr?.message });
          }
          deleted++;
          continue;
        }

        // Persist/refresh record for active channel (recovered)
        const chCol = await collections.channels();
        await chCol.updateOne({ _id: doc._id }, { $set: { lastActiveAt: new Date() } });
        recovered++;
        logger.debug?.("[TempVC] Startup scan: channel active, refreshed lastActiveAt", { channelId: doc._id, guildId, memberCount });
      } catch (e) {
        logger.warn("[TempVC] Startup reconcile error", { channelId: doc?._id, guildId, error: e?.message });
      }
    }

    // Restart log record
    try {
      await collections.insertOne("restartLog", {
        guildId,
        restartedAt: new Date(),
        downtimeMs: 0,
        summary: {
          recovered,
          cleaned,
          reassigned,
          deleted,
          inconsistenciesFound,
        },
        notes: [],
        createdAt: new Date(),
      });
    } catch (e) {
      logger.warn("[TempVC] Startup scan: failed to write restartLog", { guildId, error: e?.message });
    }
  }

  logger.info("[TempVC] Startup integrity scan completed", {
    recovered,
    cleaned,
    reassigned,
    deleted,
    inconsistenciesFound,
  });
}
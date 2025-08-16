import { createMongo } from '../../../core/mongo.js';

const COLLECTION = 'invite_leaderboard';

function getMongo(ctx) {
  const coreMongo = ctx?.core?.mongo || ctx?.mongo;
  if (coreMongo && typeof coreMongo.getDb === 'function') return coreMongo;
  const m = createMongo(ctx.config, ctx.logger);
  try { ctx.mongo = m; } catch (err) { void err; }
  return m;
}

async function getCollection(ctx) {
  const m = getMongo(ctx);
  const coll = await m.getCollection(COLLECTION);
  return coll;
}

export async function ensureIndexes(ctx) {
  try {
    const m = getMongo(ctx);
    const db = await m.getDb();
    if (!db) {
      ctx.logger?.warn?.('[InviteLeaderboard] Mongo not connected for ensureIndexes');
      return;
    }
    await db.collection(COLLECTION).createIndex({ guildId: 1 }, { unique: true });
  } catch (err) {
    ctx.logger?.warn?.('[InviteLeaderboard] ensureIndexes failed', { error: err?.message });
  }
}

/**
 * Build the baseline for a guild by fetching current invites and storing their uses.
 * If a document exists, we merge invites without resetting existing inviter counts.
 */
export async function initGuildBaseline(ctx, guild) {
  const logger = ctx.logger;
  if (!guild || !guild.id) return;
  const guildId = guild.id;
  try {
    const invites = await guild.invites.fetch().catch((e) => {
      logger?.warn?.('[InviteLeaderboard] guild.invites.fetch() failed', { guildId, error: e?.message });
      return null;
    });

    const coll = await getCollection(ctx);
    if (!coll) return;

    // If we couldn't fetch invites (permissions or transient error), do not overwrite stored invite map.
    if (invites === null) {
      // Ensure a document exists but don't replace invites field
      await coll.updateOne({ guildId }, { $setOnInsert: { guildId, counts: {} } }, { upsert: true });
      logger?.warn?.('[InviteLeaderboard] could not fetch invites; ensure bot has Manage Guild / Manage Invites permission', { guildId });
      return;
    }

    const invitesMap = {};
    for (const inv of invites.values()) {
      invitesMap[inv.code] = {
        inviterId: inv.inviter?.id ?? null,
        uses: Number(inv.uses ?? 0),
        maxUses: inv.maxUses ?? null,
        createdAt: inv.createdAt ? new Date(inv.createdAt).toISOString() : null,
        expiresAt: inv.expiresAt ? new Date(inv.expiresAt).toISOString() : null,
      };
    }

    // Upsert the invites map; counts kept if present
    await coll.updateOne(
      { guildId },
      { $set: { guildId, invites: invitesMap }, $setOnInsert: { counts: {} } },
      { upsert: true }
    );
  } catch (err) {
    logger?.warn?.('[InviteLeaderboard] initGuildBaseline error', { guildId, error: err?.message });
  }
}

export async function handleInviteCreate(ctx, invite) {
  const logger = ctx.logger;
  if (!invite || !invite.guild) return;
  const guildId = invite.guild.id;
  const code = invite.code;
  try {
    const coll = await getCollection(ctx);
    if (!coll) return;
    const record = {
      inviterId: invite.inviter?.id ?? null,
      uses: Number(invite.uses ?? 0),
      maxUses: invite.maxUses ?? null,
      createdAt: invite.createdAt ? new Date(invite.createdAt).toISOString() : null,
      expiresAt: invite.expiresAt ? new Date(invite.expiresAt).toISOString() : null,
    };
    await coll.updateOne({ guildId }, { $set: { [`invites.${code}`]: record, guildId } }, { upsert: true });
  } catch (err) {
    logger?.warn?.('[InviteLeaderboard] handleInviteCreate error', { guildId, code, error: err?.message });
  }
}

export async function handleInviteDelete(ctx, inviteOrCode) {
  const logger = ctx.logger;
  try {
    const guildId = inviteOrCode?.guild?.id ?? null;
    const code = typeof inviteOrCode === 'string' ? inviteOrCode : inviteOrCode?.code;
    if (!guildId || !code) {
      // If we don't have guildId, try a best-effort scan (skip for now)
      return;
    }
    const coll = await getCollection(ctx);
    if (!coll) return;
    // Remove invite entry
    await coll.updateOne({ guildId }, { $unset: { [`invites.${code}`]: '' } });
  } catch (err) {
    logger?.warn?.('[InviteLeaderboard] handleInviteDelete error', { error: err?.message });
  }
}

/**
 * Process a guild member add event to attribute invite uses.
 * Approach: fetch current invites, compare uses with stored invites, find which increased.
 */
export async function processGuildMemberAdd(ctx, guild, _member) {
  const logger = ctx.logger;
  if (!guild || !guild.id) return;
  const guildId = guild.id;
  try {
    const coll = await getCollection(ctx);
    if (!coll) return;
    const doc = await coll.findOne({ guildId }) || { invites: {}, counts: {} };
    const storedInvites = doc.invites || {};
    const counts = doc.counts || {};

    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) {
      // Can't fetch invites; give unknown attribution and log a helpful warning
      logger?.warn?.('[InviteLeaderboard] processGuildMemberAdd: failed to fetch invites (permissions or transient error)', { guildId });
      counts.UNKNOWN = (counts.UNKNOWN || 0) + 1;
      await coll.updateOne({ guildId }, { $set: { counts, guildId } }, { upsert: true });
      return;
    }

    // Find changed invite
    let matched = null;
    for (const inv of invites.values()) {
      const code = inv.code;
      const newUses = Number(inv.uses ?? 0);
      const old = storedInvites?.[code];
      const oldUses = old ? Number(old.uses || 0) : 0;
      if (newUses > oldUses) {
        // This invite was used
        matched = { code, inviterId: inv.inviter?.id ?? null, delta: newUses - oldUses };
        break;
      }
    }

    if (matched) {
      const who = matched.inviterId || 'UNKNOWN';
      counts[who] = (counts[who] || 0) + matched.delta;
      // Update stored invite uses to reflect current
      await coll.updateOne({ guildId }, { $set: { [`invites.${matched.code}.uses`]: matched.delta + (storedInvites[matched.code]?.uses || 0), counts, guildId } }, { upsert: true });
    } else {
      // No increased invite found - fallback attribution to UNKNOWN
      counts.UNKNOWN = (counts.UNKNOWN || 0) + 1;
      await coll.updateOne({ guildId }, { $set: { counts, guildId } }, { upsert: true });
    }
  } catch (err) {
    logger?.warn?.('[InviteLeaderboard] processGuildMemberAdd error', { guildId, error: err?.message });
  }
}

/**
 * Reconcile invites across all guilds: refresh stored invite uses and attempt to detect missed deltas.
 */
export async function reconcileAllGuilds(ctx) {
  const logger = ctx.logger;
  const client = ctx.client;
  try {
    const guilds = client.guilds?.cache?.values?.() ? Array.from(client.guilds.cache.values()) : [];
    for (const g of guilds) {
      try {
        await reconcileGuild(ctx, g);
      } catch (e) {
        logger?.warn?.('[InviteLeaderboard] reconcileGuild failed', { guildId: g.id, error: e?.message });
      }
    }
  } catch (err) {
    logger?.warn?.('[InviteLeaderboard] reconcileAllGuilds error', { error: err?.message });
  }
}

async function reconcileGuild(ctx, guild) {
  const guildId = guild.id;
  const coll = await getCollection(ctx);
  if (!coll) return;
  const doc = await coll.findOne({ guildId }) || { invites: {}, counts: {} };
  const storedInvites = doc.invites || {};
  const counts = doc.counts || {};

  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return;

  // For each invite present now, compare and update stored uses
  for (const inv of invites.values()) {
    const code = inv.code;
    const newUses = Number(inv.uses ?? 0);
    const old = storedInvites?.[code];
    const oldUses = old ? Number(old.uses || 0) : 0;
    if (newUses > oldUses) {
      // attribute delta to inviter if known
      const who = inv.inviter?.id || 'UNKNOWN';
      const delta = newUses - oldUses;
      counts[who] = (counts[who] || 0) + delta;
      await coll.updateOne({ guildId }, { $set: { [`invites.${code}.uses`]: newUses, counts, guildId } }, { upsert: true });
    } else if (newUses < oldUses) {
      // Invite uses decreased (rare) - update to new value but don't decrement counts
      await coll.updateOne({ guildId }, { $set: { [`invites.${code}.uses`]: newUses, guildId } }, { upsert: true });
    } else {
      // equal - ensure stored record exists
      await coll.updateOne({ guildId }, { $set: { [`invites.${code}.inviterId`]: inv.inviter?.id ?? null, guildId } }, { upsert: true });
    }
  }

  // Remove invites that no longer exist
  const currentCodes = new Set(Array.from(invites.values()).map((i) => i.code));
  for (const code of Object.keys(storedInvites)) {
    if (!currentCodes.has(code)) {
      await coll.updateOne({ guildId }, { $unset: { [`invites.${code}`]: '' } });
    }
  }
}

export async function getLeaderboard(ctx, guildId, { limit = 10 } = {}) {
  const coll = await getCollection(ctx);
  if (!coll) return [];
  const doc = await coll.findOne({ guildId });
  const counts = doc?.counts || {};
  let arr = Object.entries(counts).map(([who, count]) => ({ who, count }));

  // If counts is empty or only UNKNOWN with 0, attempt to aggregate from stored invites as a baseline
  if ((!arr || arr.length === 0) && doc?.invites && Object.keys(doc.invites).length > 0) {
    const agg = {};
    for (const inv of Object.values(doc.invites)) {
      const inviter = inv?.inviterId || 'UNKNOWN';
      const uses = Number(inv?.uses || 0);
      if (uses <= 0) continue;
      agg[inviter] = (agg[inviter] || 0) + uses;
    }
    arr = Object.entries(agg).map(([who, count]) => ({ who, count }));
  }
  // Ensure array exists
  arr = arr || [];
  arr.sort((a, b) => b.count - a.count);
  return arr.slice(0, limit);
}

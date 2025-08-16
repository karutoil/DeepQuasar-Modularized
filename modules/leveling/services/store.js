import { ObjectId } from 'mongodb';

/**
 * Store functions using core.mongo wrapper.
 * Exports: setup(core) to create indexes, and helpers for GuildConfig and MemberXP.
 */

export async function setup(core) {
  const mongo = core.mongo || (await import('../../core/mongo.js')).createMongo(core.config, core.logger);
  const logger = core.logger;
  const collCfg = await mongo.getCollection('leveling_guild_configs');
  const collMembers = await mongo.getCollection('leveling_members');
  const collAudit = await mongo.getCollection('leveling_audit');

  try {
    await collCfg.createIndex({ guildId: 1 }, { unique: true });
    await collCfg.createIndex({ version: 1 });
    await collMembers.createIndex({ guildId: 1, xp: -1 });
    await collMembers.createIndex({ guildId: 1, userId: 1 }, { unique: true });
    await collAudit.createIndex({ guildId: 1, ts: -1 });
    logger.info('[leveling.store] indexes ensured');
  } catch (err) {
    logger.error('[leveling.store] index creation error', { err: err?.message });
  }
}

export async function getCollections(core) {
  const mongo = core.mongo || (await import('../../core/mongo.js')).createMongo(core.config, core.logger);
  return {
    cfg: await mongo.getCollection('leveling_guild_configs'),
    members: await mongo.getCollection('leveling_members'),
    audit: await mongo.getCollection('leveling_audit'),
  };
}

// Helper basic wrappers - these return raw collection promises
export async function getConfigCollection(core) {
  const mongo = core.mongo || (await import('../../core/mongo.js')).createMongo(core.config, core.logger);
  return await mongo.getCollection('leveling_guild_configs');
}

export async function getMembersCollection(core) {
  const mongo = core.mongo || (await import('../../core/mongo.js')).createMongo(core.config, core.logger);
  return await mongo.getCollection('leveling_members');
}

export async function getAuditCollection(core) {
  const mongo = core.mongo || (await import('../../core/mongo.js')).createMongo(core.config, core.logger);
  return await mongo.getCollection('leveling_audit');
}

export async function loadGuildConfig(core, guildId) {
  const coll = await getConfigCollection(core);
  const cfg = await coll.findOne({ guildId });
  return cfg;
}

export async function upsertGuildConfig(core, guildId, patch, actor) {
  const coll = await getConfigCollection(core);
  const now = new Date();
  const update = {
    $set: { ...patch, guildId, lastUpdated: now, version: (patch.version || 1) },
    $setOnInsert: { createdAt: now },
  };
  const res = await coll.findOneAndUpdate({ guildId }, update, { upsert: true, returnDocument: 'after' });
  await logAudit(core, guildId, actor, 'config_update', patch);
  return res.value;
}

export async function logAudit(core, guildId, actor, action, data) {
  const coll = await getAuditCollection(core);
  const ts = new Date();
  await (await coll).insertOne({ guildId, actor, action, data, ts });
}

export async function findOrCreateMember(core, guildId, userId) {
  const coll = await getMembersCollection(core);
  const now = new Date();
  const res = await coll.findOneAndUpdate(
    { guildId, userId },
    { $setOnInsert: { guildId, userId, xp: 0, level: 0, prestige: 0, optedOut: false, createdAt: now } },
    { upsert: true, returnDocument: 'after' }
  );
  return res.value;
}

export async function atomicAddXP(core, guildId, userId, xpDelta, now) {
  const coll = await getMembersCollection(core);
  now = now || new Date();
  // Use findOneAndUpdate with $inc and returnDocument after to get post-update doc
  const res = await coll.findOneAndUpdate(
    { guildId, userId },
    { $inc: { xp: xpDelta }, $set: { lastXPAt: now } },
    { upsert: true, returnDocument: 'after' }
  );
  return res.value;
}

export async function getTopMembers(core, guildId, page = 0, limit = 10) {
  const coll = await getMembersCollection(core);
  const cursor = (await coll).find(guildId ? { guildId } : {}).sort({ xp: -1 }).skip(page * limit).limit(limit);
  return await cursor.toArray();
}

export async function getMemberRank(core, guildId, userId) {
  const coll = await getMembersCollection(core);
  const member = await (await coll).findOne({ guildId, userId });
  if (!member) return null;
  const higher = await (await coll).countDocuments({ guildId, xp: { $gt: member.xp } });
  return higher + 1;
}

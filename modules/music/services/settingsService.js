import { createMongo } from '../../../core/mongo.js';

const COLLECTION = 'music_settings';

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

export async function getSettings(ctx, guildId) {
  if (!guildId) return null;
  const coll = await getCollection(ctx);
  if (!coll) return null;
  const doc = await coll.findOne({ guildId }) || { guildId, defaultVolume: null, persistentQueuePanel: { enabled: false, channelId: null } };
  // normalize
  if (!doc.persistentQueuePanel) doc.persistentQueuePanel = { enabled: false, channelId: null };
  return doc;
}

export async function setSettings(ctx, guildId, patch) {
  if (!guildId) return null;
  const coll = await getCollection(ctx);
  if (!coll) return null;
  // Build update document
  const update = { $set: { guildId } };
  if (typeof patch.defaultVolume !== 'undefined') update.$set.defaultVolume = patch.defaultVolume;
  if (typeof patch.persistentQueuePanel !== 'undefined') update.$set.persistentQueuePanel = patch.persistentQueuePanel;
  await coll.updateOne({ guildId }, update, { upsert: true });
  return await getSettings(ctx, guildId);
}

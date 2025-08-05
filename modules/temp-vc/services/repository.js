/**
 * MongoDB repository and indexes for Temporary Voice Channels.
 * Uses core/mongo.js client via ctx.mongo.
 */
const COLLECTIONS = {
  settings: "tempvc_settings",
  channels: "tempvc_channels",
  userPrefs: "tempvc_user_prefs",
  metricsDaily: "tempvc_metrics_daily",
  restartLog: "tempvc_restart_log",
};

export async function ensureIndexes(ctx) {
  const { logger, mongo } = ctx;
  const db = await mongo.getDb();
  if (!db) throw new Error("[TempVC] Mongo not configured (ctx.mongo.getDb() returned null)");

  // Settings
  {
    const col = db.collection(COLLECTIONS.settings);
    await Promise.all([
      // _id index exists by default; do not mark as unique explicitly
      col.createIndex({ triggerChannelIds: 1 }, { name: "triggerChannels_multikey" }),
    ]).catch((e) => logger?.warn?.("[TempVC] settings ensureIndexes error", { error: e?.message }));
  }

  // Channels
  {
    const col = db.collection(COLLECTIONS.channels);
    await Promise.all([
      // _id index exists by default
      col.createIndex({ guildId: 1 }, { name: "guild" }),
      col.createIndex({ guildId: 1, ownerId: 1 }, { name: "guild_owner" }),
      col.createIndex({ guildId: 1, categoryId: 1 }, { name: "guild_category" }),
      col.createIndex({ scheduledDeletionAt: 1 }, { name: "deletion_schedule" }),
      col.createIndex({ deletedAt: 1 }, { name: "deletedAt" }),
      col.createIndex({ lastActiveAt: 1 }, { name: "lastActiveAt" }),
    ]).catch((e) => logger?.warn?.("[TempVC] channels ensureIndexes error", { error: e?.message }));
  }

  // User Prefs
  {
    const col = db.collection(COLLECTIONS.userPrefs);
    await Promise.all([
      // _id index exists by default
      col.createIndex({ "stats.lastActiveAt": -1 }, { name: "lastActive_desc" }),
    ]).catch((e) => logger?.warn?.("[TempVC] userPrefs ensureIndexes error", { error: e?.message }));
  }

  // Metrics Daily
  {
    const col = db.collection(COLLECTIONS.metricsDaily);
    await Promise.all([
      // _id index exists by default
      col.createIndex({ guildId: 1, date: 1 }, { unique: true, name: "guild_date" }),
      col.createIndex({ date: 1 }, { name: "date" }),
    ]).catch((e) => logger?.warn?.("[TempVC] metricsDaily ensureIndexes error", { error: e?.message }));
  }

  // Restart Log
  {
    const col = db.collection(COLLECTIONS.restartLog);
    await Promise.all([
      col.createIndex({ guildId: 1, restartedAt: -1 }, { name: "guild_restarted_desc" }),
    ]).catch((e) => logger?.warn?.("[TempVC] restartLog ensureIndexes error", { error: e?.message }));
  }
}

export function repo(ctx) {
  const { mongo } = ctx;

  async function getDb() {
    const db = await mongo.getDb();
    if (!db) throw new Error("[TempVC] Mongo not configured");
    return db;
  }

  async function getCollection(name) {
    const db = await getDb();
    return db.collection(name);
  }

  return {
    collections: {
      // Expose native Collection instances via getters to avoid wrapper confusion
      async settings() { return await getCollection(COLLECTIONS.settings); },
      async channels() { return await getCollection(COLLECTIONS.channels); },
      async userPrefs() { return await getCollection(COLLECTIONS.userPrefs); },
      async metricsDaily() { return await getCollection(COLLECTIONS.metricsDaily); },
      async restartLog() { return await getCollection(COLLECTIONS.restartLog); },

      // Convenience methods used across services (retain names used by integrityService)
      async find(col, filter, opts) { const c = await this[col](); return c.find(filter, opts); },
      async findOne(col, filter, opts) { const c = await this[col](); return c.findOne(filter, opts); },
      async insertOne(col, doc, opts) { const c = await this[col](); return c.insertOne(doc, opts); },
      async updateOne(col, filter, update, opts) { const c = await this[col](); return c.updateOne(filter, update, opts); },
      async countDocuments(col, filter, opts) { const c = await this[col](); return c.countDocuments(filter, opts); },
      async distinct(col, field, filter, opts) { const c = await this[col](); return c.distinct(field, filter, opts); },
    },
  };
}
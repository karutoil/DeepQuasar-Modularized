import { createMongo } from "../../../core/mongo.js";
import { z } from "zod";

const COLLECTION = "guild_music_settings";
const DEFAULT_VOLUME = 50; // Default volume if not set

const GuildMusicSettingsSchema = z.object({
  _id: z.any().optional(), // MongoDB ObjectId
  guildId: z.string(),
  volume: z.number().min(0).max(100).default(DEFAULT_VOLUME),
});

const CACHE_TTL_MS = 60_000; // Cache for 1 minute
const _cache = new Map(); // guildId -> { value, expiresAt }

/**
 * Resolve the shared core Mongo wrapper from ctx, or lazily create one.
 */
function getMongo(ctx) {
  // Prefer the core's mongo instance if exposed, else create a local one.
  const coreMongo = ctx?.core?.mongo || ctx?.mongo;
  if (coreMongo && typeof coreMongo.getDb === "function") return coreMongo;
  // Fallback creation (will share process-wide if config same)
  const m = createMongo(ctx.config, ctx.logger);
  try { ctx.mongo = m; } catch {} // Attach to ctx for future use in this module
  return m;
}

/**
 * Ensure index for fast lookups and uniqueness on guildId.
 * Should be safe to call multiple times.
 */
export async function ensureIndexes(ctx) {
  try {
    const mongo = getMongo(ctx);
    const db = await mongo.getDb();
    if (!db) {
      ctx?.logger?.warn?.("[Music Settings] ensureIndexes: Mongo not connected");
      return;
    }
    await db.collection(COLLECTION).createIndex({ guildId: 1 }, { unique: true });
  } catch (e) {
    ctx?.logger?.warn?.("[Music Settings] ensureIndexes failed", { error: e?.message || e });
  }
}

/**
 * Get music settings for a guild with caching.
 */
export async function getGuildMusicSettings(ctx, guildId) {
  const cached = _cache.get(guildId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const mongo = getMongo(ctx);
  const db = await mongo.getDb();
  let doc = null;
  if (db) {
    doc = await db.collection(COLLECTION).findOne({ guildId });
  } else {
    ctx?.logger?.warn?.("[Music Settings] getGuildMusicSettings: Mongo not connected; using defaults");
  }
  const merged = {
    guildId,
    volume: DEFAULT_VOLUME, // Apply default volume
    ...(doc || {}),
  };
  const validated = GuildMusicSettingsSchema.parse(merged); // Ensure schema compliance
  _cache.set(guildId, { value: validated, expiresAt: now + CACHE_TTL_MS });
  return validated;
}

/**
 * Upsert music settings for a guild and invalidate cache.
 */
export async function setGuildMusicSettings(ctx, guildId, partial) {
  const mongo = getMongo(ctx);
  const coll = await mongo.getCollection(COLLECTION);
  if (!coll) throw new Error("Mongo collection not available");

  // Fetch current settings to merge with partial update for validation
  const currentSettings = await getGuildMusicSettings(ctx, guildId);
  const mergedSettings = { ...currentSettings, ...partial };

  const validated = GuildMusicSettingsSchema.parse(mergedSettings);

  const update = { $set: { ...validated, guildId } };
  const { ok, error } = await mongo.withSchema(GuildMusicSettingsSchema, async () => {
    return await coll.updateOne({ guildId }, update, { upsert: true });
  });

  if (!ok) {
    ctx?.logger?.error?.("[Music Settings] Failed to save music settings", { error });
    throw new Error(`Failed to save music settings: ${error}`);
  }
  invalidateGuildMusicSettingsCache(guildId);
}

/**
 * Invalidate a guild's music settings cache (used after saves).
 */
export function invalidateGuildMusicSettingsCache(guildId) {
  _cache.delete(guildId);
}

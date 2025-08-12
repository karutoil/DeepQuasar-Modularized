import { createMongo } from "../../../core/mongo.js";
import { encrypt, decrypt } from "../../../core/crypto.js";

const COLLECTION = "guild_chat_agent_settings";
const DEFAULTS = Object.freeze({
  enabled: true,
  apiKey: null,
  baseUrl: null,
  model: "gpt-3.5-turbo",
  temperature: 0.7,
  systemPrompt: "You are a helpful AI assistant.",
  activeChannel: null, // Channel ID where all messages are treated as AI input
  historyLimit: 10, // Max number of messages to send as context
});

const CACHE_TTL_MS = 60_000;
const _cache = new Map(); // guildId -> { value, expiresAt }

/**
 * Resolve the shared core Mongo wrapper from ctx, or lazily create one.
 */
function getMongo(ctx) {
  const coreMongo = ctx?.core?.mongo || ctx?.mongo;
  if (coreMongo && typeof coreMongo.getDb === "function") return coreMongo;
  const m = createMongo(ctx.config, ctx.logger);
  try { ctx.mongo = m; } catch {}
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
      ctx?.logger?.warn?.("[ChatAgent] ensureIndexes: Mongo not connected");
      return;
    }
    await db.collection(COLLECTION).createIndex({ guildId: 1 }, { unique: true });
  } catch (e) {
    ctx?.logger?.warn?.("[ChatAgent] ensureIndexes failed", { error: e?.message || e });
  }
}

/**
 * Get settings for a guild with caching.
 */
export async function getGuildSettings(ctx, guildId) {
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
    ctx?.logger?.warn?.("[ChatAgent] getGuildSettings: Mongo not connected; using defaults");
  }
  const merged = {
    guildId,
    ...DEFAULTS,
    ...(doc || {}),
  };
  // Decrypt sensitive fields
  if (merged.apiKey) {
    merged.apiKey = decrypt(merged.apiKey);
  }
  _cache.set(guildId, { value: merged, expiresAt: now + CACHE_TTL_MS });
  return merged;
}

/**
 * Upsert settings for a guild and invalidate cache.
 */
export async function setGuildSettings(ctx, guildId, partial) {
  const mongo = getMongo(ctx);
  const db = await mongo.getDb();
  if (!db) {
    throw new Error("Mongo not connected");
  }
  // Encrypt sensitive fields
  if (partial.apiKey) {
    partial.apiKey = encrypt(partial.apiKey);
  }
  const update = { $set: { ...partial, guildId } };
  await db.collection(COLLECTION).updateOne({ guildId }, update, { upsert: true });
  invalidateGuildSettingsCache(guildId);
}

/**
 * Delete a specific setting for a guild and invalidate cache.
 */
export async function deleteGuildSetting(ctx, guildId, key) {
  const mongo = getMongo(ctx);
  const db = await mongo.getDb();
  if (!db) {
    throw new Error("Mongo not connected");
  }
  const unset = { $unset: { [key]: "" } };
  await db.collection(COLLECTION).updateOne({ guildId }, unset);
  invalidateGuildSettingsCache(guildId);
}

/**
 * Invalidate a guild's settings cache (used after saves).
 */
export function invalidateGuildSettingsCache(guildId) {
  _cache.delete(guildId);
}

/**
 * Get all settings for a guild, merging with defaults.
 */
export async function getAllGuildSettings(ctx, guildId) {
  const settings = await getGuildSettings(ctx, guildId);
  return { ...DEFAULTS, ...settings };
}

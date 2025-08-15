import { createMongo } from "../../../core/mongo.js";

const COLLECTION = "guild_autorole_settings";
const DEFAULTS = Object.freeze({
  enabled: true,
  roleId: null,
  delaySeconds: 0,
  ignoreBots: true,
  minAccountAgeDays: null, // null/undefined means disabled
});

const CACHE_TTL_MS = 60_000;
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
  try { ctx.mongo = m; } catch (err) { void err; }
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
      ctx?.logger?.warn?.("[Autorole] ensureIndexes: Mongo not connected");
      return;
    }
    await db.collection(COLLECTION).createIndex({ guildId: 1 }, { unique: true });
  } catch (e) {
    ctx?.logger?.warn?.("[Autorole] ensureIndexes failed", { error: e?.message || e });
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
    ctx?.logger?.warn?.("[Autorole] getGuildSettings: Mongo not connected; using defaults");
  }
  const merged = {
    guildId,
    ...DEFAULTS,
    ...(doc || {}),
  };
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
  const update = { $set: { ...partial, guildId } };
  await db.collection(COLLECTION).updateOne({ guildId }, update, { upsert: true });
  invalidateGuildSettingsCache(guildId);
}

/**
 * Invalidate a guild's settings cache (used after saves).
 */
export function invalidateGuildSettingsCache(guildId) {
  _cache.delete(guildId);
}

/**
 * Access to cache reference if needed by index wiring.
 */
export function getSettingsCache() {
  return _cache;
}

/**
 * Validate that the chosen role is assignable by the bot in this guild.
 * Returns { ok: boolean, reason?: string }
 */
export function validateRoleAssignable(guild, roleId) {
  try {
    if (!guild || !roleId) return { ok: false, reason: "Missing guild or role" };
    const role = guild.roles.cache.get(roleId);
    if (!role) return { ok: false, reason: "Role not found in guild" };
    const me = guild.members.me || guild.members.cache.get(guild.client.user.id);
    if (!me) return { ok: false, reason: "Bot member not found" };
    const myTop = me.roles.highest;
    if (!myTop) return { ok: false, reason: "Bot has no roles" };
    if (role.managed) return { ok: false, reason: "Managed role cannot be assigned" };
    if (role.position >= myTop.position) {
      return { ok: false, reason: "Role is above or equal to bot's top role" };
    }
    if (!me.permissions.has?.("ManageRoles")) {
      return { ok: false, reason: "Bot lacks Manage Roles permission" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message || "Validation error" };
  }
}
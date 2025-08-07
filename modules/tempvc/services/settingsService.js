import { Collection } from "mongodb";

const GUILD_SETTINGS_COLLECTION = "tempvc_guild_settings";
const USER_SETTINGS_COLLECTION = "tempvc_user_settings";

/**
 * Ensures MongoDB indexes for tempvc settings collections.
 * @param {object} ctx - The core context.
 */
export async function ensureIndexes(ctx) {
  const { logger, mongo } = ctx;
  try {
    const db = await mongo.getDb();
    await db.collection(GUILD_SETTINGS_COLLECTION).createIndex({ guildId: 1 }, { unique: true });
    await db.collection(USER_SETTINGS_COLLECTION).createIndex({ guildId: 1, userId: 1 }, { unique: true });
    logger.info("[TempVC] Settings indexes ensured");
  } catch (e) {
    logger.warn("[TempVC] Settings index creation failed", { error: e?.message });
  }
}

/**
 * Retrieves guild settings for the TempVC module.
 * @param {object} ctx - The core context.
 * @param {string} guildId - The ID of the guild.
 * @returns {Promise<object>} The guild settings.
 */
export async function getGuildSettings(ctx, guildId) {
  const db = await ctx.mongo.getDb();
  const settings = await db.collection(GUILD_SETTINGS_COLLECTION).findOne({ guildId });
  return settings || {};
}

/**
 * Updates guild settings for the TempVC module.
 * @param {object} ctx - The core context.
 * @param {string} guildId - The ID of the guild.
 * @param {object} patch - The settings to update.
 * @returns {Promise<object>} The updated guild settings.
 */
export async function updateGuildSettings(ctx, guildId, patch) {
  const db = await ctx.mongo.getDb();
  const result = await db.collection(GUILD_SETTINGS_COLLECTION).findOneAndUpdate(
    { guildId },
    { $set: patch },
    { upsert: true, returnDocument: "after" }
  );
  return result.value;
}

/**
 * Retrieves user-specific settings for the TempVC module within a guild.
 * @param {object} ctx - The core context.
 * @param {string} guildId - The ID of the guild.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<object>} The user settings.
 */
export async function getUserSettings(ctx, guildId, userId) {
  const db = await ctx.mongo.getDb();
  const settings = await db.collection(USER_SETTINGS_COLLECTION).findOne({ guildId, userId });
  return settings || {};
}

/**
 * Updates user-specific settings for the TempVC module within a guild.
 * @param {object} ctx - The core context.
 * @param {string} guildId - The ID of the guild.
 * @param {string} userId - The ID of the user.
 * @param {object} patch - The settings to update.
 * @returns {Promise<object>} The updated user settings.
 */
export async function updateUserSettings(ctx, guildId, userId, patch) {
  const db = await ctx.mongo.getDb();
  const result = await db.collection(USER_SETTINGS_COLLECTION).findOneAndUpdate(
    { guildId, userId },
    { $set: patch },
    { upsert: true, returnDocument: "after" }
  );
  return result.value;
}

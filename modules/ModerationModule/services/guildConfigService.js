/**
 * Guild Config Service for persistent per-guild settings (MongoDB).
 * Handles modlog channel storage and retrieval.
 */

const COLLECTION_NAME = "guildConfigs";

/**
 * Set the moderation log channel for a guild.
 * @param {object} ctx - Context with .mongo
 * @param {string} guildId
 * @param {string} channelId
 */
export async function setModlogChannel(ctx, guildId, channelId) {
  const db = await ctx.mongo.getDb();
  const collection = db.collection(COLLECTION_NAME);
  await collection.updateOne(
    { guildId },
    { $set: { modLogChannel: channelId } },
    { upsert: true }
  );
}

/**
 * Get the moderation log channel for a guild.
 * @param {object} ctx - Context with .mongo
 * @param {string} guildId
 * @returns {Promise<string|null>} Channel ID or null if not set
 */
export async function getModlogChannel(ctx, guildId) {
  const db = await ctx.mongo.getDb();
  const collection = db.collection(COLLECTION_NAME);
  const doc = await collection.findOne({ guildId });
  return doc?.modLogChannel || null;
}
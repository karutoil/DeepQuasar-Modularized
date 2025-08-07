import { Collection } from "mongodb";

const TEMP_VC_COLLECTION = "tempvc_channels";

/**
 * Ensures MongoDB indexes for temporary voice channel collection.
 * @param {object} ctx - The core context.
 */
export async function ensureIndexes(ctx) {
  const { logger, mongo } = ctx;
  try {
    const db = await mongo.getDb();
    await db.collection(TEMP_VC_COLLECTION).createIndexes([
      { key: { guildId: 1, channelId: 1 }, unique: true, name: "guild_channel_unique" },
      { key: { guildId: 1, ownerId: 1 }, name: "guild_owner_idx" },
      { key: { lastActivityAt: 1 }, expireAfterSeconds: 60 * 60 * 24 * 7 }, // Channels expire after 7 days of inactivity
    ]);
    logger.info("[TempVC] TempVC channel indexes ensured");
  } catch (e) {
    logger.warn("[TempVC] TempVC channel index creation failed", { error: e?.message });
  }
}

/**
 * Creates a new temporary voice channel document.
 * @param {object} ctx - The core context.
 * @param {object} data - The data for the new channel (guildId, channelId, ownerId, etc.).
 * @returns {Promise<object>} The created channel document.
 */
export async function createTempVc(ctx, data) {
  const db = await ctx.mongo.getDb();
  const doc = {
    ...data,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    members: [], // Array of user IDs currently in the channel
  };
  await db.collection(TEMP_VC_COLLECTION).insertOne(doc);
  return doc;
}

/**
 * Retrieves a temporary voice channel by its channel ID.
 * @param {object} ctx - The core context.
 * @param {string} channelId - The ID of the voice channel.
 * @returns {Promise<object|null>} The channel document or null if not found.
 */
export async function getTempVcByChannelId(ctx, channelId) {
  const db = await ctx.mongo.getDb();
  return db.collection(TEMP_VC_COLLECTION).findOne({ channelId });
}

/**
 * Retrieves a temporary voice channel by its owner ID within a guild.
 * @param {object} ctx - The core context.
 * @param {string} guildId - The ID of the guild.
 * @param {string} ownerId - The ID of the channel owner.
 * @returns {Promise<object|null>} The channel document or null if not found.
 */
export async function getTempVcByOwnerId(ctx, guildId, ownerId) {
  const db = await ctx.mongo.getDb();
  return db.collection(TEMP_VC_COLLECTION).findOne({ guildId, ownerId });
}

/**
 * Updates a temporary voice channel document.
 * @param {object} ctx - The core context.
 * @param {string} channelId - The ID of the voice channel to update.
 * @param {object} patch - The fields to update.
 * @returns {Promise<object|null>} The updated channel document or null if not found.
 */
export async function updateTempVc(ctx, channelId, patch) {
  const db = await ctx.mongo.getDb();
  const result = await db.collection(TEMP_VC_COLLECTION).findOneAndUpdate(
    { channelId },
    { $set: { ...patch, lastActivityAt: new Date() } },
    { returnDocument: "after" }
  );
  return result.value;
}

/**
 * Deletes a temporary voice channel document.
 * @param {object} ctx - The core context.
 * @param {string} channelId - The ID of the voice channel to delete.
 * @returns {Promise<boolean>} True if deleted, false otherwise.
 */
export async function deleteTempVc(ctx, channelId) {
  const db = await ctx.mongo.getDb();
  const result = await db.collection(TEMP_VC_COLLECTION).deleteOne({ channelId });
  return result.deletedCount > 0;
}

/**
 * Adds a member to the temporary voice channel's member list.
 * @param {object} ctx - The core context.
 * @param {string} channelId - The ID of the voice channel.
 * @param {string} userId - The ID of the user to add.
 * @returns {Promise<object|null>} The updated channel document or null if not found.
 */
export async function addTempVcMember(ctx, channelId, userId) {
  const db = await ctx.mongo.getDb();
  const result = await db.collection(TEMP_VC_COLLECTION).findOneAndUpdate(
    { channelId },
    { $addToSet: { members: userId }, $set: { lastActivityAt: new Date() } },
    { returnDocument: "after" }
  );
  return result.value;
}

/**
 * Removes a member from the temporary voice channel's member list.
 * @param {object} ctx - The core context.
 * @param {string} channelId - The ID of the voice channel.
 * @param {string} userId - The ID of the user to remove.
 * @returns {Promise<object|null>} The updated channel document or null if not found.
 */
export async function removeTempVcMember(ctx, channelId, userId) {
  const db = await ctx.mongo.getDb();
  const result = await db.collection(TEMP_VC_COLLECTION).findOneAndUpdate(
    { channelId },
    { $pull: { members: userId }, $set: { lastActivityAt: new Date() } },
    { returnDocument: "after" }
  );
  return result.value;
}

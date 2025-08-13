
const COLLECTION_NAME = 'moderation_warnings';

/**
 * Adds a warning for a user in a guild.
 * @param {string} guildId
 * @param {string} userId
 * @param {object} warningData - { reason, moderatorId, issuedAt, expiresAt }
 * @returns {Promise<object>} The created warning document.
 */
export async function addWarning(ctx, guildId, userId, warningData) {
  try {
    const db = await ctx.mongo.getDb();
    const collection = db.collection(COLLECTION_NAME);
    const doc = {
      guildId,
      userId,
      reason: warningData.reason,
      moderatorId: warningData.moderatorId,
      issuedAt: warningData.issuedAt || new Date(),
      expiresAt: warningData.expiresAt || null,
    };
    const result = await collection.insertOne(doc);
    return { ...doc, _id: result.insertedId };
  } catch (err) {
    throw new Error(`Failed to add warning: ${err.message}`);
  }
}

/**
 * Removes a warning by its ID.
 * @param {string} warningId
 * @returns {Promise<boolean>} True if deleted, false otherwise.
 */
export async function removeWarning(ctx, warningId) {
  try {
    const db = await ctx.mongo.getDb();
    const collection = db.collection(COLLECTION_NAME);
    const result = await collection.deleteOne({ _id: warningId });
    return result.deletedCount === 1;
  } catch (err) {
    throw new Error(`Failed to remove warning: ${err.message}`);
  }
}

/**
 * Lists active warnings for a user in a guild.
 * Expired warnings are not included.
 * @param {string} guildId
 * @param {string} userId
 * @returns {Promise<Array>} Array of warning documents.
 */
export async function listWarnings(ctx, guildId, userId) {
  try {
    const db = await ctx.mongo.getDb();
    const collection = db.collection(COLLECTION_NAME);
    const now = new Date();
    const warnings = await collection
      .find({
        guildId,
        userId,
        $or: [
          { expiresAt: null },
          { expiresAt: { $gt: now } },
        ],
      })
      .toArray();
    return warnings;
  } catch (err) {
    throw new Error(`Failed to list warnings: ${err.message}`);
  }
}

/**
 * Gets a specific warning by its ID.
 * @param {string} warningId
 * @returns {Promise<object|null>} The warning document or null.
 */
export async function getWarning(ctx, warningId) {
  try {
    const db = await ctx.mongo.getDb();
    const collection = db.collection(COLLECTION_NAME);
    const warning = await collection.findOne({ _id: warningId });
    if (!warning) return null;
    if (warning.expiresAt && new Date(warning.expiresAt) < new Date()) {
      return null;
    }
    return warning;
  } catch (err) {
    throw new Error(`Failed to get warning: ${err.message}`);
  }
}

/**
 * Clears all warnings for a user in a guild.
 * @param {string} guildId
 * @param {string} userId
 * @returns {Promise<number>} Number of warnings deleted.
 */
export async function clearWarnings(ctx, guildId, userId) {
  try {
    const db = await ctx.mongo.getDb();
    const collection = db.collection(COLLECTION_NAME);
    const result = await collection.deleteMany({ guildId, userId });
    return result.deletedCount;
  } catch (err) {
    throw new Error(`Failed to clear warnings: ${err.message}`);
  }
}
export const warningService = {
  addWarning,
  removeWarning,
  listWarnings,
  getWarning,
  clearWarnings,
};
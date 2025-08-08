const COLLECTION = "user_timezones";

/**
 * Ensure indexes for timezones collection.
 * - userId unique
 */
export async function ensureIndexes(ctx) {
  try {
    const db = await ctx.mongo.getDb();
    await db.collection(COLLECTION).createIndex({ userId: 1 }, { unique: true });
    ctx?.logger?.info?.("[Timezones] Index ensured");
  } catch (e) {
    ctx?.logger?.warn?.("[Timezones] ensureIndexes failed", { error: e?.message || e });
  }
}

/**
 * Set a user's timezone.
 * @param {object} ctx
 * @param {string} userId
 * @param {string} timezone e.g. "America/New_York"
 * @returns {object} updated doc
 */
export async function setUserTimezone(ctx, userId, timezone) {
  const db = await ctx.mongo.getDb();
  const update = {
    $set: {
      userId,
      timezone,
      updatedAt: new Date(),
    },
    $setOnInsert: {
      createdAt: new Date(),
    },
  };
  const opts = { upsert: true, returnDocument: "after" };
  const result = await db.collection(COLLECTION).findOneAndUpdate(
    { userId },
    update,
    opts
  );
  return result.value;
}

/**
 * Get a user's timezone.
 * @param {object} ctx
 * @param {string} userId
 * @returns {string|null} timezone
 */
export async function getUserTimezone(ctx, userId) {
  const db = await ctx.mongo.getDb();
  const doc = await db.collection(COLLECTION).findOne({ userId });
  return doc ? doc.timezone : null;
}

/**
 * Delete a user's timezone.
 * @param {object} ctx
 * @param {string} userId
 * @returns {boolean} success
 */
export async function deleteUserTimezone(ctx, userId) {
  const db = await ctx.mongo.getDb();
  const result = await db.collection(COLLECTION).deleteOne({ userId });
  return result.deletedCount > 0;
}

/**
 * List all user timezones (admin/debug).
 * @param {object} ctx
 * @returns {Array}
 */
export async function listUserTimezones(ctx) {
  const db = await ctx.mongo.getDb();
  return db.collection(COLLECTION).find({}).toArray();
}
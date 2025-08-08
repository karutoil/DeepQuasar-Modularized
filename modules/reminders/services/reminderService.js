const COLLECTION = "reminders";

/**
 * Ensure indexes for reminders collection.
 * - userId + time for fast due queries
 * - _id for uniqueness
 * - Optionally recurrence for future features
 */
export async function ensureIndexes(ctx) {
  try {
    const db = await ctx.mongo.getDb();
    await db.collection(COLLECTION).createIndexes([
      { key: { userId: 1, time: 1 }, name: "user_time_idx" },
      { key: { time: 1 }, name: "time_idx" },
      { key: { recurrence: 1 }, name: "recurrence_idx", sparse: true },
      { key: { deleted: 1 }, name: "deleted_idx" },
      { key: { snoozeUntil: 1 }, name: "snooze_idx", sparse: true },
    ]);
    ctx?.logger?.info?.("[Reminders] Indexes ensured");
  } catch (e) {
    ctx?.logger?.warn?.("[Reminders] ensureIndexes failed", { error: e?.message || e });
  }
}

/**
 * Create a new reminder.
 * @param {object} ctx
 * @param {object} data { userId, message, time, recurrence, channelId }
 * @returns {object} inserted reminder doc
 */
export async function createReminder(ctx, data) {
  const db = await ctx.mongo.getDb();
  const doc = {
    userId: data.userId,
    message: data.message,
    time: data.time, // ISO string
    recurrence: data.recurrence || null, // e.g. cron, "daily", "weekly", null
    channelId: data.channelId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date(),
    snoozeUntil: data.snoozeUntil || null, // nullable Date
    deleted: data.deleted === true, // default false
  };
  const result = await db.collection(COLLECTION).insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

/**
 * Get all reminders for a user.
 * @param {object} ctx
 * @param {string} userId
 * @returns {Array} reminders
 */
export async function getRemindersForUser(ctx, userId) {
  const db = await ctx.mongo.getDb();
  return db.collection(COLLECTION).find({
    userId,
    deleted: { $ne: true },
    $or: [
      { snoozeUntil: null },
      { snoozeUntil: { $lte: new Date() } }
    ]
  }).toArray();
}

/**
 * Update a reminder by _id.
 * @param {object} ctx
 * @param {string|object} id Mongo ObjectId or string
 * @param {object} patch fields to update
 * @returns {object} updated doc
 */
export async function updateReminder(ctx, id, patch) {
  const db = await ctx.mongo.getDb();
  const update = { $set: { ...patch, updatedAt: new Date() } };
  const opts = { returnDocument: "after" };
  const result = await db.collection(COLLECTION).findOneAndUpdate(
    { _id: id },
    update,
    opts
  );
  return result.value;
}

/**
 * Delete a reminder by _id.
 * @param {object} ctx
 * @param {string|object} id Mongo ObjectId or string
 * @returns {boolean} success
 */
export async function deleteReminder(ctx, id) {
  const db = await ctx.mongo.getDb();
  const result = await db.collection(COLLECTION).deleteOne({ _id: id });
  return result.deletedCount > 0;
}

/**
 * Get reminders due at or before a given time.
 * Used for scheduling/dispatch.
 * @param {object} ctx
 * @param {Date|string} time ISO string or Date
 * @returns {Array} reminders
 */
export async function getDueReminders(ctx, time) {
  const db = await ctx.mongo.getDb();
  const now = typeof time === "string" ? new Date(time) : time;
  // Only one-time and recurring reminders due now
  return db.collection(COLLECTION).find({
    time: { $lte: now.toISOString() },
    deleted: { $ne: true },
    $or: [
      { snoozeUntil: null },
      { snoozeUntil: { $lte: now } }
    ]
  }).toArray();
}

/**
 * Get a reminder by _id.
 * @param {object} ctx
 * @param {string|object} id
 * @returns {object|null}
 */
export async function getReminderById(ctx, id) {
  const db = await ctx.mongo.getDb();
  return db.collection(COLLECTION).findOne({ _id: id, deleted: { $ne: true } });
}

/**
 * List all reminders (admin/debug).
 * @param {object} ctx
 * @param {object} [filter]
 * @returns {Array}
 */
export async function listReminders(ctx, filter = {}) {
  const db = await ctx.mongo.getDb();
  // For admin/debug, include deleted unless explicitly filtered
  return db.collection(COLLECTION).find(filter).toArray();
}

/**
 * Snooze a reminder (postpone).
 * @param {object} ctx
 * @param {string|object} id
 * @param {Date|string} until
 * @returns {object} updated doc
 */
export async function snoozeReminder(ctx, id, until) {
  return updateReminder(ctx, id, { snoozeUntil: until ? new Date(until) : null });
}

/**
 * Soft-delete a reminder (mark as deleted).
 * @param {object} ctx
 * @param {string|object} id
 * @returns {object} updated doc
 */
export async function softDeleteReminder(ctx, id) {
  return updateReminder(ctx, id, { deleted: true });
}
import { createMongo } from "../../../core/mongo.js";

const COLLECTION = "guild_chat_agent_conversations";

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
 * Ensure indexes for fast lookups on guildId, channelId, and userId.
 */
export async function ensureIndexes(ctx) {
  try {
    const mongo = getMongo(ctx);
    const db = await mongo.getDb();
    if (!db) {
      ctx?.logger?.warn?.("[ChatAgent] ConversationService: Mongo not connected");
      return;
    }
    await db.collection(COLLECTION).createIndex({ guildId: 1, channelId: 1, userId: 1 }, { unique: true });
  } catch (e) {
    ctx?.logger?.warn?.("[ChatAgent] ConversationService: ensureIndexes failed", { error: e?.message || e });
  }
}

/**
 * Get conversation history for a specific user in a channel.
 * @param {object} ctx - The module context.
 * @param {string} guildId - The ID of the guild.
 * @param {string} channelId - The ID of the channel.
 * @param {string} userId - The ID of the user.
 * @param {number} limit - The maximum number of messages to return.
 * @returns {Promise<Array<object>>} - An array of message objects.
 */
export async function getConversationHistory(ctx, guildId, channelId, userId, limit = 10) {
  const mongo = getMongo(ctx);
  const db = await mongo.getDb();
  if (!db) {
    ctx?.logger?.warn?.("[ChatAgent] ConversationService: Mongo not connected; returning empty history");
    return [];
  }
  const doc = await db.collection(COLLECTION).findOne({ guildId, channelId, userId });
  if (!doc || !doc.messages) {
    return [];
  }
  // Decrypt messages before returning
  const decryptedMessages = doc.messages.map(msg => ({
    ...msg,
    content: ctx.crypto.decrypt(msg.content)
  }));
  // Return the last 'limit' messages
  return decryptedMessages.slice(Math.max(0, decryptedMessages.length - limit));
}

/**
 * Add a message to the conversation history for a user in a channel.
 * @param {object} ctx - The module context.
 * @param {string} guildId - The ID of the guild.
 * @param {string} channelId - The ID of the channel.
 * @param {string} userId - The ID of the user.
 * @param {string} role - The role of the message sender (e.g., 'user', 'assistant', 'system').
 * @param {string} content - The content of the message.
 */
export async function addMessageToHistory(ctx, guildId, channelId, userId, role, content) {
  const mongo = getMongo(ctx);
  const db = await mongo.getDb();
  if (!db) {
    ctx?.logger?.warn?.("[ChatAgent] ConversationService: Mongo not connected; cannot save history");
    return;
  }
  // Encrypt message content before saving
  const encryptedContent = ctx.crypto.encrypt(content);
  const message = { role, content: encryptedContent, timestamp: new Date() };
  await db.collection(COLLECTION).updateOne(
    { guildId, channelId, userId },
    { $push: { messages: message } },
    { upsert: true }
  );
}

/**
 * Clear the conversation history for a specific user in a channel.
 * @param {object} ctx - The module context.
 * @param {string} guildId - The ID of the guild.
 * @param {string} channelId - The ID of the channel.
 * @param {string} userId - The ID of the user.
 */
export async function clearConversationHistory(ctx, guildId, channelId, userId) {
  const mongo = getMongo(ctx);
  const db = await mongo.getDb();
  if (!db) {
    ctx?.logger?.warn?.("[ChatAgent] ConversationService: Mongo not connected; cannot clear history");
    return;
  }
  await db.collection(COLLECTION).deleteOne({ guildId, channelId, userId });
}

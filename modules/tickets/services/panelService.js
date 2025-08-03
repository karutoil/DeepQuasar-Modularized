// Panel service: CRUD for ticket panels and message management

const COLLECTION = "guild_ticket_panels";

/**
 * Schema:
 * {
 *   guildId: string,
 *   panelId: string,          // unique per guild
 *   channelId: string,        // target channel where panel message lives
 *   messageId: string,        // sent message id
 *   embed: { title, description },
 *   buttons: [ { label, style, typeId } ],
 *   createdAt, updatedAt
 * }
 */

function now() { return new Date(); }
function newPanelId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`; }

export async function ensureIndexes(ctx) {
  const { logger } = ctx;
  try {
    const db = await ctx.mongo.getDb();
    await db.collection(COLLECTION).createIndexes([
      { key: { guildId: 1, panelId: 1 }, unique: true, name: "guild_panel_unique" },
      { key: { guildId: 1, channelId: 1, messageId: 1 }, unique: true, sparse: true, name: "message_unique" },
    ]);
    logger.info("[Tickets] panel indexes ensured");
  } catch (e) {
    ctx.logger?.warn?.("[Tickets] panel index creation failed", { error: e?.message });
  }
}

export async function createPanel(ctx, guildId, { channelId, messageId, embed, buttons }) {
  const db = await ctx.mongo.getDb();
  const doc = {
    guildId,
    panelId: newPanelId(),
    channelId,
    messageId,
    embed: sanitizeEmbed(embed),
    buttons: sanitizeButtons(buttons),
    createdAt: now(),
    updatedAt: now(),
  };
  await db.collection(COLLECTION).insertOne(doc);
  return doc;
}

export async function updatePanel(ctx, guildId, panelId, patch) {
  const db = await ctx.mongo.getDb();
  const $set = { updatedAt: now() };
  if (patch.channelId != null) $set.channelId = String(patch.channelId);
  if (patch.messageId != null) $set.messageId = String(patch.messageId);
  if (patch.embed != null) $set.embed = sanitizeEmbed(patch.embed);
  if (patch.buttons != null) $set.buttons = sanitizeButtons(patch.buttons);
  const res = await db.collection(COLLECTION).findOneAndUpdate(
    { guildId, panelId },
    { $set },
    { returnDocument: "after" }
  );
  return res.value;
}

export async function deletePanel(ctx, guildId, panelId) {
  const db = await ctx.mongo.getDb();
  await db.collection(COLLECTION).deleteOne({ guildId, panelId });
  return true;
}

export async function getPanel(ctx, guildId, panelId) {
  const db = await ctx.mongo.getDb();
  return db.collection(COLLECTION).findOne({ guildId, panelId });
}

export async function listPanels(ctx, guildId) {
  const db = await ctx.mongo.getDb();
  return db.collection(COLLECTION).find({ guildId }).toArray();
}

export async function linkMessage(ctx, guildId, panelId, { channelId, messageId }) {
  return updatePanel(ctx, guildId, panelId, { channelId, messageId });
}

// Helpers
function sanitizeEmbed(embed = {}) {
  const out = {};
  if (embed.title != null) out.title = String(embed.title).slice(0, 256);
  if (embed.description != null) out.description = String(embed.description).slice(0, 4096);
  return out;
}

function sanitizeButtons(buttons = []) {
  const allowedStyles = new Set(["Primary", "Secondary", "Success", "Danger"]);
  const result = [];
  for (const b of buttons) {
    if (!b?.label || !b?.typeId) continue;
    const style = allowedStyles.has(b.style) ? b.style : "Primary";
    result.push({ label: String(b.label).slice(0, 80), style, typeId: String(b.typeId) });
  }
  return result.slice(0, 5); // Discord row/button constraints; panels can be multiple rows later
}
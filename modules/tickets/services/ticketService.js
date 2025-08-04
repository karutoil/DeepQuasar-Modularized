// Ticket lifecycle service (create, control, close, archive, reopen)
// Persists tickets per guild in MongoDB; exposes index ensuring and helpers.

import { getGuildSettings } from "./settingsService.js";

const COLLECTION = "guild_tickets";

export async function ensureIndexes(ctx) {
  const { logger } = ctx;
  try {
    const db = await ctx.mongo.getDb();
    await db.collection(COLLECTION).createIndexes([
      { key: { guildId: 1, ticketId: 1 }, unique: true, name: "guild_ticket_unique" },
      { key: { guildId: 1, channelId: 1 }, unique: true, sparse: true, name: "guild_channel_unique" },
      { key: { guildId: 1, status: 1, lastActivityAt: 1 }, name: "status_activity_idx" },
      { key: { guildId: 1, openerId: 1, status: 1 }, name: "opener_status_idx" },
      { key: { guildId: 1, archivedAt: 1 }, name: "archived_idx" },
    ]);
    logger.info("[Tickets] ticket indexes ensured");
  } catch (e) {
    logger.warn("[Tickets] ticket index creation failed", { error: e?.message });
  }
}

function now() {
  return new Date();
}

function newTicketId() {
  // Simple sortable id: ts-rand
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createTicketDoc(ctx, { guildId, openerId, typeId, channelId, assigneeId, participantIds }) {
  const db = await ctx.mongo.getDb();
  const doc = {
    guildId,
    ticketId: newTicketId(),
    channelId,
    openerId,
    typeId: typeId || null,
    status: "open", // open | locked | closing | closed | archived
    assigneeId: assigneeId || null,
    participantIds: Array.from(new Set([openerId, ...(participantIds || [])])),
    createdAt: now(),
    updatedAt: now(),
    lastActivityAt: now(),
    closeReason: null,
    transcript: null, // { url, format }
    archivedAt: null,
    reopenUntil: null,
  };
  await db.collection(COLLECTION).insertOne(doc);
  return doc;
}

export async function getTicketByChannel(ctx, guildId, channelId) {
  const db = await ctx.mongo.getDb();
  return db.collection(COLLECTION).findOne({ guildId, channelId });
}

export async function getTicketById(ctx, guildId, ticketId) {
  const db = await ctx.mongo.getDb();
  return db.collection(COLLECTION).findOne({ guildId, ticketId });
}

export async function updateTicket(ctx, guildId, ticketId, patch = {}) {
  const db = await ctx.mongo.getDb();
  ctx.logger.debug("[Tickets] updateTicket db/collection", {
    dbName: db.databaseName,
    collectionName: COLLECTION
  });
  ctx.logger.debug("[Tickets] updateTicket types", {
    guildIdType: typeof guildId,
    ticketIdType: typeof ticketId,
    guildIdValue: guildId,
    ticketIdValue: ticketId
  });
  const query = { guildId, ticketId };
  const update = { $set: { ...patch, updatedAt: now() } };
  const opts = { returnDocument: "after" };
  ctx.logger.debug("[Tickets] updateTicket query", { query, update });
  const result = await db.collection(COLLECTION).findOneAndUpdate(query, update, opts);
  ctx.logger.debug("[Tickets] updateTicket result", { result });
  ctx.logger.debug("[Tickets] updateTicket raw result", { module: "tickets", result });
  ctx.logger.debug("[Tickets] updateTicket returned value", { module: "tickets", value: result });
  return result;
}

export async function recordActivity(ctx, guildId, ticketId) {
  return updateTicket(ctx, guildId, ticketId, { lastActivityAt: now() });
}

export async function addParticipant(ctx, guildId, ticketId, userId) {
  const db = await ctx.mongo.getDb();
  const res = await db.collection(COLLECTION).findOneAndUpdate(
    { guildId, ticketId },
    { $addToSet: { participantIds: userId }, $set: { updatedAt: now() } },
    { returnDocument: "after" }
  );
  return res.value;
}

export async function removeParticipant(ctx, guildId, ticketId, userId) {
  const db = await ctx.mongo.getDb();
  const res = await db.collection(COLLECTION).findOneAndUpdate(
    { guildId, ticketId },
    { $pull: { participantIds: userId }, $set: { updatedAt: now() } },
    { returnDocument: "after" }
  );
  return res.value;
}

export async function setLocked(ctx, guildId, ticketId, locked) {
  const status = locked ? "locked" : "open";
  return updateTicket(ctx, guildId, ticketId, { status });
}

export async function beginClosing(ctx, guildId, ticketId) {
  return updateTicket(ctx, guildId, ticketId, { status: "closing" });
}

export async function finalizeClosed(ctx, guildId, ticketId, { reason, transcript }) {
  return updateTicket(ctx, guildId, ticketId, {
    status: "closed",
    closeReason: reason || null,
    transcript: transcript || null,
    reopenUntil: new Date(Date.now() + (await getGuildSettings(ctx, guildId)).reopenMs),
  });
}

export async function reopenTicket(ctx, guildId, ticketId) {
  const t = await getTicketById(ctx, guildId, ticketId);
  if (!t) throw new Error("Ticket not found");
  if (t.status !== "closed") throw new Error("Ticket not closed");
  if (t.reopenUntil && t.reopenUntil.getTime() < Date.now()) throw new Error("Reopen window expired");
  return updateTicket(ctx, guildId, ticketId, { status: "open", archivedAt: null });
}

export async function archiveTicket(ctx, guildId, ticketId) {
  return updateTicket(ctx, guildId, ticketId, { status: "archived", archivedAt: now() });
}

export async function findInactiveTickets(ctx, guildId) {
  const { config } = ctx;
  const db = await ctx.mongo.getDb();
  // Use per-guild configured inactivityMs; fall back to env defaults
  const settings = await getGuildSettings(ctx, guildId);
  const threshold = new Date(Date.now() - settings.autoClosure.inactivityMs);
  return db
    .collection(COLLECTION)
    .find({ guildId, status: { $in: ["open", "locked"] }, lastActivityAt: { $lt: threshold } })
    .toArray();
}

export async function findWarningDueTickets(ctx, guildId) {
  const db = await ctx.mongo.getDb();
  const settings = await getGuildSettings(ctx, guildId);
  // Warn when lastActivityAt < (now - (inactivityMs - warningMs)) and still not closed
  const warnThreshold = new Date(Date.now() - (settings.autoClosure.inactivityMs - settings.autoClosure.warningMs));
  return db
    .collection(COLLECTION)
    .find({
      guildId,
      status: { $in: ["open", "locked"] },
      lastActivityAt: { $lt: warnThreshold },
      // naive filter to avoid multiple warnings: store warnedAt
      warnedAt: { $exists: false },
    })
    .toArray();
}

export async function markWarned(ctx, guildId, ticketId) {
  const db = await ctx.mongo.getDb();
  await db.collection(COLLECTION).updateOne(
    { guildId, ticketId },
    { $set: { warnedAt: now(), updatedAt: now() } }
  );
}

export async function listOpenTickets(ctx, guildId) {
  const db = await ctx.mongo.getDb();
  return db.collection(COLLECTION).find({ guildId, status: { $in: ["open", "locked", "closing"] } }).toArray();
}
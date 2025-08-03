// Type service: CRUD for ticket types per guild, with support role pings

const COLLECTION = "guild_ticket_types";

/**
 * Schema:
 * {
 *   guildId: string,
 *   typeId: string,           // unique per guild
 *   name: string,             // display name
 *   welcomeMessage: string,   // message posted at ticket creation
 *   pingRoleIds: string[],    // roles to ping on creation
 *   createdAt, updatedAt
 * }
 */

function now() { return new Date(); }
function newTypeId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`; }

export async function ensureIndexes(ctx) {
  const { logger } = ctx;
  try {
    const db = await ctx.mongo.getDb();
    await db.collection(COLLECTION).createIndexes([
      { key: { guildId: 1, typeId: 1 }, unique: true, name: "guild_type_unique" },
      // Enforce unique names per guild to prevent duplicates
      { key: { guildId: 1, name: 1 }, unique: true, name: "guild_type_name_unique" },
    ]);
    logger.info("[Tickets] type indexes ensured");
  } catch (e) {
    ctx.logger?.warn?.("[Tickets] type index creation failed", { error: e?.message });
  }
}

export async function createType(ctx, guildId, { name, welcomeMessage, pingRoleIds }) {
  const db = await ctx.mongo.getDb();

  // Normalize and validate
  const n = (name || "Support").toString().trim().slice(0, 100);
  const w = (welcomeMessage || "Thank you for opening a ticket. A support member will assist you shortly.").toString().trim().slice(0, 2000);
  const roles = Array.isArray(pingRoleIds) ? Array.from(new Set(pingRoleIds.map(String))) : [];

  if (!n || n.length === 0) {
    throw new Error("Type name is required");
  }

  // Prevent duplicates: case-insensitive per guild
  const existing = await db.collection(COLLECTION).findOne({ guildId, name: n });
  if (existing) {
    const err = new Error("Duplicate type name");
    err.code = "TYPE_DUPLICATE_NAME";
    throw err;
  }

  const doc = {
    guildId,
    typeId: newTypeId(),
    name: n,
    welcomeMessage: w,
    pingRoleIds: roles,
    createdAt: now(),
    updatedAt: now(),
  };
  await db.collection(COLLECTION).insertOne(doc);
  return doc;
}

export async function updateType(ctx, guildId, typeId, patch) {
  const db = await ctx.mongo.getDb();
  const $set = { updatedAt: now() };

  if (patch.name != null) {
    const n = String(patch.name).trim().slice(0, 100);
    if (!n) {
      const err = new Error("Type name cannot be empty");
      err.code = "TYPE_NAME_EMPTY";
      throw err;
    }
    // Prevent duplicates on rename
    const existing = await db.collection(COLLECTION).findOne({ guildId, name: n, typeId: { $ne: typeId } });
    if (existing) {
      const err = new Error("Duplicate type name");
      err.code = "TYPE_DUPLICATE_NAME";
      throw err;
    }
    $set.name = n;
  }

  if (patch.welcomeMessage != null) {
    $set.welcomeMessage = String(patch.welcomeMessage).trim().slice(0, 2000);
  }

  if (patch.pingRoleIds != null) {
    $set.pingRoleIds = Array.isArray(patch.pingRoleIds) ? Array.from(new Set(patch.pingRoleIds.map(String))) : [];
  }

  const res = await db.collection(COLLECTION).findOneAndUpdate(
    { guildId, typeId },
    { $set },
    { returnDocument: "after" }
  );
  return res.value;
}

/**
 * Convenience: set ping roles using a RoleSelect values array.
 */
export async function setTypePingRoles(ctx, guildId, typeId, roleIds = []) {
  return updateType(ctx, guildId, typeId, { pingRoleIds: Array.isArray(roleIds) ? roleIds : [] });
}

export async function deleteType(ctx, guildId, typeId) {
  const db = await ctx.mongo.getDb();
  await db.collection(COLLECTION).deleteOne({ guildId, typeId });
  return true;
}

export async function getType(ctx, guildId, typeId) {
  const db = await ctx.mongo.getDb();
  return db.collection(COLLECTION).findOne({ guildId, typeId });
}

export async function listTypes(ctx, guildId) {
  const db = await ctx.mongo.getDb();
  return db.collection(COLLECTION).find({ guildId }).toArray();
}
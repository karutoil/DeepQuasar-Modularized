const COLLECTION = "embed_templates";
const DEFAULT_LIMIT = 25;
const MAX_PER_GUILD = parseInt(process.env.EMBEDBUILDER_MAX_TEMPLATES || "50", 10);

export async function ensureIndexes(ctx) {
  const db = await ctx.mongo.getDb();
  await db.collection(COLLECTION).createIndex({ guildId: 1, key: 1 }, { unique: true, name: "guild_key_unique" });
  await db.collection(COLLECTION).createIndex({ guildId: 1, updatedAt: -1 }, { name: "guild_updated_desc" });
}

/**
 * Save or update a template for a guild.
 * Enforces per-guild max templates.
 * @returns { ok: true, data } | { ok: false, error }
 */
export async function save(ctx, guildId, key, payload, createdBy) {
  try {
    key = sanitizeKey(key);
    if (!key) return { ok: false, error: "Invalid key" };

    const db = await ctx.mongo.getDb();
    const coll = db.collection(COLLECTION);

    const existing = await coll.findOne({ guildId, key });
    if (!existing) {
      const count = await coll.countDocuments({ guildId });
      if (count >= MAX_PER_GUILD) return { ok: false, error: `Template limit reached (${MAX_PER_GUILD})` };
    }

    const now = new Date();
    const doc = {
      guildId,
      key,
      name: String(payload?.name ?? key).slice(0, 100),
      data: payload?.data ?? {},
      createdBy: existing?.createdBy ?? createdBy,
      updatedBy: createdBy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    await coll.updateOne(
      { guildId, key },
      { $set: doc },
      { upsert: true }
    );

    return { ok: true, data: doc };
  } catch (err) {
    ctx.logger?.error?.("[EmbedBuilder] save failed", { error: err?.message });
    return { ok: false, error: "Database error" };
  }
}

export async function get(ctx, guildId, key) {
  const db = await ctx.mongo.getDb();
  return db.collection(COLLECTION).findOne({ guildId, key });
}

export async function list(ctx, guildId, limit = DEFAULT_LIMIT) {
  const db = await ctx.mongo.getDb();
  const cur = db.collection(COLLECTION)
    .find({ guildId })
    .project({ _id: 0, key: 1, name: 1, updatedAt: 1 })
    .sort({ updatedAt: -1 })
    .limit(Math.max(1, Math.min(25, limit)));
  const rows = await cur.toArray();
  return rows.map(r => ({ key: r.key, name: r.name, updatedAt: r.updatedAt }));
}

export async function remove(ctx, guildId, key) {
  try {
    const db = await ctx.mongo.getDb();
    const res = await db.collection(COLLECTION).deleteOne({ guildId, key });
    if (res.deletedCount === 0) return { ok: false, error: "Not found" };
    return { ok: true };
  } catch (err) {
    ctx.logger?.error?.("[EmbedBuilder] remove failed", { error: err?.message });
    return { ok: false, error: "Database error" };
  }
}

export async function exportOne(ctx, guildId, key) {
  const doc = await get(ctx, guildId, key);
  if (!doc) return { ok: false, error: "Not found" };
  return {
    ok: true,
    data: {
      type: "discord-embed",
      version: 1,
      key: doc.key,
      name: doc.name,
      embed: doc.data?.data ?? {}
    }
  };
}

export async function importOne(ctx, guildId, json, keyOpt, createdBy) {
  try {
    const payload = typeof json === "string" ? JSON.parse(json) : json;
    const embed = payload.embed ?? payload;
    const key = sanitizeKey(keyOpt || payload.key || payload.name || "imported");
    const name = String(payload.name ?? key).slice(0, 100);
    const saved = await save(ctx, guildId, key, { name, data: embed }, createdBy);
    return saved;
  } catch (err) {
    return { ok: false, error: "Invalid JSON" };
  }
}

function sanitizeKey(k) {
  const s = String(k ?? "").toLowerCase().trim().replace(/[^a-z0-9-_]/g, "-");
  return s.slice(0, 64);
}
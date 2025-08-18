// Per-guild settings storage and validation for Tickets module
// Uses core/mongo.js collections; ensures indexes; provides cached getters.

// only for types; actual ctx provides core

const COLLECTION = "guild_ticket_settings";

// In-memory cache with simple TTL
const CACHE = new Map(); // guildId -> { data, expiresAt }
const CACHE_TTL_MS = 60_000;

export async function ensureIndexes(ctx) {
  const { logger } = ctx;
  try {
    const db = await ctx.mongo.getDb();
    await db.collection(COLLECTION).createIndexes([
      { key: { guildId: 1 }, unique: true, name: "guild_unique" },
    ]);
    logger.info("[Tickets] settings indexes ensured");
  } catch (e) {
    logger.warn("[Tickets] settings index creation failed", { error: e?.message });
  }
}

export function invalidateGuildSettingsCache(guildId) {
  CACHE.delete(guildId);
}

function defaultsFromEnv(env) {
  return {
    transcript: {
      format: (env.TICKETS_DEFAULT_TRANSCRIPT_FORMAT || "html").toLowerCase() === "text" ? "text" : "html",
      dmUser: String(env.TICKETS_DEFAULT_DM_TRANSCRIPT || "true").toLowerCase() === "true",
    },
    autoClosure: {
      inactivityMs: Number(env.TICKETS_DEFAULT_INACTIVITY_MS || 172800000), // 48h
      warningMs: Number(env.TICKETS_DEFAULT_WARNING_MS || 43200000), // 12h
      warningMessage: "This ticket will be closed due to inactivity. Reply to keep it open.",
    },
    reopenMs: Number(env.TICKETS_DEFAULT_REOPEN_MS || 86400000), // 24h
    limits: {
      perUser: Number(env.TICKETS_MAX_ACTIVE_PER_USER || 0),
      perGuild: Number(env.TICKETS_MAX_ACTIVE_PER_GUILD || 0),
    },
    ticketNameFormat: String(env.TICKETS_DEFAULT_NAME_FORMAT || "ticket-{userid}-{shortdate}"),
    dmNotifications: {
      assign: true,
      userAdded: true,
      userRemoved: true,
      close: true,
    },
  };
}

export function validateSettings(input, env) {
  const errors = [];
  const out = {};

  const d = defaultsFromEnv(env);

  // Channel/category/log/supportRoles
  if (input.ticketCategoryId != null) {
    if (typeof input.ticketCategoryId !== "string") errors.push("ticketCategoryId must be a string");
    out.ticketCategoryId = input.ticketCategoryId;
  }
  if (input.ticketLogChannelId != null) {
    if (typeof input.ticketLogChannelId !== "string") errors.push("ticketLogChannelId must be a string");
    out.ticketLogChannelId = input.ticketLogChannelId;
  }
  if (input.supportRoleIds != null) {
    if (!Array.isArray(input.supportRoleIds) || !input.supportRoleIds.every((x) => typeof x === "string")) {
      errors.push("supportRoleIds must be an array of role IDs");
    } else {
      out.supportRoleIds = Array.from(new Set(input.supportRoleIds));
    }
  }

  // Transcript
  const transcript = input.transcript || {};
  out.transcript = {
    format: transcript.format === "text" ? "text" : (transcript.format === "html" ? "html" : d.transcript.format),
    dmUser: typeof transcript.dmUser === "boolean" ? transcript.dmUser : d.transcript.dmUser,
  };

  // Ticket naming
  if (input.ticketNameFormat != null) {
    if (typeof input.ticketNameFormat !== "string" || input.ticketNameFormat.length > 200) {
      errors.push("ticketNameFormat must be a string up to 200 chars");
    } else {
      out.ticketNameFormat = input.ticketNameFormat;
    }
  }

  // Auto-closure
  const ac = input.autoClosure || {};
  const inactivityMs = ac.inactivityMs != null ? Number(ac.inactivityMs) : d.autoClosure.inactivityMs;
  const warningMs = ac.warningMs != null ? Number(ac.warningMs) : d.autoClosure.warningMs;
  if (!(inactivityMs > 0)) errors.push("autoClosure.inactivityMs must be a positive number");
  if (!(warningMs >= 0 && warningMs < inactivityMs)) errors.push("autoClosure.warningMs must be >= 0 and less than inactivityMs");
  out.autoClosure = {
    inactivityMs,
    warningMs,
    warningMessage: typeof ac.warningMessage === "string" && ac.warningMessage.length <= 2000
      ? ac.warningMessage
      : d.autoClosure.warningMessage,
  };

  // DM notifications
  const dm = input.dmNotifications || {};
  out.dmNotifications = {
    assign: typeof dm.assign === "boolean" ? dm.assign : d.dmNotifications.assign,
    userAdded: typeof dm.userAdded === "boolean" ? dm.userAdded : d.dmNotifications.userAdded,
    userRemoved: typeof dm.userRemoved === "boolean" ? dm.userRemoved : d.dmNotifications.userRemoved,
    close: typeof dm.close === "boolean" ? dm.close : d.dmNotifications.close,
  };
 
  // Reopen window
  const reopenMs = input.reopenMs != null ? Number(input.reopenMs) : d.reopenMs;
  if (!(reopenMs >= 0)) errors.push("reopenMs must be >= 0");
  out.reopenMs = reopenMs;
 
  // Limits
  const limits = input.limits || {};
  const perUser = limits.perUser != null ? Number(limits.perUser) : d.limits.perUser;
  const perGuild = limits.perGuild != null ? Number(limits.perGuild) : d.limits.perGuild;
  if (!(perUser >= 0)) errors.push("limits.perUser must be >= 0");
  if (!(perGuild >= 0)) errors.push("limits.perGuild must be >= 0");
  out.limits = { perUser, perGuild };
 
  return { ok: errors.length === 0, errors, value: out };
}

function mergeWithDefaults(doc, env) {
  const d = defaultsFromEnv(env);
  const copy = { ...doc };

  copy.transcript = {
    format: doc?.transcript?.format || d.transcript.format,
    dmUser: typeof doc?.transcript?.dmUser === "boolean" ? doc.transcript.dmUser : d.transcript.dmUser,
  };
  copy.autoClosure = {
    inactivityMs: Number(doc?.autoClosure?.inactivityMs || d.autoClosure.inactivityMs),
    warningMs: Number(doc?.autoClosure?.warningMs || d.autoClosure.warningMs),
    warningMessage: doc?.autoClosure?.warningMessage || d.autoClosure.warningMessage,
  };
  copy.reopenMs = Number(doc?.reopenMs || d.reopenMs);
  copy.limits = {
    perUser: Number(doc?.limits?.perUser ?? d.limits.perUser),
    perGuild: Number(doc?.limits?.perGuild ?? d.limits.perGuild),
  };

  // Ticket naming format
  copy.ticketNameFormat = typeof doc?.ticketNameFormat === "string" && doc.ticketNameFormat.length
    ? doc.ticketNameFormat
    : d.ticketNameFormat;

  // DM notifications defaults
  copy.dmNotifications = {
    assign: typeof doc?.dmNotifications?.assign === "boolean" ? doc.dmNotifications.assign : d.dmNotifications.assign,
    userAdded: typeof doc?.dmNotifications?.userAdded === "boolean" ? doc.dmNotifications.userAdded : d.dmNotifications.userAdded,
    userRemoved: typeof doc?.dmNotifications?.userRemoved === "boolean" ? doc.dmNotifications.userRemoved : d.dmNotifications.userRemoved,
    close: typeof doc?.dmNotifications?.close === "boolean" ? doc.dmNotifications.close : d.dmNotifications.close,
  };

  // Normalize arrays
  copy.supportRoleIds = Array.isArray(doc?.supportRoleIds) ? Array.from(new Set(doc.supportRoleIds)) : [];

  return copy;
}

export async function getGuildSettings(ctx, guildId) {
  const { config } = ctx;
  const now = Date.now();
  const cached = CACHE.get(guildId);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }
  const db = await ctx.mongo.getDb();
  const doc = await db.collection(COLLECTION).findOne({ guildId });
  const withDefaults = mergeWithDefaults(doc || { guildId }, config.env || process.env);
  CACHE.set(guildId, { data: withDefaults, expiresAt: now + CACHE_TTL_MS });
  return withDefaults;
}

export async function upsertGuildSettings(ctx, guildId, input) {
  const { logger, config } = ctx;
  const { ok, errors, value } = validateSettings(input || {}, config.env || process.env);
  if (!ok) {
    const err = new Error("Invalid settings: " + errors.join("; "));
    err.details = errors;
    throw err;
  }
  const db = await ctx.mongo.getDb();
  await db.collection(COLLECTION).updateOne(
    { guildId },
    { $set: { guildId, ...value, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
  invalidateGuildSettingsCache(guildId);
  logger.info("[Tickets] settings upserted", { guildId });
  return getGuildSettings(ctx, guildId);
}

export async function setGeneralSettings(ctx, guildId, { ticketCategoryId, ticketLogChannelId, supportRoleIds }) {
  const current = await getGuildSettings(ctx, guildId);
  return upsertGuildSettings(ctx, guildId, {
    ...current,
    ticketCategoryId,
    ticketLogChannelId,
    supportRoleIds,
  });
}
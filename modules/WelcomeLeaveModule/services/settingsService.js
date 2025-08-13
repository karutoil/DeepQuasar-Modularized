// Per-guild settings storage and validation for WelcomeLeaveModule
// Uses core/mongo.js collections; ensures indexes; provides cached getters.

import { validate as validateEmbed } from "../../embedbuilder/utils/schema.js";

const COLLECTION = "guild_welcomeleave_settings";

// In-memory cache with simple TTL
const CACHE = new Map(); // guildId -> { data, expiresAt }
const CACHE_TTL_MS = 60_000;

/**
 * Ensure MongoDB indexes for efficient guild lookups.
 * @param {object} ctx - Core context (must provide logger, mongo)
 */
export async function ensureIndexes(ctx) {
  const { logger } = ctx;
  try {
    const db = await ctx.mongo.getDb();
    await db.collection(COLLECTION).createIndexes([
      { key: { guildId: 1 }, unique: true, name: "guild_unique" },
    ]);
    logger.info("[WelcomeLeave] settings indexes ensured");
  } catch (e) {
    logger.warn("[WelcomeLeave] settings index creation failed", { error: e?.message });
  }
}

/**
 * Invalidate the in-memory cache for a guild.
 * @param {string} guildId
 */
export function invalidateGuildSettingsCache(guildId) {
  CACHE.delete(guildId);
}

/**
 * Default settings for a guild.
 * @returns {object}
 */
export function defaultSettings() {
  return {
    welcome: {
      enabled: false,
      channelId: null,
      embed: {
        title: "🎉 Welcome to {server}!",
        description:
          "Hey {user.mention}, we're thrilled to have you join us!\n\n" +
          "• **Username:** {user.name}\n" +
          "• **Member Count:** {count}\n\n" +
          "Feel free to introduce yourself and check out the channels. Enjoy your stay!",
        color: 0x57f287, // Discord green
        thumbnail: "{server.icon}",
        image: "https://cdn.discordapp.com/attachments/1100000000000000000/1100000000000000000/welcome_banner.png",
        footerText: "Welcome to {server} • ID: {server.id}",
        footerIcon: "{server.icon}",
        authorName: "{server}",
        authorIcon: "{server.icon}",
        fields: [
          {
            name: "Getting Started",
            value: "Check out the #rules and #introductions channels to get started!",
            inline: false,
          },
          {
            name: "Need Help?",
            value: "Ask any questions in #help or DM a moderator.",
            inline: false,
          },
        ],
      },
    },
    leave: {
      enabled: false,
      channelId: null,
      embed: {
        title: "👋 {user.name} has left {server}",
        description:
          "We're sad to see you go, {user.name}.\n\n" +
          "• **User Tag:** {user.tag}\n" +
          "• **Member Count:** {count}\n\n" +
          "We hope you enjoyed your time here. If you have feedback, let us know!",
        color: 0xed4245, // Discord red
        thumbnail: "{server.icon}",
        image: "https://cdn.discordapp.com/attachments/1100000000000000000/1100000000000000000/leave_banner.png",
        footerText: "Goodbye from {server} • ID: {server.id}",
        footerIcon: "{server.icon}",
        authorName: "{server}",
        authorIcon: "{server.icon}",
        fields: [
          {
            name: "Farewell",
            value: "We wish you all the best!",
            inline: false,
          },
        ],
      },
    },
    // For future extensibility, add new fields here
  };
}

/**
 * Validate and normalize input settings.
 * @param {object} input
 * @param {object} ctx
 * @returns {{ ok: boolean, errors: string[], value: object }}
 */
export function validateSettings(input, ctx) {
  const errors = [];
  const out = {};
  const d = defaultSettings();
  const i18n = ctx?.i18n;

  // Welcome settings
  const welcome = input.welcome || {};
  let welcomeEmbed = welcome.embed == null ? d.welcome.embed
    : (typeof welcome.embed === "object" ? welcome.embed : (errors.push(i18n?.t
      ? i18n.t("welcomeleave:settings_invalid_embed_type", "welcome.embed must be an object or null")
      : "welcome.embed must be an object or null"), d.welcome.embed));
  if (welcomeEmbed && typeof welcomeEmbed === "object") {
    const result = validateEmbed(welcomeEmbed);
    if (!result.ok) {
      errors.push(i18n?.t
        ? i18n.t("welcomeleave:settings_invalid_embed", "Invalid welcome embed: {error}", { error: result.error })
        : `Invalid welcome embed: ${result.error}`);
      welcomeEmbed = d.welcome.embed;
    } else {
      welcomeEmbed = result.embed;
    }
  }
  out.welcome = {
    enabled: typeof welcome.enabled === "boolean" ? welcome.enabled : d.welcome.enabled,
    channelId: welcome.channelId == null ? d.welcome.channelId
      : (typeof welcome.channelId === "string" ? welcome.channelId : (errors.push(i18n?.t
        ? i18n.t("welcomeleave:settings_invalid_channel", "welcome.channelId must be a string or null")
        : "welcome.channelId must be a string or null"), d.welcome.channelId)),
    embed: welcomeEmbed,
  };

  // Leave settings
  const leave = input.leave || {};
  let leaveEmbed = leave.embed == null ? d.leave.embed
    : (typeof leave.embed === "object" ? leave.embed : (errors.push(i18n?.t
      ? i18n.t("welcomeleave:settings_invalid_embed_type", "leave.embed must be an object or null")
      : "leave.embed must be an object or null"), d.leave.embed));
  if (leaveEmbed && typeof leaveEmbed === "object") {
    const result = validateEmbed(leaveEmbed);
    if (!result.ok) {
      errors.push(i18n?.t
        ? i18n.t("welcomeleave:settings_invalid_embed", "Invalid leave embed: {error}", { error: result.error })
        : `Invalid leave embed: ${result.error}`);
      leaveEmbed = d.leave.embed;
    } else {
      leaveEmbed = result.embed;
    }
  }
  out.leave = {
    enabled: typeof leave.enabled === "boolean" ? leave.enabled : d.leave.enabled,
    channelId: leave.channelId == null ? d.leave.channelId
      : (typeof leave.channelId === "string" ? leave.channelId : (errors.push(i18n?.t
        ? i18n.t("welcomeleave:settings_invalid_channel", "leave.channelId must be a string or null")
        : "leave.channelId must be a string or null"), d.leave.channelId)),
    embed: leaveEmbed,
  };

  // Future extensible fields: copy any additional keys as-is
  for (const key of Object.keys(input)) {
    if (!(key in out)) {
      out[key] = input[key];
    }
  }

  return { ok: errors.length === 0, errors, value: out };
}

/**
 * Merge a DB document with defaults, ensuring all fields are present.
 * @param {object} doc
 * @returns {object}
 */
function mergeWithDefaults(doc) {
  const d = defaultSettings();
  const copy = { ...d, ...doc };

  // Welcome
  copy.welcome = {
    enabled: typeof doc?.welcome?.enabled === "boolean" ? doc.welcome.enabled : d.welcome.enabled,
    channelId: typeof doc?.welcome?.channelId === "string" ? doc.welcome.channelId : d.welcome.channelId,
    embed: typeof doc?.welcome?.embed === "object" && doc.welcome.embed !== null ? doc.welcome.embed : d.welcome.embed,
  };

  // Leave
  copy.leave = {
    enabled: typeof doc?.leave?.enabled === "boolean" ? doc.leave.enabled : d.leave.enabled,
    channelId: typeof doc?.leave?.channelId === "string" ? doc.leave.channelId : d.leave.channelId,
    embed: typeof doc?.leave?.embed === "object" && doc.leave.embed !== null ? doc.leave.embed : d.leave.embed,
  };

  // Copy any additional fields
  for (const key of Object.keys(doc || {})) {
    if (!(key in copy)) {
      copy[key] = doc[key];
    }
  }

  return copy;
}

/**
 * Get settings for a guild (with cache).
 * @param {object} ctx - Core context (must provide config, mongo)
 * @param {string} guildId
 * @returns {Promise<object>}
 */
export async function getGuildSettings(ctx, guildId) {
  const { logger } = ctx;
  const now = Date.now();
  const cached = CACHE.get(guildId);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }
  const db = await ctx.mongo.getDb();
  const doc = await db.collection(COLLECTION).findOne({ guildId });
  const withDefaults = mergeWithDefaults(doc || { guildId });
  CACHE.set(guildId, { data: withDefaults, expiresAt: now + CACHE_TTL_MS });
  logger.debug?.("[WelcomeLeave] settings cache miss", { guildId });
  return withDefaults;
}

/**
 * Upsert (create or update) settings for a guild.
 * @param {object} ctx - Core context (must provide logger, config, i18n, mongo)
 * @param {string} guildId
 * @param {object} input
 * @returns {Promise<object>}
 */
export async function upsertGuildSettings(ctx, guildId, input) {
  const { logger, i18n } = ctx;
  // Fetch current settings and merge input
  const current = await getGuildSettings(ctx, guildId);
  // Merge input into current settings (shallow merge for top-level keys)
  const merged = { ...current, ...input };
  const { ok, errors, value } = validateSettings(merged, ctx);
  if (!ok) {
    const errMsg = i18n?.t
      ? i18n.t("welcomeleave:settings_invalid", { errors: errors.join("; ") })
      : "Invalid settings: " + errors.join("; ");
    logger.warn("[WelcomeLeave] settings validation failed", { guildId, errors });
    const err = new Error(errMsg);
    err.details = errors;
    throw err;
  }
  const db = await ctx.mongo.getDb();
  // Remove createdAt from value to avoid MongoDB update conflict
  const updateValue = { guildId, ...value, updatedAt: new Date() };
  if ("createdAt" in updateValue) {
    delete updateValue.createdAt;
  }
  await db.collection(COLLECTION).updateOne(
    { guildId },
    { $set: updateValue, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
  invalidateGuildSettingsCache(guildId);
  logger.info("[WelcomeLeave] settings upserted", { guildId });
  return getGuildSettings(ctx, guildId);
}

/**
 * Delete settings for a guild.
 * @param {object} ctx - Core context (must provide logger, mongo)
 * @param {string} guildId
 * @returns {Promise<boolean>}
 */
export async function deleteGuildSettings(ctx, guildId) {
  const { logger } = ctx;
  const db = await ctx.mongo.getDb();
  const res = await db.collection(COLLECTION).deleteOne({ guildId });
  invalidateGuildSettingsCache(guildId);
  logger.info("[WelcomeLeave] settings deleted", { guildId });
  return res.deletedCount > 0;
}
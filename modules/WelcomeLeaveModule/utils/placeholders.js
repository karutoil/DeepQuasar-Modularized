/**
 * placeholders.js
 * Utility to replace placeholders in Discord embed payloads for WelcomeLeaveModule.
 * Supports extensible placeholder mapping and recursive embed traversal.
 */

const PLACEHOLDERS = [
  // User
  { key: "{user}", fn: (ctx) => ctx.member?.displayName || ctx.member?.user?.username || "" },
  { key: "{user.mention}", fn: (ctx) => ctx.member ? `<@${ctx.member.id}>` : "" },
  { key: "{user.name}", fn: (ctx) => ctx.member?.user?.username || "" },
  { key: "{user.tag}", fn: (ctx) => ctx.member?.user ? `${ctx.member.user.username}#${ctx.member.user.discriminator ?? ctx.member.user.discrim ?? ""}` : "" },
  { key: "{user.id}", fn: (ctx) => ctx.member?.id || ctx.member?.user?.id || "" },
  { key: "{user.avatar}", fn: (ctx) => ctx.member?.user?.avatarURL?.() || ctx.member?.user?.avatar || "" },
  { key: "{user.createdAt}", fn: (ctx) => ctx.member?.user?.createdAt?.toISOString?.() || ctx.member?.user?.createdAt || "" },
  { key: "{user.joinedAt}", fn: (ctx) => ctx.member?.joinedAt?.toISOString?.() || ctx.member?.joinedAt || "" },
  { key: "{user.roles}", fn: (ctx) => ctx.member?.roles?.cache?.map?.(r => r.name).join(", ") || ctx.member?.roles?.join?.(", ") || "" },
  { key: "{user.highestRole}", fn: (ctx) => ctx.member?.roles?.highest?.name || "" },
  { key: "{user.bot}", fn: (ctx) => ctx.member?.user?.bot ? "Yes" : "No" },

  // Server
  { key: "{server}", fn: (ctx) => ctx.guild?.name || "" },
  { key: "{server.id}", fn: (ctx) => ctx.guild?.id || "" },
  { key: "{server.icon}", fn: (ctx) => ctx.guild?.iconURL?.() || ctx.guild?.icon || "" },
  { key: "{server.memberCount}", fn: (ctx) => ctx.guild?.memberCount?.toString() || "" },
  { key: "{count}", fn: (ctx) => ctx.guild?.memberCount?.toString() || "" },
  { key: "{memberCount}", fn: (ctx) => ctx.guild?.memberCount?.toString() || "" },
  { key: "{server.boostCount}", fn: (ctx) => ctx.guild?.premiumSubscriptionCount?.toString() || "" },
  { key: "{server.boostTier}", fn: (ctx) => ctx.guild?.premiumTier?.toString() || "" },
  { key: "{server.owner}", fn: (ctx) => ctx.guild?.owner?.user?.username || ctx.guild?.owner?.username || "" },
  { key: "{server.owner.mention}", fn: (ctx) => ctx.guild?.ownerId ? `<@${ctx.guild.ownerId}>` : "" },

  // Channel
  { key: "{channel}", fn: (ctx) => ctx.channel?.name || "" },
  { key: "{channel.name}", fn: (ctx) => ctx.channel?.name || "" },
  { key: "{channel.id}", fn: (ctx) => ctx.channel?.id || "" },

  // Time/Date
  { key: "{time}", fn: (ctx) => new Date().toLocaleTimeString(ctx.i18n?.locale || "en-US") },
  { key: "{date}", fn: (ctx) => new Date().toLocaleDateString(ctx.i18n?.locale || "en-US") },

  // Position
  { key: "{position}", fn: (ctx) => ctx.position?.toString() || "" },

  // Inviter
  { key: "{inviter}", fn: (ctx) => ctx.inviter?.username || "" },
  { key: "{inviter.mention}", fn: (ctx) => ctx.inviter ? `<@${ctx.inviter.id}>` : "" },
  { key: "{inviter.id}", fn: (ctx) => ctx.inviter?.id || "" },
  { key: "{inviter.tag}", fn: (ctx) => ctx.inviter ? `${ctx.inviter.username}#${ctx.inviter.discriminator ?? ctx.inviter.discrim ?? ""}` : "" },

  // Invite
  { key: "{invite.code}", fn: (ctx) => ctx.invite?.code || "" },
  { key: "{invite.uses}", fn: (ctx) => ctx.invite?.uses?.toString() || "" },
];

export { PLACEHOLDERS };

/**
 * Replace all supported placeholders in a string with real values from context.
 * @param {string} str
 * @param {object} context
 * @param {object} ctx - Context for logger/i18n
 * @returns {string}
 */
function replaceInString(str, context, ctx) {
  if (typeof str !== "string") return str;
  let result = str;
  for (const { key, fn } of PLACEHOLDERS) {
    try {
      // Use RegExp to replace all occurrences, not just the first
      result = result.replace(new RegExp(escapeRegExp(key), "g"), fn(context) ?? "");
    } catch (err) {
      ctx?.logger?.warn?.(`Placeholder error for ${key}: ${err?.message || err}`);
      // Optionally, localize error for user-facing fields
      if (ctx?.i18n) {
        result = result.replace(new RegExp(escapeRegExp(key), "g"), ctx.i18n.t("placeholders.error", { key }));
      }
    }
  }
  return result;
}

/**
 * Recursively replace placeholders in all string fields of an embed object.
 * @param {object} embed - The embed payload (may be mutated)
 * @param {object} context - { member, guild, channel, inviter, invite, ... }
 * @param {object} ctx - Context for logger/i18n
 * @returns {object} - New embed object with placeholders replaced
 */
export function replacePlaceholders(embed, context, ctx) {
  if (!embed || typeof embed !== "object") return embed;
  // Deep clone to avoid mutating original
  const clone = Array.isArray(embed) ? [] : {};
  for (const key in embed) {
    if (!Object.prototype.hasOwnProperty.call(embed, key)) continue;
    const value = embed[key];
    if (typeof value === "string") {
      clone[key] = replaceInString(value, context, ctx);
    } else if (Array.isArray(value)) {
      clone[key] = value.map(v => (typeof v === "object" ? replacePlaceholders(v, context, ctx) : replaceInString(v, context, ctx)));
    } else if (value && typeof value === "object") {
      clone[key] = replacePlaceholders(value, context, ctx);
    } else {
      clone[key] = value;
    }
  }
  return clone;
}

/**
 * Escape RegExp special characters in a string.
 * @param {string} s
 * @returns {string}
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
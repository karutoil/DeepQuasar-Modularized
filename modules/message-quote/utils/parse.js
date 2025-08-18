/**
 * Parsing helpers for Discord message links.
 * Scope: https://discord.com/channels/<guild_id>/<channel_id>/<message_id>
 */

const LINK_REGEX = /https?:\/\/(?:canary\.|ptb\.)?discord\.com\/channels\/(?<guildId>\d+)\/(?<channelId>\d+)\/(?<messageId>\d+)/g;

/**
 * Extract valid link triplets from message content.
 * @param {string} content
 * @returns {{ guildId: string, channelId: string, messageId: string, raw: string }[]}
 */
export function parseLinksFromContent(content) {
  const results = [];
  if (!content || typeof content !== "string") return results;

  let match;
  while ((match = LINK_REGEX.exec(content)) !== null) {
    const { guildId, channelId, messageId } = match.groups || {};
    if (guildId && channelId && messageId) {
      results.push({ guildId, channelId, messageId, raw: match[0] });
    }
  }
  return results;
}

/**
 * Same guild validation.
 * @param {string} linkGuildId
 * @param {string} currentGuildId
 */
export function isSameGuild(linkGuildId, currentGuildId) {
  return String(linkGuildId) === String(currentGuildId);
}

/**
 * Check if content contains only links and whitespace/punctuation.
 * Used to decide deletion of the original link-only message.
 * @param {string} content
 * @param {Array} parsed
 */
export function isOnlyLinksContent(content, parsed) {
  if (!content) return false;
  if (!parsed?.length) return false;

  let remainder = content;
  for (const p of parsed) {
    remainder = remainder.split(p.raw).join("");
  }

  // Remove whitespace and trivial punctuation around links
  const cleaned = remainder.replace(/[\s,.;:()[\]\-_=+*~`'"]+/g, "");
  return cleaned.length === 0;
}
/**
 * Embed builders for the Message Quote module.
 * Uses ctx.embed theme helpers and enforces Discord limits.
 */

import { t } from "./i18n.js";

// Discord embed limits (practical caps with safety margins)
const MAX_DESC = 4096;
const MAX_AUTHOR_NAME = 256;

/**
 * Truncate a string to max length with ellipsis if needed.
 * @param {string} s
 * @param {number} max
 */
function truncate(s, max) {
  if (!s) return s;
  const str = String(s);
  if (str.length <= max) return str;
  if (max <= 1) return str.slice(0, max);
  return str.slice(0, max - 1) + "…";
}

/**
 * Build the small header embed: "Quoted by {username}" with their avatar as author icon.
 * @param {any} ctx
 * @param {import('discord.js').User} quoter
 */
export function buildHeaderEmbed(ctx, quoter) {
  const name = quoter?.username ?? "User";
  const icon = quoter?.displayAvatarURL?.({ size: 64 }) ?? quoter?.avatarURL?.({ size: 64 });
  const title = t(ctx, "message-quote.header.quotedBy", { username: name });

  // Use a neutral/info theme, small header-only embed, without timestamps
  return ctx.embed.info({
    title,
    author: icon ? { name, iconURL: icon } : { name }
    // No footer or timestamp to keep the header minimal and time-free
  });
}

/**
 * Build the main quote embed with:
 * - Original author's display name and avatar in author field
 * - Original message content (truncated)
 * - Timestamp of the original message
 * - Channel mention and compact message id reference
 * - Optional image
 *
 * @param {any} ctx
 * @param {import('discord.js').Message} srcMsg
 * @param {import('discord.js').TextBasedChannel} channel
 * @param {{ imageUrl?: string }} opts
 */
export function buildQuoteEmbed(ctx, srcMsg, channel, { imageUrl } = {}) {
  const authorUser = srcMsg.author;
  const authorName = authorUser?.globalName || authorUser?.displayName || authorUser?.username || "User";
  const authorIcon = authorUser?.displayAvatarURL?.({ size: 128 }) ?? authorUser?.avatarURL?.({ size: 128 });
  const description = truncate(srcMsg.content ?? "", MAX_DESC);

  const channelMention = channel?.toString?.() ?? `#${channel?.name ?? "unknown"}`;
  const compactId = srcMsg.id?.slice?.(-6) ?? srcMsg.id;

  // Build fields (no timestamp or footer per requirement)
  const fields = [
    {
      name: t(ctx, "message-quote.main.channel"),
      value: `${channelMention} · ${t(ctx, "message-quote.main.messageId", { id: compactId })}`,
      inline: true
    }
  ];

  // The core embed factory (core/embed.js) expects a flat 'image' string, not an object.
  // Passing an object triggers Shapeshift validation errors via EmbedBuilder.setImage.
  const safeImage = typeof imageUrl === "string" && imageUrl.trim().length > 0 ? imageUrl.trim() : undefined;

  return ctx.embed.neutral({
    description: description || t(ctx, "message-quote.main.noContent"),
    author: authorIcon ? { name: truncate(authorName, MAX_AUTHOR_NAME), iconURL: authorIcon } : { name: truncate(authorName, MAX_AUTHOR_NAME) },
    image: safeImage,
    fields,
    url: srcMsg.url
  });
}

/**
 * Build single-link button component to jump to the original message.
 * Uses a Link-style button (no customId needed).
 * @param {any} ctx
 * @param {string} url
 */
export function buildComponents(ctx, url) {
  // Build ActionRow + Link Button payload manually to avoid relying on v2 builder for simple link
  return [
    {
      type: 1, // ActionRow
      components: [
        {
          type: 2, // Button
          style: 5, // Link
          label: t(ctx, "message-quote.button.goTo"),
          url
        }
      ]
    }
  ];
}
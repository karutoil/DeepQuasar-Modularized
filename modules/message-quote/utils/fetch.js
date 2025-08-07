/**
 * Permission checks and safe message fetching with retries/backoff.
 */

import { ChannelType, PermissionsBitField } from "discord.js";

/**
 * Determine if the bot can read a given channel in the guild.
 * Verifies ViewChannel and ReadMessageHistory.
 * @param {any} ctx
 * @param {string} channelId
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{ ok: boolean, missing: string[], channel?: import('discord.js').GuildBasedChannel }>}
 */
export async function canReadChannel(ctx, channelId, guild) {
  const missing = [];
  try {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return { ok: false, missing: ["ViewChannel", "ReadMessageHistory"] };

    // Only allow text-based guild channels
    const allowedTypes = new Set([
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
      ChannelType.AnnouncementThread
    ]);
    if (!allowedTypes.has(channel.type)) {
      return { ok: false, missing: ["ViewChannel", "ReadMessageHistory"] };
    }

    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    if (!me) return { ok: false, missing: ["ViewChannel", "ReadMessageHistory"] };

    const perms = channel.permissionsFor(me);
    if (!perms) return { ok: false, missing: ["ViewChannel", "ReadMessageHistory"] };

    if (!perms.has(PermissionsBitField.Flags.ViewChannel)) missing.push("ViewChannel");
    if (!perms.has(PermissionsBitField.Flags.ReadMessageHistory)) missing.push("ReadMessageHistory");

    // Also ensure we can send embeds in the destination channel (where we reply), but reply happens in msg.channel
    // That check is performed implicitly by Discord on send; error path will show if missing. We keep focus on source read perms here.

    return { ok: missing.length === 0, missing, channel };
  } catch {
    return { ok: false, missing: ["ViewChannel", "ReadMessageHistory"] };
  }
}

/**
 * Fetch a message from a channel with minimal retries for transient errors.
 * @param {any} ctx
 * @param {string} channelId
 * @param {string} messageId
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{ ok: boolean, message?: import('discord.js').Message, channel?: any }>}
 */
export async function fetchMessageWithPerms(ctx, channelId, messageId, guild) {
  try {
    const chanRes = await canReadChannel(ctx, channelId, guild);
    if (!chanRes.ok || !chanRes.channel) return { ok: false };

    const channel = chanRes.channel;
    const maxAttempts = 3;
    let attempt = 0;
    let lastErr = null;

    while (attempt < maxAttempts) {
      try {
        const msg = await channel.messages.fetch(messageId);
        if (msg) return { ok: true, message: msg, channel };
      } catch (e) {
        lastErr = e;
        // 404 or unknown message/channel: do not retry further
        const code = e?.status ?? e?.code;
        if (code === 404 || code === 10008 /* Unknown Message */ || code === 50001 /* Missing Access */) break;
        // small backoff
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
      }
      attempt++;
    }

    if (lastErr) {
      ctx.logger?.debug?.("[MessageQuote] fetchMessage failed", { error: lastErr?.message });
    }
    return { ok: false };
  } catch (err) {
    ctx.logger?.debug?.("[MessageQuote] fetchMessage exception", { error: err?.message });
    return { ok: false };
  }
}
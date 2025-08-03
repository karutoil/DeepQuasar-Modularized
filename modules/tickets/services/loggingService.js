// Standardized logging utilities for Tickets module
import { EmbedBuilder } from "discord.js";
import { getGuildSettings } from "./settingsService.js";

export async function sendLog(ctx, guildId, { title, description, color = 0x2f3136, fields = [], footer, timestamp = true }) {
  const { client, logger } = ctx;
  try {
    const settings = await getGuildSettings(ctx, guildId);
    const channelId = settings.ticketLogChannelId;
    if (!channelId) return false;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.send) return false;

    const embed = new EmbedBuilder().setColor(color);
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    if (fields?.length) embed.setFields(fields.slice(0, 25));
    if (timestamp) embed.setTimestamp(new Date());
    if (footer) embed.setFooter(footer);

    await channel.send({ embeds: [embed] });
    return true;
  } catch (e) {
    logger.warn("[Tickets] sendLog failed", { guildId, error: e?.message });
    return false;
  }
}

export function formatUser(user) {
  if (!user) return "Unknown User";
  return `${user.tag ?? user.username ?? user.id} (${user.id})`;
}

export function formatChannel(channel) {
  if (!channel) return "Unknown Channel";
  return `#${channel.name ?? channel.id} (${channel.id})`;
}
// Standardized logging utilities for Tickets module
import { EmbedBuilder } from "discord.js";
import { getGuildSettings } from "./settingsService.js";

/**
 * Append a standardized "Ticket" field with value "<#channelId> · ID: ticketId" (inline)
 * If either channelId or ticketId is missing, falls back to "ID: ticketId" or "Channel: <#channelId>"
 */
export function withTicketField(fields = [], ticketCtx = {}) {
  try {
    const safeFields = Array.isArray(fields) ? [...fields] : [];
    const channelId = ticketCtx?.channelId;
    const ticketId = ticketCtx?.ticketId;
    let value = null;
    if (channelId && ticketId) {
      value = `<#${channelId}> · ID: ${ticketId}`;
    } else if (channelId) {
      value = `<#${channelId}>`;
    } else if (ticketId) {
      value = `ID: ${ticketId}`;
    }
    if (value) {
      // Ensure we don't exceed 25 fields; reserve one slot by trimming first if needed
      const trimmed = safeFields.slice(0, 24);
      trimmed.push({ name: "Ticket", value, inline: true });
      return trimmed;
    }
    return safeFields.slice(0, 25);
  } catch {
    // On any unexpected error, just return original fields bounded to 25
    return (Array.isArray(fields) ? fields : []).slice(0, 25);
  }
}

export async function sendLog(ctx, guildId, { title, description, color = 0x2f3136, fields = [], footer, timestamp = true, ticket }) {
  const { client, logger } = ctx;
  try {
    const settings = await getGuildSettings(ctx, guildId);
    const channelId = settings.ticketLogChannelId;
    if (!channelId) return false;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.send) return false;

    // Attach standardized Ticket field if ticket context provided
    const finalFields = ticket ? withTicketField(fields, ticket) : (fields?.slice(0, 25) || []);

    const embed = new EmbedBuilder().setColor(color);
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    if (finalFields?.length) embed.setFields(finalFields);
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
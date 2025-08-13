// WelcomeLeaveModule member join/leave event handlers
import { getGuildSettings } from "../services/settingsService.js";
import { validate as validateEmbed } from "../../embedbuilder/utils/schema.js";
import { replacePlaceholders } from "../utils/placeholders.js";

/**
 * Register member event listeners for welcome/leave messages.
 * @param {object} ctx - Core context (must provide logger, i18n, client)
 */
export function registerMemberEventHandlers(ctx) {
  const { logger, i18n, client } = ctx;


  // --- Handler: Member Join ---
  client.on("guildMemberAdd", async (member) => {
    try {
      const guildId = member.guild.id;
      const settings = await getGuildSettings(ctx, guildId);
      const welcome = settings?.welcome;
      if (!welcome?.enabled || !welcome?.channelId || !welcome?.embed) return;

      const channel = member.guild.channels.cache.get(welcome.channelId);
      if (!channel || !channel.isTextBased?.()) {
        logger.warn("[WelcomeLeave] Welcome channel not found or not text-based", { guildId, channelId: welcome.channelId });
        return;
      }

      // Replace placeholders using utility
      const embedPayload = replacePlaceholders(
        welcome.embed,
        {
          member,
          guild: member.guild,
          channel: member.guild.channels.cache.get(welcome.channelId),
        },
        ctx
      );

      // Validate and normalize embed
      const result = validateEmbed(embedPayload);
      if (!result.ok) {
        logger.warn("[WelcomeLeave] Invalid welcome embed", { guildId, error: result.error });
        return;
      }

      await channel.send({ embeds: [result.embed] });
      logger.info("[WelcomeLeave] Sent welcome message", { guildId, userId: member.user.id, channelId: channel.id });
    } catch (err) {
      logger.error("[WelcomeLeave] Error in guildMemberAdd handler", { error: err?.message, stack: err?.stack });
    }
  });

  // --- Handler: Member Leave ---
  client.on("guildMemberRemove", async (member) => {
    try {
      const guildId = member.guild.id;
      const settings = await getGuildSettings(ctx, guildId);
      const leave = settings?.leave;
      if (!leave?.enabled || !leave?.channelId || !leave?.embed) return;

      const channel = member.guild.channels.cache.get(leave.channelId);
      if (!channel || !channel.isTextBased?.()) {
        logger.warn("[WelcomeLeave] Leave channel not found or not text-based", { guildId, channelId: leave.channelId });
        return;
      }

      // Replace placeholders using utility
      const embedPayload = replacePlaceholders(
        leave.embed,
        {
          member,
          guild: member.guild,
          channel: member.guild.channels.cache.get(leave.channelId),
        },
        ctx
      );

      // Validate and normalize embed
      const result = validateEmbed(embedPayload);
      if (!result.ok) {
        logger.warn("[WelcomeLeave] Invalid leave embed", { guildId, error: result.error });
        return;
      }

      await channel.send({ embeds: [result.embed] });
      logger.info("[WelcomeLeave] Sent leave message", { guildId, userId: member.user.id, channelId: channel.id });
    } catch (err) {
      logger.error("[WelcomeLeave] Error in guildMemberRemove handler", { error: err?.message, stack: err?.stack });
    }
  });

  logger.info("[WelcomeLeave] Member event handlers registered");
}
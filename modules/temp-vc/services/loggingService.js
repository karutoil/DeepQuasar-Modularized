/**
 * Logging service for TempVC actions.
 * Soft-depends on modules/modlog when available; otherwise uses a configured log channel.
 * Updated: pretty embeds for all actions.
 */
import { repo } from "./repository.js";
import { settingsService } from "./settingsService.js";
import { EmbedBuilder, Colors } from "discord.js";

export function loggingService(ctx) {
  const { client, logger } = ctx;
  const settings = settingsService(ctx);
  const { collections } = repo(ctx);

  // Resolve modlog integration if present in ctx
  const modlog = ctx.modules?.modlog?.logging || null;

  async function getLogChannel(guildId) {
    try {
      const conf = await settings.get(guildId);
      if (!conf.eventLoggingEnabled) return null;
      if (modlog?.send) return "modlog"; // use modlog subsystem
      const id = conf.modlogChannelId;
      if (!id) return null;
      const ch = await client.channels.fetch(id).catch(() => null);
      return ch || null;
    } catch {
      return null;
    }
  }

  function buildEmbed({ action, description, fields = [], color = Colors.Blurple, footer = null, timestamp = true }) {
    const emb = new EmbedBuilder()
      .setTitle(`TempVC — ${action}`)
      .setColor(color);

    if (description) emb.setDescription(description);
    if (fields?.length) emb.setFields(fields.map(f => ({ name: String(f.name).slice(0, 256), value: String(f.value).slice(0, 1024), inline: f.inline ?? false })));
    if (timestamp) emb.setTimestamp(new Date());
    if (footer) emb.setFooter({ text: footer.text?.slice(0, 2048) || "", iconURL: footer.iconURL || undefined });
    return emb;
  }

  async function send(guildId, payload) {
    try {
      const target = await getLogChannel(guildId);
      if (!target) return;

      if (target === "modlog") {
        // Map payload to modlog format; keep generic fields
        return await modlog.send({
          guildId,
          action: payload.action,
          message: payload.message ?? payload.description,
          fields: payload.fields || [],
        });
      }

      const embed = buildEmbed({
        action: payload.action,
        description: payload.message ?? payload.description,
        fields: payload.fields,
        color: payload.color ?? Colors.Blurple,
        footer: payload.footer,
        timestamp: true,
      });

      await target.send({ embeds: [embed] }).catch(() => null);
    } catch (e) {
      logger.warn("[TempVC] logging send error", { error: e?.message });
    }
  }

  return {
    async created(guildId, channelId, ownerId, name) {
      await send(guildId, {
        action: "Created",
        message: `Channel <#${channelId}> created for <@${ownerId}>`,
        fields: [
          { name: "Channel", value: `<#${channelId}>`, inline: true },
          { name: "Owner", value: `<@${ownerId}>`, inline: true },
          { name: "Name", value: String(name) },
        ],
        color: Colors.Green,
      });
    },
    async deleted(guildId, channelId, reason = "N/A") {
      await send(guildId, {
        action: "Deleted",
        message: `Channel deleted`,
        fields: [
          { name: "ChannelID", value: channelId, inline: true },
          { name: "Reason", value: String(reason) },
        ],
        color: Colors.Red,
      });
    },
    async ownerChanged(guildId, channelId, oldOwnerId, newOwnerId) {
      await send(guildId, {
        action: "Owner Changed",
        message: `Ownership changed in <#${channelId}>`,
        fields: [
          { name: "Channel", value: `<#${channelId}>`, inline: true },
          { name: "Old Owner", value: oldOwnerId ? `<@${oldOwnerId}>` : "None", inline: true },
          { name: "New Owner", value: newOwnerId ? `<@${newOwnerId}>` : "None", inline: true },
        ],
        color: Colors.Orange,
      });
    },
    async locked(guildId, channelId) {
      await send(guildId, {
        action: "Locked",
        message: `Channel <#${channelId}> locked`,
        fields: [{ name: "Channel", value: `<#${channelId}>`, inline: true }],
        color: Colors.DarkGrey,
      });
    },
    async unlocked(guildId, channelId) {
      await send(guildId, {
        action: "Unlocked",
        message: `Channel <#${channelId}> unlocked`,
        fields: [{ name: "Channel", value: `<#${channelId}>`, inline: true }],
        color: Colors.Blurple,
      });
    },
    async renamed(guildId, channelId, newName) {
      await send(guildId, {
        action: "Renamed",
        message: `Channel <#${channelId}> renamed`,
        fields: [
          { name: "Channel", value: `<#${channelId}>`, inline: true },
          { name: "New Name", value: String(newName) },
        ],
        color: Colors.Yellow,
      });
    },
    async limited(guildId, channelId, count) {
      await send(guildId, {
        action: "Limit Changed",
        message: `User limit updated`,
        fields: [
          { name: "Channel", value: `<#${channelId}>`, inline: true },
          { name: "Limit", value: String(count ?? "unlimited"), inline: true },
        ],
        color: Colors.Aqua,
      });
    },
  };
}
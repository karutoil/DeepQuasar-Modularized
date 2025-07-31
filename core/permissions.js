import { PermissionsBitField } from "discord.js";

export function createPermissions(embed, logger) {
  function hasUserPerms(member, perms = []) {
    if (!member) return false;
    const need = new PermissionsBitField(perms);
    return member.permissions.has(need);
  }

  function hasBotPerms(guild, perms = []) {
    if (!guild) return false;
    const me = guild.members.me;
    if (!me) return false;
    const need = new PermissionsBitField(perms);
    return me.permissions.has(need);
  }

  async function ensureInteractionPerms(interaction, { userPerms = [], botPerms = [] } = {}) {
    const guild = interaction.guild ?? null;
    const member = interaction.member ?? null;

    if (userPerms.length && !hasUserPerms(member, userPerms)) {
      const e = embed.error({
        title: "Insufficient permissions",
        description: `You lack required permissions: ${formatPerms(userPerms)}`,
      });
      await safeReply(interaction, { embeds: [e], ephemeral: true });
      return false;
    }

    if (botPerms.length && !hasBotPerms(guild, botPerms)) {
      const e = embed.error({
        title: "Bot lacks permissions",
        description: `I need the following permissions: ${formatPerms(botPerms)}`,
      });
      await safeReply(interaction, { embeds: [e], ephemeral: true });
      return false;
    }

    return true;
  }

  function formatPerms(perms) {
    return perms.map((p) => `\`${p}\``).join(", ");
  }

  async function safeReply(interaction, payload) {
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    } catch (err) {
      logger.error(`safeReply error: ${err?.message}`, { stack: err?.stack });
    }
  }

  return {
    hasUserPerms,
    hasBotPerms,
    ensureInteractionPerms,
  };
}
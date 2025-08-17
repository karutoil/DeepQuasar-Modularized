import { PermissionsBitField } from "discord.js";

// Provide permission helpers including command-level permission checks
export function createPermissions(embed, logger, client) {
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

    // Also enforce command-level permissions if present
    try {
      const cmdOk = await isAllowedByCommandPermissions(interaction);
      if (!cmdOk.allowed) {
        const e = embed.error({ title: 'Insufficient command permission', description: 'You are not allowed to use this command or its controls.' });
        await safeReply(interaction, { embeds: [e], ephemeral: true });
        return false;
      }
    } catch (err) {
      logger.warn(`command-level permission enforcement error: ${err?.message}`);
    }

    return true;
  }

  // Fetch application command permissions for a specific guild/command
  async function fetchCommandPermissions(guildId, commandId) {
    if (!client || !client.application || !client.application.commands || !client.application.commands.permissions) return null;
    if (!guildId || !commandId) return null;
    try {
      // discord.js exposes application.commands.permissions.fetch with either { guild, command } or { guild }
      const res = await client.application.commands.permissions.fetch({ guild: guildId, command: commandId });
      return res;
    } catch (err) {
      logger.warn(`fetchCommandPermissions failed: ${err?.message}`);
      return null;
    }
  }

  // Determine if the interacting user is allowed by the command-level permissions (if set)
  // Returns: { allowed: boolean, reason?: string }
  async function isAllowedByCommandPermissions(interaction) {
    try {
      const guildId = interaction.guildId;
      if (!guildId) return { allowed: true };

      // Resolve the command id associated with this interaction.
      // For chat input/context commands the interaction has a commandId.
      // For component interactions/modals we try to read the originating message's interaction.
      let commandId = interaction.commandId || null;
      if (!commandId) {
        // message interaction (the message that originated from a command)
        const msgInt = interaction.message?.interaction;
        if (msgInt?.commandId) commandId = msgInt.commandId;
      }

      if (!commandId) {
        // Nothing to check: no associated command
        return { allowed: true };
      }

      const perms = await fetchCommandPermissions(guildId, commandId);
      // If no perms or empty, allow by default
      if (!perms) return { allowed: true };

      // perms can be an object with a 'permissions' array, or an array itself depending on discord.js shape
      const list = Array.isArray(perms) ? perms : (Array.isArray(perms.permissions) ? perms.permissions : []);
      if (!list || list.length === 0) return { allowed: true };

      // Check for explicit allow entries (permission === true)
      const userId = interaction.user?.id;
      const member = interaction.member ?? null;

      for (const p of list) {
        // Each entry shape: { id, type, permission }
        const id = String(p.id);
        const type = p.type; // 1=user, 2=role historically
        const allowed = Boolean(p.permission);
        if (!allowed) continue;
        if (type === 1 || String(type) === "1") {
          if (id === String(userId)) return { allowed: true };
        }
        if (type === 2 || String(type) === "2") {
          // role entry
          try {
            if (member) {
              // discord.js v14 member.roles may be a cache or array-like
              if (member.roles?.cache) {
                if (member.roles.cache.has(id)) return { allowed: true };
              } else if (Array.isArray(member.roles?.value ?? null)) {
                if (member.roles.value.includes(id)) return { allowed: true };
              } else if (Array.isArray(member.roles)) {
                if (member.roles.includes(id)) return { allowed: true };
              }
            }
          } catch (err) { void err; }
        }
      }

      // No allow entry matched the user
      return { allowed: false, reason: "command_permissions" };
    } catch (err) {
      logger.warn(`isAllowedByCommandPermissions check failed: ${err?.message}`);
      return { allowed: true };
    }
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
    fetchCommandPermissions,
    isAllowedByCommandPermissions,
  };
}
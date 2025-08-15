import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { logModerationAction } from './modlog.js';

/**
 * Ban command handler for ModerationModule.
 * Exports createBanCommand(ctx) for registration.
 * Subcommands: add (ban), remove (unban)
 */
export function createBanCommand(ctx) {
  const { v2, embed, logger } = ctx;

  const cmdBan = v2
    .createInteractionCommand()
    .setName('ban')
    .setDescription('Ban or unban a user.')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Ban a user')
        .addUserOption((opt) => opt.setName('user').setDescription('User to ban').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Reason for ban').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Unban a user')
        .addStringOption((opt) =>
          opt
            .setName('userid')
            .setDescription('User ID to unban')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Reason for unban').setRequired(false)
        )
    );

  cmdBan.onExecute(
    ctx.dsl.withTryCatch(async (interaction) => {
      await handleBan(interaction, ctx);
    })
  );

  // Register autocomplete handler for "userid" on "remove" subcommand
  cmdBan.onAutocomplete('userid', async (interaction) => {
    try {
      // Only trigger for the "remove" subcommand
      if (interaction.options.getSubcommand() !== 'remove') return;

      const focused = interaction.options.getFocused(true)?.value || '';
      // Fetch all bans for the guild
      const bans = await interaction.guild.bans.fetch();
      // Filter and map to choices
      const choices = Array.from(bans.values())
        .filter((ban) => {
          const tag = ban.user.tag || `${ban.user.username}#${ban.user.discriminator}`;
          return (
            ban.user.id.includes(focused) ||
            tag.toLowerCase().includes(focused.toLowerCase()) ||
            ban.user.username.toLowerCase().includes(focused.toLowerCase())
          );
        })
        .slice(0, 25)
        .map((ban) => ({
          name: `${ban.user.tag} (${ban.user.id})`,
          value: ban.user.id,
        }));

      await interaction.respond(choices);
    } catch (err) {
      ctx.logger?.error?.(`[Moderation] Ban autocomplete failed: ${err.message}`);
      await interaction.respond([]);
    }
  });

  cmdBan.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);
  return cmdBan;
}

// Helper to build moderation DM embed
function buildModerationDmEmbed({ action, reason, executor, server }) {
  return new EmbedBuilder()
    .setTitle(`Action Performed: ${action}`)
    .addFields(
      { name: 'Reason', value: reason || 'No reason provided', inline: false },
      { name: 'Executor', value: executor, inline: false },
      { name: 'Server', value: server, inline: false }
    )
    .setColor(0xff5555)
    .setTimestamp();
}

// Export a direct handler for index.js
export async function handleBan(interaction, ctx) {
  const { embed, logger } = ctx;
  await interaction.deferReply({ ephemeral: true });

  try {
    logger.debug('[Moderation] handleBan invoked', {
      user: interaction.user?.id,
      subcommand: interaction.options.getSubcommand(),
      options: interaction.options._hoistedOptions,
    });

    const subcommand = interaction.options.getSubcommand();
    logger.debug('[Moderation] Ban handler: subcommand resolved', { subcommand });

    if (subcommand === 'add') {
      logger.debug("[Moderation] Ban handler: entered 'add' block");
      let target, reason, member;
      try {
        target = interaction.options.getUser('user');
        reason = interaction.options.getString('reason') || 'No reason provided';
      } catch (err) {
        logger.error('[Moderation] Exception getting target user or reason', { error: err });
        return interaction.editReply({
          embeds: [embed.error('Failed to resolve target user for ban.')],
        });
      }
      logger.debug('[Moderation] Ban subcommand: target', {
        targetObj: target,
        targetId: target?.id,
        reason,
      });

      try {
        // Try to get the member from the interaction options (preferred)
        member = interaction.options.getMember ? interaction.options.getMember('user') : undefined;
        logger.debug('[Moderation] Ban subcommand: member from options', {
          found: !!member,
          memberObj: member,
        });

        // Fallback: fetch from guild if not present
        if (!member) {
          logger.debug(
            '[Moderation] Ban subcommand: member not in options, fetching from guild...',
            { targetId: target?.id }
          );
          try {
            member = await interaction.guild.members.fetch(target.id);
            logger.debug('[Moderation] Ban subcommand: member fetched from guild', {
              found: !!member,
              memberObj: member,
            });
          } catch (fetchErr) {
            logger.warn('[Moderation] Ban failed: Could not fetch member from guild', {
              targetId: target?.id,
              error: fetchErr,
            });
            return interaction.editReply({
              embeds: [embed.error('User not found in this server (not cached and fetch failed).')],
            });
          }
        }
      } catch (err) {
        logger.error('[Moderation] Exception looking up member in guild', { error: err });
        return interaction.editReply({
          embeds: [embed.error('Failed to resolve member in guild for ban.')],
        });
      }

      if (!member) {
        logger.warn('[Moderation] Ban failed: User not found in this server.', {
          targetId: target?.id,
        });
        return interaction.editReply({ embeds: [embed.error('User not found in this server.')] });
      }
      if (!member.bannable) {
        logger.warn('[Moderation] Ban failed: Member not bannable.', { targetId: target?.id });
        return interaction.editReply({ embeds: [embed.error('I cannot ban this user.')] });
      }

      // DM user before banning (embed)
      try {
        const embedDm = buildModerationDmEmbed({
          action: 'Banned',
          reason,
          executor: `${interaction.user.tag} (${interaction.user.id})`,
          server: interaction.guild.name,
        });
        await target.send({ embeds: [embedDm] });
      } catch (dmErr) {
        logger.warn(`[Moderation] Failed to DM banned user: ${dmErr.message}`);
      }

      // Ban user
      try {
        logger.debug('[Moderation] Attempting to ban member', { targetId: target.id });
        await member.ban({ reason });

        // Log action
        await logModerationAction(ctx, interaction.guild.id, {
          action: 'ban',
          targetId: target.id,
          moderatorId: interaction.user.id,
          reason,
        });

        logger.debug('[Moderation] Ban successful', { targetId: target.id });
        await interaction.editReply({
          embeds: [embed.success(`Successfully banned ${target.tag}. Reason: ${reason}`)],
        });
      } catch (err) {
        logger.error(`[Moderation] Ban failed: ${err.message}`, { error: err });
        await interaction.editReply({
          embeds: [embed.error(`Failed to ban user: ${err.message}`)],
        });
      }
    } else if (subcommand === 'remove') {
      const userId = interaction.options.getString('userid');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      logger.debug('[Moderation] Unban subcommand: userId', { userId, reason });

      // Unban user
      try {
        await interaction.guild.members.unban(userId, reason);

        // DM user (best effort, may not be possible if not cached)
        try {
          const user = await interaction.client.users.fetch(userId);
          await user.send(
            `You have been unbanned from **${interaction.guild.name}**. Reason: ${reason}`
          );
        } catch (dmErr) {
          logger.warn(`[Moderation] Failed to DM unbanned user: ${dmErr.message}`);
        }

        // Log action
        await logModerationAction(ctx, interaction.guild.id, {
          action: 'unban',
          targetId: userId,
          moderatorId: interaction.user.id,
          reason,
        });

        logger.debug('[Moderation] Unban successful', { userId });
        await interaction.editReply({
          embeds: [embed.success(`Successfully unbanned user ID ${userId}. Reason: ${reason}`)],
        });
      } catch (err) {
        logger.error(`[Moderation] Unban failed: ${err.message}`, { error: err });
        await interaction.editReply({
          embeds: [embed.error(`Failed to unban user: ${err.message}`)],
        });
      }
    }
  } catch (outerErr) {
    logger.error('[Moderation] handleBan outer error', { error: outerErr });
    try {
      await interaction.editReply({
        embeds: [embed.error(`Unexpected error: ${outerErr.message}`)],
      });
    } catch (editErr) {
      logger.warn('[Moderation] Failed to send error reply to interaction', { error: editErr });
    }
  }
}

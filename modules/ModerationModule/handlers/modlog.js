import { ChannelType, PermissionFlagsBits } from 'discord.js';

import { setModlogChannel, getModlogChannel } from '../services/guildConfigService.js';

/**
 * /moderation modlog set <channel>
 * /moderation modlog show
 */
export function createModlogCommand(ctx) {
  const { v2, embed } = ctx;

  const cmd = v2
    .createInteractionCommand()
    .setName('moderation')
    .setDescription('Configure or view the moderation log channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set the moderation log channel')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel to send moderation logs to')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('show').setDescription('Show the current moderation log channel')
    );

  cmd.onExecute(
    ctx.dsl.withTryCatch(async (interaction) => {
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guild.id;

      if (sub === 'set') {
        const channel = interaction.options.getChannel('channel');
        if (!channel || channel.type !== ChannelType.GuildText) {
          return interaction.reply({
            ephemeral: true,
            embeds: [embed.error('Please select a text channel.')],
          });
        }
        await setModlogChannel(ctx, guildId, channel.id);
        return interaction.reply({
          ephemeral: true,
          embeds: [embed.success(`Moderation log channel set to <#${channel.id}>.`)],
        });
      } else if (sub === 'show') {
        const channelId = await getModlogChannel(ctx, guildId);
        if (!channelId) {
          return interaction.reply({
            ephemeral: true,
            embeds: [embed.info('No moderation log channel is set.')],
          });
        }
        return interaction.reply({
          ephemeral: true,
          embeds: [embed.info(`Current moderation log channel: <#${channelId}>`)],
        });
      }
    })
  );

  cmd.setDefaultMemberPermissions(PermissionFlagsBits.Administrator); // ensure only admins can change modlog
  return cmd;
}

/**
 * Log a moderation action to the configured moderation log channel.
 * @param {object} ctx - Handler context (must include client, guildConfig, embed, logger)
 * @param {string} guildId
 * @param {object} action - { action, targetId, moderatorId, reason, duration, index }
 */
export async function logModerationAction(ctx, guildId, action) {
  const { client, _guildConfig, embed, logger } = ctx;
  // Ensure per-guild log channel is present and valid
  const channelId = await getModlogChannel(ctx, guildId);
  if (!channelId) {
    logger?.warn?.(
      `[Moderation] No mod log channel set for guild ${guildId}. Moderation action not logged.`
    );
    return;
  }
  const channel = client.channels.cache.get(channelId);
  if (!channel || channel.guild?.id !== guildId) {
    logger?.warn?.(
      `[Moderation] Mod log channel ${channelId} not found in cache or does not belong to guild ${guildId}. Moderation action not logged.`
    );
    return;
  }

  const logEmbed = embed.success({
    title: `Moderation Action: ${action.action}`,
    description: [
      `**User:** <@${action.targetId}> (${action.targetId})`,
      `**Moderator:** <@${action.moderatorId}> (${action.moderatorId})`,
      action.reason ? `**Reason:** ${action.reason}` : null,
      action.duration ? `**Duration:** ${action.duration} minutes` : null,
      action.index !== undefined ? `**Index:** ${action.index}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    timestamp: new Date(),
  });

  try {
    await channel.send({ embeds: [logEmbed] });
  } catch (err) {
    logger?.error?.(`[Moderation] Failed to send mod log: ${err.message}`);
  }
}

// Setup command and entry settings embed (stub implementation)
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

const MODULE = 'tickets';

// Command registration helper compatible with core/commandHandler.js DSL
export function registerSetupCommand(ctx) {
  const { logger, commands, lifecycle } = ctx;

  // Define the slash command /ticket-setup
  const data = new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('Open the Tickets module setup panel for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild); // already set

  // Register the command definition
  commands.registerSlash(MODULE, data);

  // Register the command handler separately
  const disposer = commands.onInteractionCreate(MODULE, async (interaction) => {
    // Only handle our specific command
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'ticket-setup') {
      return;
    }

    try {
      const { assertInGuild, requireManageGuild, _safeReply } = await import(
        '../utils/validators.js'
      );
      assertInGuild(interaction);
      requireManageGuild(interaction);

      // Build the main settings embed with three primary actions
      const embed = new EmbedBuilder()
        .setTitle('Tickets — Module Setup')
        .setDescription(
          [
            'Use the buttons below to configure the Tickets module for this server.',
            '',
            '• Set General Settings — category, log channel, support roles, transcripts, inactivity',
            '• Manage Ticket Panels — create/edit/delete the panel messages users click to create tickets',
            '• Manage Ticket Types — define ticket types, welcome messages, and support role pings',
          ].join('\n')
        )
        .setColor(0x2f3136);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('tickets:setup:general')
          .setLabel('Set General Settings')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('tickets:setup:panels')
          .setLabel('Manage Ticket Panels')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('tickets:setup:types')
          .setLabel('Manage Ticket Types')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    } catch (err) {
      logger.error('[Tickets] /ticket-setup handler error', {
        error: err?.message,
        stack: err?.stack,
      });
      try {
        const { safeReply } = await import('../utils/validators.js');
        await safeReply(interaction, {
          content:
            err?.code === 'PERM:MANAGE_GUILD'
              ? 'Manage Server permission required.'
              : 'An error occurred while opening the setup panel.',
          ephemeral: true,
        });
      } catch (err) { void err; }
    }
  });

  // Track disposer for hot-reload
  lifecycle.addDisposable(() => {
    try {
      disposer?.();
    } catch (err) { void err; }
  });

  // Register button routes for main setup entry (delegated to adminMenus)
  // Handlers for these customIds are installed in registerAdminMenus.
  return () => {
    try {
      disposer?.();
    } catch (err) { void err; }
  };
}

export { registerSetupCommand as registerSetupCommandCompat };

import { logModerationAction } from "./modlog.js";

/**
 * Mute command handler for ModerationModule.
 * Exports createMuteCommand(ctx) for registration.
 * Subcommands: add (mute), remove (unmute)
 */
export function createMuteCommand(ctx) {
  const { v2, _permissions, _embed, _modlog, _logger } = ctx;

  const cmdMute = v2.createInteractionCommand()
    .setName("mute")
    .setDescription("Mute or unmute a user (timeout).")
    .addSubcommand(sub =>
      sub.setName("add")
        .setDescription("Mute a user")
        .addUserOption(opt =>
          opt.setName("user")
            .setDescription("User to mute")
            .setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName("duration")
            .setDescription("Mute duration in minutes")
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName("reason")
            .setDescription("Reason for mute")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName("remove")
        .setDescription("Unmute a user")
        .addUserOption(opt =>
          opt.setName("user")
            .setDescription("User to unmute")
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName("reason")
            .setDescription("Reason for unmute")
            .setRequired(false)
        )
    );

  cmdMute.onExecute(
    ctx.dsl.withTryCatch(async (interaction) => {
      await handleMute(interaction, ctx);
    })
  );

  return cmdMute;
}

// Export a direct handler for index.js
export async function handleMute(interaction, ctx) {
  const { _permissions, embed, _modlog, logger } = ctx;
  await interaction.deferReply({ ephemeral: true });

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "add") {
    const target = interaction.options.getUser("user");
    const duration = interaction.options.getInteger("duration");
    const reason = interaction.options.getString("reason") || "No reason provided";
    const member = interaction.guild.members.cache.get(target.id);

    if (!member) {
      return interaction.editReply({ embeds: [embed.error("User not found in this server.")] });
    }
    if (!member.moderatable || !member.manageable) {
      return interaction.editReply({ embeds: [embed.error("I cannot mute this user.")] });
    }

    // Apply timeout (mute)
    try {
      const ms = duration * 60 * 1000;
      await member.timeout(ms, reason);

      // DM user
      try {
        await target.send(`You have been muted in **${interaction.guild.name}** for ${duration} minutes. Reason: ${reason}`);
      } catch (dmErr) {
        logger.warn(`[Moderation] Failed to DM muted user: ${dmErr.message}`);
      }

      // Log action
      await logModerationAction(ctx, interaction.guild.id, {
        action: "mute",
        targetId: target.id,
        moderatorId: interaction.user.id,
        reason,
        duration,
      });

      await interaction.editReply({
        embeds: [embed.success(`Successfully muted ${target.tag} for ${duration} minutes. Reason: ${reason}`)],
      });
    } catch (err) {
      logger.error(`[Moderation] Mute failed: ${err.message}`);
      await interaction.editReply({ embeds: [embed.error(`Failed to mute user: ${err.message}`)] });
    }
  } else if (subcommand === "remove") {
    const target = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "No reason provided";
    const member = interaction.guild.members.cache.get(target.id);

    if (!member) {
      return interaction.editReply({ embeds: [embed.error("User not found in this server.")] });
    }
    if (!member.moderatable || !member.manageable) {
      return interaction.editReply({ embeds: [embed.error("I cannot unmute this user.")] });
    }

    // Remove timeout (unmute)
    try {
      await member.timeout(null, reason);

      // DM user
      try {
        await target.send(`You have been unmuted in **${interaction.guild.name}**. Reason: ${reason}`);
      } catch (dmErr) {
        logger.warn(`[Moderation] Failed to DM unmuted user: ${dmErr.message}`);
      }

      // Log action
      await logModerationAction(ctx, interaction.guild.id, {
        action: "unmute",
        targetId: target.id,
        moderatorId: interaction.user.id,
        reason,
      });

      await interaction.editReply({
        embeds: [embed.success(`Successfully unmuted ${target.tag}. Reason: ${reason}`)],
      });
    } catch (err) {
      logger.error(`[Moderation] Unmute failed: ${err.message}`);
      await interaction.editReply({ embeds: [embed.error(`Failed to unmute user: ${err.message}`)] });
    }
  }
}
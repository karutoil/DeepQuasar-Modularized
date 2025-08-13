import { ApplicationCommandOptionType, EmbedBuilder } from "discord.js";
import { logModerationAction } from "./modlog.js";

/**
 * Kick command handler for ModerationModule.
 * Exports createKickCommand(ctx) for registration.
 */
export function createKickCommand(ctx) {
  const { v2, permissions, embed, modlog, logger } = ctx;

  const cmdKick = v2.createInteractionCommand()
    .setName("kick")
    .setDescription("Kicks a user from the server.")
    .addUserOption(opt =>
      opt.setName("user")
        .setDescription("User to kick")
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("reason")
        .setDescription("Reason for kick")
        .setRequired(false)
    );

  cmdKick.onExecute(
    ctx.dsl.withTryCatch(async (interaction) => {
      await handleKick(interaction, ctx);
    })
  );

  return cmdKick;
}

// Helper to build moderation DM embed
function buildModerationDmEmbed({ action, reason, executor, server }) {
  return new EmbedBuilder()
    .setTitle(`Action Performed: ${action}`)
    .addFields(
      { name: "Reason", value: reason || "No reason provided", inline: false },
      { name: "Executor", value: executor, inline: false },
      { name: "Server", value: server, inline: false }
    )
    .setColor(0xffaa00)
    .setTimestamp();
}

// Export a direct handler for index.js
export async function handleKick(interaction, ctx) {
  const { permissions, embed, modlog, logger } = ctx;
  await interaction.deferReply({ ephemeral: true });

  const target = interaction.options.getUser("user");
  const reason = interaction.options.getString("reason") || "No reason provided";
  const member = interaction.guild.members.cache.get(target.id);

  // Permission checks (handled by setDefaultMemberPermissions in command builder)
  if (!member) {
    return interaction.editReply({ embeds: [embed.error("User not found in this server.")] });
  }
  if (!member.kickable) {
    return interaction.editReply({ embeds: [embed.error("I cannot kick this user.")] });
  }

  // DM user before kicking (embed)
  try {
    const embedDm = buildModerationDmEmbed({
      action: "Kicked",
      reason,
      executor: `${interaction.user.tag} (${interaction.user.id})`,
      server: interaction.guild.name,
    });
    await target.send({ embeds: [embedDm] });
  } catch (dmErr) {
    logger.warn(`[Moderation] Failed to DM kicked user: ${dmErr.message}`);
  }

  // Kick user
  try {
    await member.kick(reason);

    // Log action
    await logModerationAction(ctx, interaction.guild.id, {
      action: "kick",
      targetId: target.id,
      moderatorId: interaction.user.id,
      reason,
    });

    await interaction.editReply({
      embeds: [embed.success(`Successfully kicked ${target.tag}. Reason: ${reason}`)],
    });
  } catch (err) {
    logger.error(`[Moderation] Kick failed: ${err.message}`);
    await interaction.editReply({ embeds: [embed.error(`Failed to kick user: ${err.message}`)] });
  }
}
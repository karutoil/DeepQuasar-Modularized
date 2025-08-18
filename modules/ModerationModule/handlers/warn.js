import { EmbedBuilder } from "discord.js";
import { createPaginatedEmbed } from "../../../core/ui.js";
import { InteractionCommandBuilder } from "../../../core/builders.js";
import { logModerationAction } from "./modlog.js";

/**
 * Warn command handler for ModerationModule.
 * Exports createWarnCommand(ctx) for registration.
 * Subcommands: add, remove, list
 */
export function createWarnCommand(ctx) {
  const { v2, _permissions, _embed, _modlog, _logger, services } = ctx;
  const _warnings = services?.warnings;

  const cmdWarn = v2.createInteractionCommand()
    .setName("warn")
    .setDescription("Warn a user or manage warnings.")
    .addSubcommand(sub =>
      sub.setName("add")
        .setDescription("Add a warning to a user")
        .addUserOption(opt =>
          opt.setName("user")
            .setDescription("User to warn")
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName("reason")
            .setDescription("Reason for warning")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName("remove")
        .setDescription("Remove a warning from a user")
        .addUserOption(opt =>
          opt.setName("user")
            .setDescription("User to remove warning from")
            .setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName("index")
            .setDescription("Warning index to remove (from list)")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("list")
        .setDescription("List warnings for a user")
        .addUserOption(opt =>
          opt.setName("user")
            .setDescription("User to list warnings for")
            .setRequired(true)
        )
    );

  cmdWarn.onExecute(
    ctx.dsl.withTryCatch(async (interaction) => {
      await handleWarn(interaction, ctx);
    })
  );

  return cmdWarn;
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
    .setColor(0x55aaff)
    .setTimestamp();
}

// Export a direct handler for index.js
export async function handleWarn(interaction, ctx) {
  const { _permissions, embed, _modlog, logger, services } = ctx;
  const warnings = services?.warnings;
  await interaction.deferReply({ ephemeral: true });

  const subcommand = interaction.options.getSubcommand();

  if (!warnings) {
    return interaction.editReply({ embeds: [embed.error("Warning service unavailable.")] });
  }

  if (subcommand === "add") {
    const target = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "No reason provided";

    // Persist warning
    try {
      await warnings.addWarning(ctx, interaction.guild.id, target.id, {
        moderatorId: interaction.user.id,
        reason,
        timestamp: Date.now(),
      });

      // DM user
      try {
        const embedDm = buildModerationDmEmbed({
          action: "Warned",
          reason,
          executor: `${interaction.user.tag} (${interaction.user.id})`,
          server: interaction.guild.name,
        });
        await target.send({ embeds: [embedDm] });
      } catch (dmErr) {
        logger.warn(`[Moderation] Failed to DM warned user: ${dmErr.message}`);
      }

      // Log action
      await logModerationAction(ctx, interaction.guild.id, {
        action: "warn",
        targetId: target.id,
        moderatorId: interaction.user.id,
        reason,
      });

      await interaction.editReply({
        embeds: [embed.success(`Successfully warned ${target.tag}. Reason: ${reason}`)],
      });
    } catch (err) {
      logger.error(`[Moderation] Warn failed: ${err.message}`);
      await interaction.editReply({ embeds: [embed.error(`Failed to warn user: ${err.message}`)] });
    }
  } else if (subcommand === "remove") {
    const target = interaction.options.getUser("user");
    const index = interaction.options.getInteger("index");

    // Remove warning
    try {
      const removed = await warnings.removeWarning(ctx, interaction.guild.id, target.id, index);

      if (!removed) {
        return interaction.editReply({ embeds: [embed.error("Warning not found or could not be removed.")] });
      }

      // DM user
      try {
        const embedDm = buildModerationDmEmbed({
          action: "Warning Removed",
          reason: "A warning was removed from your record.",
          executor: `${interaction.user.tag} (${interaction.user.id})`,
          server: interaction.guild.name,
        });
        await target.send({ embeds: [embedDm] });
      } catch (dmErr) {
        logger.warn(`[Moderation] Failed to DM user after warning removal: ${dmErr.message}`);
      }

      // Log action
      await logModerationAction(ctx, interaction.guild.id, {
        action: "warn_remove",
        targetId: target.id,
        moderatorId: interaction.user.id,
        index,
      });

      await interaction.editReply({
        embeds: [embed.success(`Removed warning #${index} for ${target.tag}.`)],
      });
    } catch (err) {
      logger.error(`[Moderation] Remove warning failed: ${err.message}`);
      await interaction.editReply({ embeds: [embed.error(`Failed to remove warning: ${err.message}`)] });
    }
  } else if (subcommand === "list") {
    const target = interaction.options.getUser("user");

    // List warnings
    try {
      const userWarnings = await warnings.listWarnings(ctx, interaction.guild.id, target.id);

      if (!userWarnings || userWarnings.length === 0) {
        return interaction.editReply({ embeds: [embed.info(`${target.tag} has no warnings.`)] });
      }

      // Create one embed per warning
      const pages = userWarnings.map((w, i) =>
        new EmbedBuilder()
          .setTitle(`Warning #${i + 1} for ${target.tag}`)
          .addFields(
            { name: "Reason", value: w.reason || "No reason provided", inline: false },
            { name: "Moderator", value: `<@${w.moderatorId}>`, inline: true },
            { name: "Issued At", value: `<t:${Math.floor(new Date(w.issuedAt).getTime()/1000)}:f>`, inline: true }
          )
          .setColor(0xffcc00)
          .setFooter({ text: `ID: ${w._id || "N/A"}` })
      );

      // Use core pagination utility with a UI builder instance
      const uiBuilder = new InteractionCommandBuilder().setName("warn-pagination");
      const { message } = createPaginatedEmbed(ctx, uiBuilder, "ModerationModule", pages, { ephemeral: true });
      await interaction.editReply(message);
    } catch (err) {
      logger.error(`[Moderation] List warnings failed: ${err.message}`);
      await interaction.editReply({ embeds: [embed.error(`Failed to list warnings: ${err.message}`)] });
    }
  }
}
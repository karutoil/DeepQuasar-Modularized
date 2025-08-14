import { ApplicationCommandOptionType } from "discord.js";
import { setGuildMusicSettings } from "../services/settings.js";

export function createVolumeCommand(ctx) {
  const { v2, logger, music, embed } = ctx;
  const { manager } = music;

  const cmdVolume = v2.createInteractionCommand()
    .setName("volume")
    .setDescription("Sets the player volume.")
    .addIntegerOption(opt =>
      opt.setName("level")
        .setDescription("The volume level (0-100).")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(1000)
    );

  cmdVolume.onExecute(async (interaction) => {
    await interaction.deferReply();

    if (!interaction.guild) return interaction.editReply({ embeds: [embed.error("This command must be used in a guild.")] });

    const player = manager.players.get(interaction.guild.id);

    if (!player) {
      return interaction.editReply({ embeds: [embed.error("No song is currently playing.")] });
    }

    const level = interaction.options.getInteger("level");

    if (level === null) {
      // If no level is provided, show current volume
      return interaction.editReply({ embeds: [embed.info(`Current volume: ${player.volume}%.`)] });
    }

    // Clamp level
    const clamped = Math.max(0, Math.min(100, Number(level)));

    try {
      if (player._transitioning) {
        return interaction.editReply({ embeds: [embed.info("Operation in progress, please try again shortly.")] });
      }
      player._transitioning = true;
      await player.setVolume(clamped);
      await setGuildMusicSettings(ctx, interaction.guild.id, { volume: clamped });
      player._transitioning = false;
      await interaction.editReply({ embeds: [embed.success(`Volume set to ${clamped}%.`)] });
    } catch (error) {
      player._transitioning = false;
      logger.error(`[Music] Error setting volume: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to set the volume: ${error.message}`)] });
    }
  });

  return cmdVolume;
}

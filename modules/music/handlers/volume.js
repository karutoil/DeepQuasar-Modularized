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

    const player = manager.players.get(interaction.guild.id);

    if (!player) {
      return interaction.editReply({ embeds: [embed.error("No song is currently playing.")] });
    }

    const level = interaction.options.getInteger("level");

    if (level === null) {
      // If no level is provided, show current volume
      return interaction.editReply({ embeds: [embed.info(`Current volume: ${player.volume}%.`)] });
    }

    try {
      await player.setVolume(level);
      await setGuildMusicSettings(ctx, interaction.guild.id, { volume: level });
      await interaction.editReply({ embeds: [embed.success(`Volume set to ${level}%.`)] });
    } catch (error) {
      logger.error(`[Music] Error setting volume: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to set the volume: ${error.message}`)] });
    }
  });

  return cmdVolume;
}

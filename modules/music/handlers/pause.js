export function createPauseCommand(ctx) {
  const { v2, logger, music, embed } = ctx;
  const { manager } = music;

  const cmdPause = v2.createInteractionCommand()
    .setName("pause")
    .setDescription("Pauses the currently playing song.");

  cmdPause.onExecute(async (interaction) => {
    await interaction.deferReply();

    if (!interaction.guild) return interaction.editReply({ embeds: [embed.error("This command must be used in a guild.")] });

    const player = manager.players.get(interaction.guild.id);

    if (!player || !player.playing) {
      return interaction.editReply({ embeds: [embed.error("No song is currently playing.")] });
    }

    if (player._transitioning) {
      return interaction.editReply({ embeds: [embed.info("Operation in progress, please try again shortly.")] });
    }

    if (player.paused) {
      return interaction.editReply({ embeds: [embed.info("The song is already paused.")] });
    }

    try {
      player._transitioning = true;
      await player.pause(true);
      player._transitioning = false;
      await interaction.editReply({ embeds: [embed.success("Song paused.")] });
    } catch (error) {
      player._transitioning = false;
      logger.error(`[Music] Error pausing song: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to pause the song: ${error.message}`)] });
    }
  });

  return cmdPause;
}

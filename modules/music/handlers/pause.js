export function createPauseCommand(ctx) {
  const { v2, logger, music, embed } = ctx;
  const { manager } = music;

  const cmdPause = v2.createInteractionCommand()
    .setName("pause")
    .setDescription("Pauses the currently playing song.");

  cmdPause.onExecute(async (interaction) => {
    await interaction.deferReply();

    const player = manager.players.get(interaction.guild.id);

    if (!player || !player.playing) {
      return interaction.editReply({ embeds: [embed.error("No song is currently playing.")] });
    }

    if (player.paused) {
      return interaction.editReply({ embeds: [embed.info("The song is already paused.")] });
    }

    try {
      await player.pause(true);
      await interaction.editReply({ embeds: [embed.success("Song paused.")] });
    } catch (error) {
      logger.error(`[Music] Error pausing song: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to pause the song: ${error.message}`)] });
    }
  });

  return cmdPause;
}

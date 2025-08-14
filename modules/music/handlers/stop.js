export function createStopCommand(ctx) {
  const { v2, logger, music, embed } = ctx;
  const { manager } = music;

  const cmdStop = v2.createInteractionCommand()
    .setName("stop")
    .setDescription("Stops the music and clears the queue.");

  cmdStop.onExecute(async (interaction) => {
    await interaction.deferReply();

    if (!interaction.guild) return interaction.editReply({ embeds: [embed.error("This command must be used in a guild.")] });

    const player = manager.players.get(interaction.guild.id);

    if (!player || (!player.playing && !player.paused)) {
      return interaction.editReply({ embeds: [embed.error("No music is currently playing or paused.")] });
    }

    if (player._transitioning) {
      return interaction.editReply({ embeds: [embed.info("Operation in progress, please try again shortly.")] });
    }

    try {
      player._transitioning = true;
      await player.destroy("User requested stop");
      player._transitioning = false;
      await interaction.editReply({ embeds: [embed.success("Music stopped and queue cleared.")] });
    } catch (error) {
      player._transitioning = false;
      logger.error(`[Music] Error stopping music: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to stop the music: ${error.message}`)] });
    }
  });

  return cmdStop;
}

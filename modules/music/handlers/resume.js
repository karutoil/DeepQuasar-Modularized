export function createResumeCommand(ctx) {
  const { v2, logger, music, embed } = ctx;
  const { manager } = music;

  const cmdResume = v2.createInteractionCommand()
    .setName("resume")
    .setDescription("Resumes the currently paused song.");

  cmdResume.onExecute(async (interaction) => {
    await interaction.deferReply();

    if (!interaction.guild) return interaction.editReply({ embeds: [embed.error("This command must be used in a guild.")] });

    const player = manager.players.get(interaction.guild.id);

    if (!player || !player.paused) {
      return interaction.editReply({ embeds: [embed.error("No song is currently paused.")] });
    }

    if (player._transitioning) {
      return interaction.editReply({ embeds: [embed.info("Operation in progress, please try again shortly.")] });
    }

    try {
      player._transitioning = true;
      await player.pause(false);
      player._transitioning = false;
      await interaction.editReply({ embeds: [embed.success("Song resumed.")] });
    } catch (error) {
      player._transitioning = false;
      logger.error(`[Music] Error resuming song: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to resume the song: ${error.message}`)] });
    }
  });

  return cmdResume;
}

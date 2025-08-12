export function createResumeCommand(ctx) {
  const { v2, logger, music, embed } = ctx;
  const { manager } = music;

  const cmdResume = v2.createInteractionCommand()
    .setName("resume")
    .setDescription("Resumes the currently paused song.");

  cmdResume.onExecute(async (interaction) => {
    await interaction.deferReply();

    const player = manager.players.get(interaction.guild.id);

    if (!player || !player.paused) {
      return interaction.editReply({ embeds: [embed.error("No song is currently paused.")] });
    }

    try {
      await player.pause(false);
      await interaction.editReply({ embeds: [embed.success("Song resumed.")] });
    } catch (error) {
      logger.error(`[Music] Error resuming song: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to resume the song: ${error.message}`)] });
    }
  });

  return cmdResume;
}

export function createSkipCommand(ctx) {
  const { v2, logger, music, embed } = ctx;
  const { manager } = music;

  const cmdSkip = v2.createInteractionCommand()
    .setName("skip")
    .setDescription("Skips the current song.");

  cmdSkip.onExecute(async (interaction) => {
    await interaction.deferReply();

    const player = manager.players.get(interaction.guild.id);

    if (!player || !player.queue.current) {
      return interaction.editReply({ embeds: [embed.error("No song is currently playing.")] });
    }

    try {
      await player.skip();
      await interaction.editReply({ embeds: [embed.success("Skipped the current song.")] });
    } catch (error) {
      logger.error(`[Music] Error skipping song: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to skip the song: ${error.message}`)] });
    }
  });

  return cmdSkip;
}

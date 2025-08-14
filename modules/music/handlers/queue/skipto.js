export function createSkipToCommand(ctx) {
  const { logger, music, embed } = ctx;
  const { manager } = music;

  return async (interaction) => {
    await interaction.deferReply();

    const player = manager.players.get(interaction.guild.id);

    if (!player || player.queue.tracks.length === 0) {
      return interaction.editReply({ embeds: [embed.error("The queue is empty.")] });
    }

    const position = interaction.options.getInteger("position");

    if (position < 1 || position > player.queue.tracks.length) {
      return interaction.editReply({ embeds: [embed.error(`Invalid position. Please provide a number between 1 and ${player.queue.tracks.length}.`)] });
    }

    try {
      // Remove all tracks before the target position.
      // The `remove` method modifies the queue in place.
      player.queue.remove(0, position - 1);

      // Skip the current song to start playing the new first song in the queue.
      await player.skip();

      await interaction.editReply({ embeds: [embed.success(`Skipped to song at position ${position}.`)] });
    } catch (error) {
      logger.error(`[Music] Error skipping to song: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to skip to the song: ${error.message}`)] });
    }
  };
}

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
      // Lavalink.js queue is 0-indexed, so position - 1
      // The play method can take an index to skip to
      await player.play(player.queue.tracks[position - 1]);
      await interaction.editReply({ embeds: [embed.success(`Skipped to song at position ${position}.`)] });
    } catch (error) {
      logger.error(`[Music] Error skipping to song: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to skip to the song: ${error.message}`)] });
    }
  };
}

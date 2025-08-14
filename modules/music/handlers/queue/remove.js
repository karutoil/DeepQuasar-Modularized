export function createRemoveCommand(ctx) {
  const { logger, music, embed } = ctx;
  const { manager } = music;

  return async (interaction) => {
    await interaction.deferReply();

    if (!interaction.guild) return interaction.editReply({ embeds: [embed.error("This command must be used in a guild.")] });

    const player = manager.players.get(interaction.guild.id);

    if (!player || !player.queue || player.queue.tracks.length === 0) {
      return interaction.editReply({ embeds: [embed.error("The queue is empty.")] });
    }

    const position = interaction.options.getInteger("position");

    if (position < 1 || position > player.queue.tracks.length) {
      return interaction.editReply({ embeds: [embed.error(`Invalid position. Please provide a number between 1 and ${player.queue.tracks.length}.`)] });
    }

    try {
      const removedTrack = player.queue.remove(position - 1); // Lavalink.js queue is 0-indexed
      await interaction.editReply({ embeds: [embed.success(`Removed **${removedTrack[0].info.title}** from the queue.`)] });
    } catch (error) {
      logger.error(`[Music] Error removing song from queue: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to remove the song: ${error.message}`)] });
    }
  };
}

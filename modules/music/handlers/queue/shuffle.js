export function createShuffleCommand(ctx) {
  const { logger, music, embed } = ctx;
  const { manager } = music;

  return async (interaction) => {
    await interaction.deferReply();

    if (!interaction.guild) return interaction.editReply({ embeds: [embed.error("This command must be used in a guild.")] });

    const player = manager.players.get(interaction.guild.id);

    if (!player || !player.queue || player.queue.tracks.length <= 1) {
      return interaction.editReply({ embeds: [embed.info("The queue needs at least 2 songs to shuffle.")] });
    }

    try {
      player.queue.shuffle();
      await interaction.editReply({ embeds: [embed.success("Queue shuffled.")] });
    } catch (error) {
      logger.error(`[Music] Error shuffling queue: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to shuffle the queue: ${error.message}`)] });
    }
  };
}

export function createClearCommand(ctx) {
  const { logger, music, embed } = ctx;
  const { manager } = music;

  return async (interaction) => {
    await interaction.deferReply();

    const player = manager.players.get(interaction.guild.id);

    if (!player || player.queue.tracks.length === 0) {
      return interaction.editReply({ embeds: [embed.info("The queue is already empty.")] });
    }

    try {
      player.queue.clear();
      await interaction.editReply({ embeds: [embed.success("The queue has been cleared.")] });
    } catch (error) {
      logger.error(`[Music] Error clearing queue: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to clear the queue: ${error.message}`)] });
    }
  };
}

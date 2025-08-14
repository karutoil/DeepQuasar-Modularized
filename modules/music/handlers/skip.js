export function createSkipCommand(ctx) {
  const { v2, logger, music, embed } = ctx;
  const { manager } = music;

  const cmdSkip = v2.createInteractionCommand()
    .setName("skip")
    .setDescription("Skips the current song.");

  cmdSkip.onExecute(async (interaction) => {
    await interaction.deferReply();

    if (!interaction.guild) return interaction.editReply({ embeds: [embed.error("This command must be used in a guild.")] });

    const player = manager.players.get(interaction.guild.id);

    if (!player || !player.queue || !player.queue.current) {
      return interaction.editReply({ embeds: [embed.error("No song is currently playing.")] });
    }

    if (player._transitioning) {
      return interaction.editReply({ embeds: [embed.info("Operation in progress, please try again shortly.")] });
    }

    try {
      player._transitioning = true;
      await player.skip();
      player._transitioning = false;
      await interaction.editReply({ embeds: [embed.success("Skipped the current song.")] });
    } catch (error) {
      player._transitioning = false;
      logger.error(`[Music] Error skipping song: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to skip the song: ${error.message}`)] });
    }
  });

  return cmdSkip;
}

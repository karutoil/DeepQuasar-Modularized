export function createDisconnectCommand(ctx) {
  const { v2, logger, music, embed } = ctx;
  const { manager } = music;

  const cmdDisconnect = v2.createInteractionCommand()
    .setName("disconnect")
    .setDescription("Disconnects the bot from the voice channel and clears the queue.");

  cmdDisconnect.onExecute(async (interaction) => {
    await interaction.deferReply();

    if (!interaction.guild) return interaction.editReply({ embeds: [embed.error("This command must be used in a guild.")] });

    const player = manager.players.get(interaction.guild.id);

    if (!player || !player.connected) {
      return interaction.editReply({ embeds: [embed.info("I am not connected to a voice channel.")] });
    }

    if (player._transitioning) {
      return interaction.editReply({ embeds: [embed.info("Operation in progress, please try again shortly.")] });
    }

    try {
      player._transitioning = true;
      if (typeof player.destroy === 'function') player.destroy(); // Disconnects and clears the queue
      player._transitioning = false;
      await interaction.editReply({ embeds: [embed.success("Disconnected from voice channel and cleared the queue.")] });
    } catch (error) {
      player._transitioning = false;
      logger.error(`[Music] Error disconnecting: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to disconnect: ${error.message}`)] });
    }
  });

  return cmdDisconnect;
}

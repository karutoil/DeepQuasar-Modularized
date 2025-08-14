import { ApplicationCommandOptionType } from "discord.js";

export function createLoopCommand(ctx) {
  const { v2, logger, music, embed } = ctx;
  const { manager } = music;

  const cmdLoop = v2.createInteractionCommand()
    .setName("loop")
    .setDescription("Sets the loop mode for the player.")
    .addStringOption(opt =>
      opt.setName("mode")
        .setDescription("The loop mode to set.")
        .setRequired(true)
        .addChoices(
          { name: "Off", value: "off" },
          { name: "Song", value: "song" },
          { name: "Queue", value: "queue" }
        )
    );

  cmdLoop.onExecute(async (interaction) => {
    await interaction.deferReply();

    const player = manager.players.get(interaction.guild.id);

    if (!player) {
      return interaction.editReply({ embeds: [embed.error("No song is currently playing.")] });
    }

    const mode = interaction.options.getString("mode");

    try {
      // The setRepeatMode method ensures the state is set correctly.
      // The valid modes are "off", "track", and "queue".
      player.setRepeatMode(mode);

      // Capitalize first letter for the reply message
      const friendlyMode = mode.charAt(0).toUpperCase() + mode.slice(1);
      await interaction.editReply({ embeds: [embed.success(`Loop mode set to ${friendlyMode}.`)] });
    } catch (error) {
      logger.error(`[Music] Error setting loop mode: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to set the loop mode: ${error.message}`)] });
    }
  });

  return cmdLoop;
}

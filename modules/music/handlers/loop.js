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

    if (!interaction.guild) return interaction.editReply({ embeds: [embed.error("This command must be used in a guild.")] });

    const player = manager.players.get(interaction.guild.id);

    if (!player) {
      return interaction.editReply({ embeds: [embed.error("No song is currently playing.")] });
    }

    if (player._transitioning) {
      return interaction.editReply({ embeds: [embed.info("Operation in progress, please try again shortly.")] });
    }

    const mode = interaction.options.getString("mode");

    try {
      if (mode === "off") {
        player.repeatMode = "none";
        await interaction.editReply({ embeds: [embed.success("Loop mode set to off.")] });
      } else if (mode === "song") {
        player.repeatMode = "track";
        await interaction.editReply({ embeds: [embed.success("Loop mode set to song.")] });
      } else if (mode === "queue") {
        player.repeatMode = "queue";
        await interaction.editReply({ embeds: [embed.success("Loop mode set to queue.")] });
      }
    } catch (error) {
      logger.error(`[Music] Error setting loop mode: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to set the loop mode: ${error.message}`)] });
    }
  });

  return cmdLoop;
}

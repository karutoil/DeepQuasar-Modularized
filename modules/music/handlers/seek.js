import { ApplicationCommandOptionType } from "discord.js";

export function createSeekCommand(ctx) {
  const { v2, logger, music, embed } = ctx;
  const { manager } = music;

  const cmdSeek = v2.createInteractionCommand()
    .setName("seek")
    .setDescription("Seeks to a specific timestamp in the current song.")
    .addStringOption(opt =>
      opt.setName("time")
        .setDescription("The timestamp to seek to (e.g., 1:30, 90s).")
        .setRequired(true)
    );

  cmdSeek.onExecute(async (interaction) => {
    await interaction.deferReply();

    if (!interaction.guild) return interaction.editReply({ embeds: [embed.error("This command must be used in a guild.")] });

    const player = manager.players.get(interaction.guild.id);

    if (!player || !player.playing || !player.queue || !player.queue.current) {
      return interaction.editReply({ embeds: [embed.error("No song is currently playing.")] });
    }

    if (player._transitioning) {
      return interaction.editReply({ embeds: [embed.info("Operation in progress, please try again shortly.")] });
    }

    const timeString = interaction.options.getString("time");
    let seekToMs = 0;

    // Basic parsing for time string (e.g., 1:30, 90s)
    if (timeString.includes(":")) {
      const parts = timeString.split(":").map(Number);
      if (parts.length === 2) {
        seekToMs = (parts[0] * 60 + parts[1]) * 1000;
      } else if (parts.length === 3) {
        seekToMs = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
      }
    } else if (timeString.endsWith("s")) {
      seekToMs = Number(timeString.slice(0, -1)) * 1000;
    } else {
      seekToMs = Number(timeString) * 1000; // Assume seconds if no unit
    }

    const currLen = Number(player.queue.current?.info?.duration || 0);
    if (isNaN(seekToMs) || seekToMs < 0 || (currLen > 0 && seekToMs > currLen)) {
      return interaction.editReply({ embeds: [embed.error(`Invalid time format or out of range. Current song length: ${formatDuration(currLen)}.`)] });
    }

    try {
      player._transitioning = true;
      await player.seek(seekToMs);
      player._transitioning = false;
      await interaction.editReply({ embeds: [embed.success(`Seeked to ${formatDuration(seekToMs)}.`)] });
    } catch (error) {
      player._transitioning = false;
      logger.error(`[Music] Error seeking song: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to seek the song: ${error.message}`)] });
    }
  });

  return cmdSeek;
}

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return minutes + ":" + (seconds < 10 ? '0' : '') + seconds;
}

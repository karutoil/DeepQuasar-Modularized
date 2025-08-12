import { ApplicationCommandOptionType } from "discord.js";
import { createPaginatedEmbed } from "../../../../core/ui.js";

export function createListCommand(ctx, cmdQueue) {
  const { logger, music, embed, lifecycle } = ctx;
  const { manager } = music;

  return async (interaction) => {
    await interaction.deferReply();

    const player = manager.players.get(interaction.guild.id);

    if (!player || player.queue.tracks.length === 0) {
      return interaction.editReply({ embeds: [embed.info("The queue is empty.")] });
    }

    const itemsPerPage = 10;
    const totalPages = Math.ceil(player.queue.tracks.length / itemsPerPage);
    const page = interaction.options.getInteger("page") || 1;

    if (page < 1 || page > totalPages) {
      return interaction.editReply({ embeds: [embed.error(`Invalid page number. Please enter a number between 1 and ${totalPages}.`)] });
    }

    const pages = [];
    for (let i = 0; i < totalPages; i++) {
      const startIndex = i * itemsPerPage;
      const endIndex = startIndex + itemsPerPage;
      const paginatedQueue = player.queue.tracks.slice(startIndex, endIndex);

      const formattedQueue = paginatedQueue.map((track, index) => {
        const duration = track.info.isStream ? "LIVE" : formatDuration(track.info.duration);
        return `**${startIndex + index + 1}.** [${track.info.title}](${track.info.uri}) - ${track.info.author} (${duration})`;
      });

      let pageDescription = "";
      if (player.queue.current && i === 0) { // Only show "Now Playing" on the first page
        const currentDuration = player.queue.current.info.isStream ? "LIVE" : formatDuration(player.queue.current.info.duration);
        pageDescription += `**Now Playing:** [${player.queue.current.info.title}](${player.queue.current.info.uri}) - ${player.queue.current.info.author} (${currentDuration})`;
      }
      pageDescription += formattedQueue.join("\n");

      pages.push({
        title: `Music Queue (Page ${i + 1}/${totalPages})`,
        description: pageDescription,
      });
    }

    const { message, dispose } = createPaginatedEmbed(ctx, cmdQueue, "music", pages, {
      initialIndex: page - 1,
      ephemeral: false,
    });

    await interaction.editReply(message);
    lifecycle.addDisposable(dispose);
  };
}

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return minutes + ":" + (seconds < 10 ? '0' : '') + seconds;
}
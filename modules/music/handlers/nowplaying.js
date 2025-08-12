export function createNowPlayingCommand(ctx) {
  const { v2, logger, music, embed } = ctx;
  const { manager } = music;

  const cmdNowPlaying = v2.createInteractionCommand()
    .setName("nowplaying")
    .setDescription("Displays the currently playing song.");

  cmdNowPlaying.onExecute(async (interaction) => {
    await interaction.deferReply();

    const player = manager.players.get(interaction.guild.id);

    if (!player || !player.queue.current) {
      return interaction.editReply({ embeds: [embed.error("No song is currently playing.")] });
    }

    const song = player.queue.current;
    const isStream = song.info.isStream;
    const totalDuration = isStream ? "LIVE" : formatDuration(player.queue.current.info.duration);
    const currentPosition = isStream ? "0:00" : formatDuration(player.position);
    const progressBar = isStream ? "[▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬]" : generateProgressBar(player.position, player.queue.current.info.duration);

    const nowPlayingEmbed = embed.info("Now Playing");
    nowPlayingEmbed.setTitle(song.info.title);
    nowPlayingEmbed.setDescription(`**Artist:** ${song.info.author}\n${progressBar} 
[${currentPosition} / ${totalDuration}]`);
    if (song.info.artworkUrl) {
      nowPlayingEmbed.setThumbnail(song.info.artworkUrl);
    }
    nowPlayingEmbed.setFooter({ text: `Requested by ${song.requester.tag}`, iconURL: song.requester.displayAvatarURL({ dynamic: true }) });

    await interaction.editReply({ embeds: [nowPlayingEmbed] });
  });

  return cmdNowPlaying;
}

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return minutes + ":" + (seconds < 10 ? '0' : '') + seconds;
}

function generateProgressBar(current, total, size = 20) {
  const percentage = current / total;
  const progress = Math.round(size * percentage);
  const empty = size - progress;
  return "[" + "=".repeat(progress) + "-".repeat(empty) + "]";
}

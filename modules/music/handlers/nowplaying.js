export function createNowPlayingCommand(ctx) {
  const { v2, logger, music, embed } = ctx;
  const { manager } = music;

  const cmdNowPlaying = v2.createInteractionCommand()
    .setName("nowplaying")
    .setDescription("Displays the currently playing song.");

  cmdNowPlaying.onExecute(async (interaction) => {
    await interaction.deferReply();

    if (!interaction.guild) return interaction.editReply({ embeds: [embed.error("This command must be used in a guild.")] });

    const player = manager.players.get(interaction.guild.id);

    if (!player || !player.queue || !player.queue.current) {
      return interaction.editReply({ embeds: [embed.error("No song is currently playing.")] });
    }

    const song = player.queue.current;
    const isStream = !!song.info?.isStream;
    const totalDuration = isStream ? "LIVE" : formatDuration(Number(player.queue.current?.info?.duration || 0));
    const currentPosition = isStream ? "0:00" : formatDuration(Number(player.position || 0));
    const progressBar = isStream ? "[▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬]" : generateProgressBar(Number(player.position || 0), Number(player.queue.current?.info?.duration || 1));

    const nowPlayingEmbed = embed.info("Now Playing");
    nowPlayingEmbed.setTitle(song.info?.title || '<unknown title>');
    nowPlayingEmbed.setDescription(`**Artist:** ${song.info?.author || '<unknown artist>'}\n${progressBar} \n[${currentPosition} / ${totalDuration}]`);
    if (song.info?.artworkUrl) {
      nowPlayingEmbed.setThumbnail(song.info.artworkUrl);
    }
    try {
      nowPlayingEmbed.setFooter({ text: `Requested by ${song.requester?.tag || 'unknown'}`, iconURL: song.requester?.displayAvatarURL ? song.requester.displayAvatarURL({ dynamic: true }) : undefined });
    } catch (err) {
      // ignore footer set errors
    }

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

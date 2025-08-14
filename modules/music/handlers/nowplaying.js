export function createNowPlayingCommand(ctx) {
  const { v2, logger, music, embed } = ctx;
  const { manager } = music;

  const cmdNowPlaying = v2
    .createInteractionCommand()
    .setName('nowplaying')
    .setDescription('Displays the currently playing song.');

  cmdNowPlaying.onExecute(async (interaction) => {
    await interaction.deferReply();

    if (!interaction.guild)
      return interaction.editReply({
        embeds: [embed.error('This command must be used in a guild.')],
      });

    const player = manager.players.get(interaction.guild.id);

    if (!player || !player.queue || !player.queue.current) {
      return interaction.editReply({ embeds: [embed.error('No song is currently playing.')] });
    }

    const song = player.queue.current;
    const isStream = !!song.info?.isStream;
    const totalDuration = isStream
      ? 'LIVE'
      : formatDuration(Number(player.queue.current?.info?.duration || 0));
    const currentPosition = isStream ? '0:00' : formatDuration(Number(player.position || 0));
    const progressBar = isStream
      ? '[▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬]'
      : generateProgressBar(
          Number(player.position || 0),
          Number(player.queue.current?.info?.duration || 1)
        );

    const nowPlayingEmbed = embed.info('Now Playing');
    nowPlayingEmbed.setTitle(song.info?.title || '<unknown title>');

    // build description with metadata and progress
    const descLines = [];
    if (song.info?.author) descLines.push(`**Artist:** ${song.info.author}`);
    descLines.push(`${progressBar} \n[${currentPosition} / ${totalDuration}]`);
    if (song.info?.sourceName) descLines.push(`**Source:** ${song.info.sourceName}`);
    nowPlayingEmbed.setDescription(descLines.join('\n'));

    if (song.info?.artworkUrl) {
      nowPlayingEmbed.setThumbnail(song.info.artworkUrl);
    }
    try {
      nowPlayingEmbed.setFooter({
        text: `Requested by ${song.requester?.tag || 'unknown'}`,
        iconURL: song.requester?.displayAvatarURL
          ? song.requester.displayAvatarURL({ dynamic: true })
          : undefined,
      });
    } catch (err) {
      // ignore footer set errors
    }

    // add fields for duration and queue position if available
    try {
      const fields = [];
      if (!isStream && typeof song.info?.duration === 'number') {
        fields.push({ name: 'Duration', value: formatDuration(song.info.duration), inline: true });
      }
      if (song.requester && song.requester.tag) {
        fields.push({ name: 'Requested By', value: song.requester.tag, inline: true });
      }
      if (player.queue && player.queue.tracks && Array.isArray(player.queue.tracks)) {
        const pos = player.queue.tracks.findIndex((t) => t === song);
        if (pos >= 0)
          fields.push({
            name: 'Queue Position',
            value: `${pos + 1}/${player.queue.tracks.length}`,
            inline: true,
          });
      }
      if (fields.length) nowPlayingEmbed.addFields(...fields);
    } catch (e) {
      logger.debug('[Music] Failed to set now playing fields: ' + (e.message || e));
    }

    await interaction.editReply({ embeds: [nowPlayingEmbed] });
  });

  return cmdNowPlaying;
}

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
}

function generateProgressBar(current, total, size = 20) {
  const percentage = Math.min(Math.max(current / Math.max(total, 1), 0), 1);
  const progress = Math.round(size * percentage);
  const empty = size - progress;
  const filled = '█'.repeat(progress);
  const unfilled = '░'.repeat(empty);
  return '[' + filled + unfilled + ']';
}

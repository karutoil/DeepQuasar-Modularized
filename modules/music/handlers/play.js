import { ApplicationCommandOptionType, ChannelType } from 'discord.js';
import { getGuildMusicSettings } from '../services/settings.js';

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
}

export function createPlayCommand(ctx) {
  const { v2, logger, music, embed } = ctx;
  const { manager } = music;

  const cmdPlay = v2
    .createInteractionCommand()
    .setName('play')
    .setDescription('Plays a song or adds it to the queue.')
    .addStringOption((opt) =>
      opt.setName('query').setDescription('The song name or URL').setRequired(true)
    )
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('The voice channel to play in (defaults to your current voice channel)')
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(false)
    );

  cmdPlay.onExecute(async (interaction) => {
    await interaction.deferReply();

    const query = interaction.options.getString('query');
    let voiceChannel = interaction.options.getChannel('channel');

    // Precondition checks
    if (!interaction.guild) {
      return interaction.editReply({
        embeds: [embed.error('This command must be used in a guild.')],
      });
    }

    const member = interaction.guild.members.cache.get(interaction.user.id);
    if (!voiceChannel) {
      if (member && member.voice && member.voice.channel) {
        voiceChannel = member.voice.channel;
      } else {
        return interaction.editReply({
          embeds: [embed.error('Please specify a voice channel or join one.')],
        });
      }
    }

    if (!voiceChannel.joinable) {
      return interaction.editReply({
        embeds: [
          embed.error(
            'I cannot join that voice channel. Please ensure I have the CONNECT permission.'
          ),
        ],
      });
    }

    if (!member) {
      return interaction.editReply({
        embeds: [embed.error('Could not fetch your member information. Try again later.')],
      });
    }

    try {
      let player = manager.players.get(interaction.guild.id);

      if (!player) {
        const guildSettings = await getGuildMusicSettings(ctx, interaction.guild.id);
        player = manager.createPlayer({
          guildId: interaction.guild.id,
          voiceChannelId: voiceChannel.id,
          textId: interaction.channel.id,
          volume: guildSettings.volume,
          deaf: true,
        });
      }

      if (player.state !== 'CONNECTED') {
        logger.debug(
          `[Music] Player not connected, attempting to connect to voice channel: ${voiceChannel.id}`
        );
        try {
          await player.connect();
          logger.debug(`[Music] Player connected to voice channel: ${voiceChannel.id}`);
        } catch (err) {
          logger.warn(
            `[Music] Failed to connect player to voice channel ${voiceChannel.id}: ${err.message}`
          );
          return interaction.editReply({
            embeds: [
              embed.error(
                'Failed to join voice channel. Ensure the bot has permission and try again.'
              ),
            ],
          });
        }
      }

      // determine if query is a direct URL to use a faster loader
      const isUrl = (str) => {
        try {
          const u = new URL(str);
          return !!u.protocol;
        } catch (e) {
          return false;
        }
      };

      const source = isUrl(query) ? 'yt' : 'ytsearch';

      let res;
      if (player.state !== 'CONNECTED') {
        // connect and search in parallel to hide voice connection latency
        logger.debug(`[Music] Player not connected, connecting and searching in parallel`);
        const connectPromise = player.connect().then(() => {
          logger.debug(`[Music] Player connected to voice channel: ${voiceChannel.id}`);
        });

        try {
          [res] = await Promise.all([
            player.search({ query, source }, interaction.user),
            connectPromise.catch((e) => null),
          ]);
        } catch (err) {
          logger.error(`[Music] Search error: ${err.message}`);
          return interaction.editReply({
            embeds: [embed.error(`An error occurred while searching: ${err.message}`)],
          });
        }
      } else {
        res = await player.search({ query, source }, interaction.user);
      }

      if (!res || !res.tracks.length) {
        return interaction.editReply({
          embeds: [
            embed.error(`No results found for
${query}
.`),
          ],
        });
      }

      logger.debug(`[Music] Search result loadType: ${res.loadType}`);
      logger.debug(`[Music] Search result tracks length: ${res.tracks.length}`);
      if (res.playlistInfo) {
        logger.debug(`[Music] Search result playlist name: ${res.playlistInfo.name}`);
      }
      logger.debug(`[Music] Is loadType === "playlist"? ${res.loadType === 'playlist'}`);

      if (res.loadType === 'playlist') {
        player.queue.add(res.tracks);
        logger.debug(`[Music] Playlist added with ${res.tracks.length} tracks`);
        // safe queue size detection
        const getQueueSize = (p) => {
          try {
            if (!p || !p.queue) return 0;
            const q = p.queue;
            if (typeof q.size === 'number') return q.size;
            if (Array.isArray(q)) return q.length;
            if (q.items && Array.isArray(q.items)) return q.items.length;
            if (q.tracks && Array.isArray(q.tracks)) return q.tracks.length;
            if (typeof q.length === 'number') return q.length;
            // unknown shape
            logger.debug(`[Music] Unexpected queue shape keys: ${Object.keys(q).join(', ')}`);
            return 0;
          } catch (e) {
            return 0;
          }
        };
        logger.debug(`[Music] Queue size after adding playlist tracks: ${getQueueSize(player)}`);
        const playlistEmbed = embed.success(
          `Added playlist **${res.playlist.name}** with ${res.tracks.length} songs to the queue.`
        );
        // enhance playlist embed with sample tracks and total duration when available
        try {
          const firstThree = res.tracks
            .slice(0, 3)
            .map(
              (t, i) => `
${i + 1}. ${t.info.title} — ${t.info.author} (${formatDuration(t.info.duration)})`
            )
            .join('');
          const totalMs = res.tracks.reduce((acc, t) => acc + (Number(t.info.duration) || 0), 0);
          playlistEmbed.setDescription(
            `${firstThree}\n\nTotal duration: ${formatDuration(totalMs)}`
          );
        } catch (e) {
          // ignore and keep simple message
        }
        playlistEmbed.setFooter({
          text: `Requested by ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
        });
        if (res.playlist.thumbnail) playlistEmbed.setThumbnail(res.playlist.thumbnail);
        await interaction.editReply({ embeds: [playlistEmbed] });
      } else {
        const track = res.tracks[0];
        player.queue.add(track);
        const songEmbed = embed.success(`Added **${track.info.title}** to the queue!`);
        try {
          songEmbed.setTitle(track.info.title);
          const desc = [];
          if (track.info.author) desc.push(`**Artist:** ${track.info.author}`);
          if (typeof track.info.duration === 'number')
            desc.push(`**Duration:** ${formatDuration(track.info.duration)}`);
          if (track.info.sourceName) desc.push(`**Source:** ${track.info.sourceName}`);
          songEmbed.setDescription(desc.join('\n'));
          if (track.info.artworkUrl) songEmbed.setThumbnail(track.info.artworkUrl);
          songEmbed.addFields(
            { name: 'Requested By', value: interaction.user.tag, inline: true },
            {
              name: 'Position in Queue',
              value: `${player.queue.tracks ? player.queue.tracks.length : 'unknown'}`,
              inline: true,
            }
          );
          songEmbed.setFooter({
            text: `Requested by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
          });
        } catch (e) {
          // fallback to simple embed
        }
        await interaction.editReply({ embeds: [songEmbed] });
      }

      if (!player.playing && !player.paused) {
        await player.play();
      }
      // reuse getQueueSize if available
      const getQueueSize = (p) => {
        try {
          if (!p || !p.queue) return 0;
          const q = p.queue;
          if (typeof q.size === 'number') return q.size;
          if (Array.isArray(q)) return q.length;
          if (q.items && Array.isArray(q.items)) return q.items.length;
          if (q.tracks && Array.isArray(q.tracks)) return q.tracks.length;
          if (typeof q.length === 'number') return q.length;
          logger.debug(`[Music] Unexpected queue shape keys: ${Object.keys(q).join(', ')}`);
          return 0;
        } catch (e) {
          return 0;
        }
      };
      logger.debug(`[Music] Queue size after player.play(): ${getQueueSize(player)}`);
      if (player.queue.current) {
        logger.debug(
          `[Music] Current track after player.play(): ${player.queue.current.info.title}`
        );
      } else {
        logger.debug(`[Music] No current track after player.play().`);
      }
    } catch (error) {
      logger.error(`[Music] Error playing song: ${error.message}`);
      await interaction.editReply({
        embeds: [embed.error(`An error occurred while trying to play the song: ${error.message}`)],
      });
    }
  });

  return cmdPlay;
}

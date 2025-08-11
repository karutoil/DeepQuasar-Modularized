
import { ApplicationCommandOptionType } from 'discord.js';

/**
 * Starts playing a track or adds it to the queue.
 * @param {object} ctx - The module context.
 * @param {import('shoukaku').Shoukaku} shoukaku - The Shoukaku instance.
 * @param {import('../services/queueManager').QueueManager} queueManager - The queue manager.
 */
export function registerPlayCommand(ctx, shoukaku, queueManager) {
  const {
    dsl,
    embed,
    v2: { createInteractionCommand, register }
  } = ctx;

  const command = createInteractionCommand()
    .setName('play')
    .setDescription('Play a song from YouTube, Spotify, or other sources.')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('A search query or URL.')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .onExecute(
      dsl.withTryCatch(async (interaction) => {
        const { shoukaku } = ctx.music;
        if (!shoukaku || ![...shoukaku.nodes.values()].some(node => node.state === 2)) {
                        return interaction.reply({ embeds: [ctx.embed.base(0xFF0000, { description: 'The music system is not connected to a voice server yet. Please try again in a moment.' })], ephemeral: true });
        }

        await interaction.deferReply();

        const { guild, member, channel } = interaction;
        const query = interaction.options.getString('query');
        ctx.logger.debug(`[Music] Play command received query: ${query}`);

        // Prepend ytsearch: if it's not a URL
        const isUrl = /^https?:\/\//.test(query);
        const finalQuery = isUrl ? query : `ytsearch:${query}`;
        ctx.logger.debug(`[Music] Final query sent to Lavalink: ${finalQuery}`);

        // Precondition: User must be in a voice channel
        if (!member.voice.channel) {
          const errorEmbed = embed.error('You must be in a voice channel to use this command.');
          return interaction.editReply({ embeds: [errorEmbed] });
        }

        // Join voice channel and get player, but only if not already connected
        let player;
        if (shoukaku.connections.has(guild.id)) {
          ctx.logger.debug(`[Music] Guild ${guild.id} already has a connection, reusing existing player.`);
          player = shoukaku.players.get(guild.id);
        } else {
          player = await shoukaku.joinVoiceChannel({
            guildId: guild.id,
            channelId: member.voice.channel.id,
            shardId: guild.shardId,
            deaf: true,
          });
          // Add a small delay to ensure player is fully ready after joining voice channel
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
        }

        // Search for tracks
        const result = await player.node.rest.resolve(finalQuery);
/*         ctx.logger.debug(`[Music] Lavalink resolve result for query '${finalQuery}':`, { result }); */

        if (!result || (typeof result === 'object' && !result.loadType && !result.result)) {
            const errorEmbed = ctx.embed.base(0xFF0000, { description: 'Lavalink did not return a valid response or an unexpected response format.' });
            return interaction.editReply({ embeds: [errorEmbed] });
        }

        const lavalinkResult = result.result || result;

        if (lavalinkResult.loadType === 'error') {
            const errorMessage = result.data?.message || 'An unknown error occurred.';
            const errorEmbed = ctx.embed.base(0xFF0000, { description: `Lavalink encountered an error: ${errorMessage}` });
            return interaction.editReply({ embeds: [errorEmbed] });
        }

    let tracksToQueue = [];
    // Normalize loadType for Lavalink v4 where applicable
    const lt = (lavalinkResult.loadType || '').toLowerCase();
    if (lt === 'playlist' || lavalinkResult.loadType === 'PLAYLIST_LOADED') {
      // v4: loadType 'playlist' with data.tracks; legacy: 'PLAYLIST_LOADED'
      const tracks = lavalinkResult.data?.tracks || lavalinkResult.tracks || [];
      tracksToQueue = tracks;
    } else if (lt === 'search' || lavalinkResult.loadType === 'SEARCH_RESULT') {
      // Only queue the top result for searches to avoid playing through all suggestions
      const tracks = Array.isArray(lavalinkResult.data) ? lavalinkResult.data : (lavalinkResult.tracks || []);
      if (tracks.length) tracksToQueue = [tracks[0]];
    } else if (lt === 'track' || lavalinkResult.loadType === 'TRACK_LOADED') {
      const t = lavalinkResult.data || lavalinkResult.track;
      if (t) tracksToQueue = [t];
    }

        if (tracksToQueue.length === 0) {
            const errorEmbed = ctx.embed.base(0xFF0000, { description: 'No tracks found for your query.' });
            return interaction.editReply({ embeds: [errorEmbed] });
        }
        
        const queue = ctx.music.queueManager.get(guild.id);
        if (!queue.textChannelId) {
            queue.textChannelId = channel.id;
        }
        const wasQueueEmpty = queue.getQueue().length === 0 && !queue.isPlaying;

        // Add tracks to queue
        queue.add(tracksToQueue, interaction.user);

        // Send confirmation message
        let responseEmbed;
        if (lavalinkResult.loadType === 'PLAYLIST_LOADED') {
            responseEmbed = embed.success({
                title: 'Playlist Added',
                description: `Added **${lavalinkResult.playlistInfo.name}** (${tracksToQueue.length} tracks) to the queue.`,
            });
        } else {
            responseEmbed = embed.success({
                title: 'Track Added',
                description: `Added **[${tracksToQueue[0].info.title}](${tracksToQueue[0].info.uri})** to the queue.`,
            });
        }
        await interaction.editReply({ embeds: [responseEmbed] });

        // Start playback if queue was empty
        if (wasQueueEmpty) {
          playNext(ctx, guild.id, channel);
        }
      })
    )
  .onAutocomplete(async (interaction) => {
    const query = interaction.options.getString('query');
    if (!query) return interaction.respond([]);

    const player = shoukaku.players.get(interaction.guildId);
    if (!player) return interaction.respond([]);

    const result = await player.node.rest.resolve(`ytsearch:${query}`);
    const r = result?.result || result; // support both shapes
    const isSearch = (r?.loadType || '').toLowerCase() === 'search';
    const tracks = isSearch && Array.isArray(r?.data) ? r.data : (r?.tracks || []);
    if (!tracks.length) return interaction.respond([]);

    const choices = tracks.slice(0, 5).map(track => ({
      name: track.info.title,
      value: track.info.uri,
    }));

    await interaction.respond(choices);
  });

  return register(command, 'music');
}

/**
 * The core playback loop.
 * @param {object} ctx - The module context.
 * @param {string} guildId - The guild ID.
 * @param {import('shoukaku').Shoukaku} shoukaku - The Shoukaku instance.
 * @param {import('../services/queueManager').QueueManager} queueManager - The queue manager.
 * @param {import('discord.js').TextBasedChannel} textChannel - The channel for announcements.
 */
export async function playNext(ctx, guildId, textChannel) {
  const { embed, logger, music: { shoukaku, queueManager } } = ctx;
  const queue = queueManager.get(guildId);
  const player = shoukaku.players.get(guildId);

  if (!player || queue.getQueue().length === 0) {
    queue.isPlaying = false;
    if (textChannel) {
        const queueEndEmbed = embed.info({ title: 'Queue Ended', description: 'There are no more tracks to play.' });
        await textChannel.send({ embeds: [queueEndEmbed] });
    }
    // Optional: Set a timeout to leave the voice channel after a period of inactivity
    setTimeout(() => {
        if (!queueManager.get(guildId)?.isPlaying) {
            shoukaku.leaveVoiceChannel(guildId);
            queueManager.destroy(guildId);
        }
    }, 5 * 60 * 1000); // 5 minutes
    return;
  }

  queue.isPlaying = true;
  const { track, requestedBy } = queue.next();

  try {
    if (!player.node || player.node.state !== 2) { // Shoukaku.NodeState.CONNECTED
        ctx.logger.error(`[Music] Player's node in guild ${guildId} is not in CONNECTED state (${player.node?.state}). Cannot play track.`);
        const errorEmbed = embed.error({ description: 'The music player is not connected to a Lavalink node. Please try again.' });
        if (textChannel) {
            await textChannel.send({ embeds: [errorEmbed] });
        }
        playNext(ctx, guildId, textChannel);
        return;
    }
    // Add a small delay to ensure player is ready
    await new Promise(resolve => setTimeout(resolve, 500));
  ctx.logger.debug(`[Music] Attempting to play track: ${track.encoded}`);
  // Lavalink v4 expects an object for `track` with an `encoded` field
  await player.playTrack({ track: { encoded: track.encoded } });
    
  const nowPlayingEmbed = embed.info({
        title: 'Now Playing',
        description: `**[${track.info.title}](${track.info.uri})**`,
        fields: [
            { name: 'Duration', value: new Date(track.info.length).toISOString().slice(11, 19), inline: true },
            { name: 'Requested by', value: requestedBy.toString(), inline: true },
        ],
    thumbnail: `https://img.youtube.com/vi/${track.info.identifier}/0.jpg`,
    });

    if (textChannel) {
        queue.nowPlayingMessage = await textChannel.send({ embeds: [nowPlayingEmbed] });
    }

  } catch (error) {
  // Provide richer diagnostics without disrupting current playback
    const extra = {
      name: error?.name,
      message: error?.message,
      errors: error?.errors || error?.response?.errors,
      status: error?.status,
      path: error?.path,
    };
    logger.error(`[Music] Failed to play track in guild ${guildId}.`, extra);
  // Avoid auto-advancing or noisy embeds on potential false positives
  const recentStart = Date.now() - (queue?.lastStartAt || 0) < 2_000; // 2s window
  if (textChannel && !recentStart) {
      const detail = Array.isArray(extra.errors) && extra.errors.length
        ? extra.errors.map(e => e?.message || e).slice(0, 1).join('; ')
        : extra.message || 'Unknown error';
      const errorEmbed = embed.error({ description: `Playback reported an error: ${detail}` });
      await textChannel.send({ embeds: [errorEmbed] });
    }
    // Do not call playNext() here; let player events drive progression
  }
}

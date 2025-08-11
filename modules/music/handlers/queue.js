/**
 * Registers queue-related commands: queue, nowplaying.
 * @param {object} ctx - The module context.
 * @param {import('shoukaku').Shoukaku} shoukaku - The Shoukaku instance.
 * @param {import('../services/queueManager').QueueManager} queueManager - The queue manager.
 */
export function registerQueueCommands(ctx) {
  const { dsl, embed, v2: { createInteractionCommand, register, ui }, lifecycle, music: { shoukaku, queueManager } } = ctx;
  const disposers = [];

  const createQueueCommand = (name, description, execute) => {
    return createInteractionCommand()
      .setName(name)
      .setDescription(description)
      .onExecute(dsl.withTryCatch(async (interaction) => {
        const { shoukaku } = ctx.music;
        if (!shoukaku || ![...shoukaku.nodes.values()].some(node => node.state === 2)) {
            return interaction.reply({ embeds: [ctx.embed.base(0xFF0000, { description: 'The music system is not connected to a voice server yet. Please try again in a moment.' })], ephemeral: true });
        }

        const player = shoukaku.players.get(interaction.guildId);
        if (!player) {
          return interaction.reply({ embeds: [ctx.embed.base(0xFF0000, { description: 'Not currently playing anything.' })], ephemeral: true });
        }
        return execute(interaction, player);
      }));
  };

  // Now Playing Command
  const nowplaying = createQueueCommand('nowplaying', 'Shows the currently playing track.', async (interaction, player) => {
    const queue = queueManager.get(interaction.guildId);
    const currentTrack = player.track;
    if (!currentTrack) {
        return interaction.reply({ embeds: [ctx.embed.base(0xFF0000, { description: 'Not currently playing anything.' })], ephemeral: true });
    }

    const trackData = JSON.parse(Buffer.from(currentTrack.encoded, 'base64').toString());

    const progressBar = createProgressBar(player.position, trackData.length);

  const npEmbed = embed.info({
        title: 'Now Playing',
        description: `**[${trackData.title}](${trackData.uri})**`,
        fields: [
            { name: 'Progress', value: progressBar, inline: false },
            { name: 'Artist', value: trackData.author, inline: true },
            { name: 'Volume', value: `${queue.volume}%`, inline: true },
        ],
    thumbnail: `https://img.youtube.com/vi/${trackData.identifier}/0.jpg`,
    });
    await interaction.reply({ embeds: [npEmbed] });
  });
  disposers.push(register(nowplaying, 'music'));

  // Queue Command
  const queueCmd = createQueueCommand('queue', 'Displays the current music queue.', async (interaction, player) => {
    const queue = queueManager.get(interaction.guildId);
    const tracks = queue.getQueue();

    if (tracks.length === 0) {
        return interaction.reply({ embeds: [embed.info({ description: 'The queue is currently empty.' })], ephemeral: true });
    }

    const formatTrack = (track, index) => {
        return `${index + 1}. **[${track.track.info.title}](${track.track.info.uri})** - Requested by ${track.requestedBy}`;
    };

    const pages = [];
    for (let i = 0; i < tracks.length; i += 10) {
        const pageTracks = tracks.slice(i, i + 10);
        const description = pageTracks.map(formatTrack).join('\n');
        pages.push(embed.base(null, {
            title: 'Music Queue',
            description,
            footerText: `Page ${Math.floor(i / 10) + 1} of ${Math.ceil(tracks.length / 10)}`
        }));
    }
    
    // Use a v2 builder for paginated embed controls
    const v2Builder = ctx.v2.createInteractionCommand().setName('queue');
    const paginatedMessage = ui.createPaginatedEmbed(
        ctx,
        v2Builder,
        'music',
        pages,
        { ephemeral: false }
    );

    const reply = paginatedMessage.message;
    await interaction.reply(reply);
    lifecycle.addDisposable(paginatedMessage.dispose);
  });
  disposers.push(register(queueCmd, 'music'));

  return () => disposers.forEach(d => d());
}

/**
 * Creates a text-based progress bar.
 * @param {number} position - Current position in ms.
 * @param {number} duration - Total duration in ms.
 * @returns {string}
 */
function createProgressBar(position, duration) {
    const percentage = position / duration;
    const progress = Math.round(12 * percentage);
    const empty = 12 - progress;
    const progressText = '🔘'.repeat(progress);
    const emptyText = '▬'.repeat(empty);
    const positionStr = new Date(position).toISOString().slice(14, 19);
    const durationStr = new Date(duration).toISOString().slice(14, 19);
    return `[${progressText}${emptyText}] [${positionStr}/${durationStr}]`;
}

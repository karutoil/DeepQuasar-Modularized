
import { ApplicationCommandOptionType } from 'discord.js';

/**
 * Registers music control commands: pause, resume, skip, stop, volume.
 * @param {object} ctx - The module context.
 * @param {import('shoukaku').Shoukaku} shoukaku - The Shoukaku instance.
 * @param {import('../services/queueManager').QueueManager} queueManager - The queue manager.
 */
export function registerControlCommands(ctx) {
  const { dsl, embed, v2: { createInteractionCommand, register }, music: { shoukaku, queueManager } } = ctx;
  const disposers = [];

  const createControlCommand = (name, description, execute) => {
    return createInteractionCommand()
      .setName(name)
      .setDescription(description)
      .onExecute(dsl.withTryCatch(async (interaction) => {
        const { shoukaku } = ctx.music;
        if (!shoukaku || ![...shoukaku.nodes.values()].some(node => node.state === 2)) {
            return interaction.reply({ embeds: [embed.error({ description: 'The music system is not connected to a voice server yet. Please try again in a moment.' })], ephemeral: true });
        }

        const player = shoukaku.players.get(interaction.guildId);
        if (!player) {
          return interaction.reply({ embeds: [embed.error({ description: 'Not currently playing anything.' })], ephemeral: true });
        }
        // Use connection for channel validation
        const connection = shoukaku.connections.get(interaction.guildId);
        if (!connection || !connection.channelId) {
            return interaction.reply({ embeds: [embed.error({ description: 'Bot is not connected to a voice channel.' })], ephemeral: true });
        }
        if (interaction.member.voice.channelId !== connection.channelId) {
            return interaction.reply({ embeds: [embed.error({ description: 'You must be in the same voice channel as the bot.' })], ephemeral: true });
        }
        return execute(interaction, player);
      }));
  };

  // Pause Command
  const pause = createControlCommand('pause', 'Pauses the current track.', async (interaction, player) => {
    await player.setPaused(true);
    await interaction.reply({ embeds: [embed.success({ description: 'Paused the music.' })] });
  });
  disposers.push(register(pause, 'music'));

  // Resume Command
  const resume = createControlCommand('resume', 'Resumes the current track.', async (interaction, player) => {
    await player.setPaused(false);
    await interaction.reply({ embeds: [embed.success({ description: 'Resumed the music.' })] });
  });
  disposers.push(register(resume, 'music'));

  // Skip Command
  const skip = createControlCommand('skip', 'Skips the current track.', async (interaction, player) => {
    const queue = queueManager.get(interaction.guildId);
    // Remove the current track from the queue before skipping
    queue.next();
    player.stopTrack(); // The 'end' event will trigger the next song
    await interaction.reply({ embeds: [embed.success({ description: 'Skipped the current track.' })] });
  });
  disposers.push(register(skip, 'music'));

  // Stop Command
  const stop = createControlCommand('stop', 'Stops playback and clears the queue.', async (interaction, player) => {
    const queue = queueManager.get(interaction.guildId);
    queue.clear();
    player.stopTrack();
    shoukaku.leaveVoiceChannel(interaction.guildId);
    queueManager.destroy(interaction.guildId);
        await interaction.reply({ embeds: [ctx.embed.base(0x00FF00, { description: 'Stopped playback and cleared the queue.' })] });
  });
  disposers.push(register(stop, 'music'));
  
  // Shuffle Command
  const shuffle = createControlCommand('shuffle', 'Shuffles the queue.', async (interaction, player) => {
    const queue = queueManager.get(interaction.guildId);
    queue.shuffle();
    await interaction.reply({ embeds: [ctx.embed.base(0x00FF00, { description: 'Shuffled the queue.' })] });
  });
  disposers.push(register(shuffle, 'music'));

  // Volume Command
  const volume = createInteractionCommand()
    .setName('volume')
    .setDescription('Sets the playback volume.')
    .addIntegerOption(option =>
      option.setName('level')
        .setDescription('Volume level (0-100).')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100)
    )
    .onExecute(dsl.withTryCatch(async (interaction) => {
      // Always get shoukaku from ctx.music to ensure it's up-to-date
      const { shoukaku } = ctx.music;
      console.log('[DEBUG] /volume command: shoukaku:', shoukaku, 'guildId:', interaction.guildId);
      if (!shoukaku) {
        console.error('[ERROR] shoukaku is null in /volume command');
        return interaction.reply({ embeds: [embed.error({ description: 'Music system is not connected. Please try again later.' })], ephemeral: true });
      }
      const player = shoukaku.players.get(interaction.guildId);
      console.log('[DEBUG] /volume command: player object:', player);
      if (!player) {
        return interaction.reply({ embeds: [embed.error({ description: 'Not currently playing anything.' })], ephemeral: true });
      }
      // Get connection for channel validation
      const connection = shoukaku.connections.get(interaction.guildId);
      console.log('[DIAG] /volume command: connection object:', connection);
      if (!connection || !connection.channelId) {
        console.error('[ERROR] connection.channelId is undefined in /volume command. connection:', connection);
        return interaction.reply({ embeds: [embed.error({ description: 'Bot is not connected to a voice channel.' })], ephemeral: true });
      }
      if (interaction.member.voice.channelId !== connection.channelId) {
        return interaction.reply({ embeds: [embed.error({ description: 'You must be in the same voice channel as the bot.' })], ephemeral: true });
      }
      const level = interaction.options.getInteger('level');
      // Log available volume methods before calling
      console.log('[DIAG] About to set volume. Methods available:', {
        setGlobalVolume: typeof player.setGlobalVolume,
        setVolume: typeof player.setVolume
      });
      // Try both methods, but only call if exists
      if (typeof player.setGlobalVolume === 'function') {
        await player.setGlobalVolume(level * 10);
      } else if (typeof player.setVolume === 'function') {
        await player.setVolume(level);
      } else {
        console.error('[ERROR] No volume setter found on player object');
        return interaction.reply({ embeds: [embed.error({ description: 'Unable to set volume: no volume method found.' })], ephemeral: true });
      }
      const queue = queueManager.get(interaction.guildId);
      queue.volume = level;
      await interaction.reply({ embeds: [embed.success({ description: `Volume set to ${level}%.` })] });
    }));
  disposers.push(register(volume, 'music'));

  return () => disposers.forEach(d => d());
}

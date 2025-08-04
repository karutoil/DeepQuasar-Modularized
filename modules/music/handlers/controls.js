// Controls command handlers: pause, resume, stop, skip, volume, shuffle, clear
export function createControlCommands(ctx, moonlink, queueManager) {
  const { v2, embed, lifecycle } = ctx;
  const moduleName = "music";

  // Pause
  const pauseCmd = v2.createInteractionCommand()
    .setName("pause")
    .setDescription("Pause playback")
    .onExecute(async (interaction) => {
      const player = moonlink.players.get(interaction.guildId);
      if (!player || !player.playing) {
        await interaction.reply({ embeds: [embed.info({ title: "Nothing is playing." })], ephemeral: true });
        return;
      }
      await player.pause(true);
      await interaction.reply({ embeds: [embed.success({ title: "Playback paused." })], ephemeral: true });
    });

  // Resume
  const resumeCmd = v2.createInteractionCommand()
    .setName("resume")
    .setDescription("Resume playback")
    .onExecute(async (interaction) => {
      const player = moonlink.players.get(interaction.guildId);
      if (!player || !player.paused) {
        await interaction.reply({ embeds: [embed.info({ title: "Nothing is paused." })], ephemeral: true });
        return;
      }
      await player.pause(false);
      await interaction.reply({ embeds: [embed.success({ title: "Playback resumed." })], ephemeral: true });
    });

  // Stop
  const stopCmd = v2.createInteractionCommand()
    .setName("stop")
    .setDescription("Stop playback and clear queue")
    .onExecute(async (interaction) => {
      const player = moonlink.players.get(interaction.guildId);
      if (player) await player.destroy();
      queueManager.clearQueue(interaction.guildId);
      await interaction.reply({ embeds: [embed.success({ title: "Playback stopped and queue cleared." })], ephemeral: true });
    });

  // Skip
  const skipCmd = v2.createInteractionCommand()
    .setName("skip")
    .setDescription("Skip current track")
    .onExecute(async (interaction) => {
      const player = moonlink.players.get(interaction.guildId);
      const queue = queueManager.getQueue(interaction.guildId);
      if (!player || !player.playing) {
        await interaction.reply({ embeds: [embed.info({ title: "Nothing is playing." })], ephemeral: true });
        return;
      }
      queueManager.removeTrack(interaction.guildId, 0);
      if (queue.length) {
        await player.play(queue[0]);
        await interaction.reply({ embeds: [embed.success({ title: `Skipped. Now playing: ${queue[0].title}` })], ephemeral: true });
      } else {
        await player.destroy();
        await interaction.reply({ embeds: [embed.info({ title: "Queue is empty. Playback stopped." })], ephemeral: true });
      }
    });

  // Volume
  const volumeCmd = v2.createInteractionCommand()
    .setName("volume")
    .setDescription("Set playback volume")
    .addIntegerOption(opt => opt.setName("level").setDescription("Volume (1-100)").setRequired(true))
    .onExecute(async (interaction, args) => {
      const player = moonlink.players.get(interaction.guildId);
      if (!player) {
        await interaction.reply({ embeds: [embed.info({ title: "Nothing is playing." })], ephemeral: true });
        return;
      }
      const level = Math.max(1, Math.min(100, args.level));
      await player.setVolume(level);
      await interaction.reply({ embeds: [embed.success({ title: `Volume set to ${level}` })], ephemeral: true });
    });

  // Shuffle
  const shuffleCmd = v2.createInteractionCommand()
    .setName("shuffle")
    .setDescription("Shuffle the queue")
    .onExecute(async (interaction) => {
      queueManager.shuffleQueue(interaction.guildId);
      await interaction.reply({ embeds: [embed.success({ title: "Queue shuffled." })], ephemeral: true });
    });

  // Clear
  const clearCmd = v2.createInteractionCommand()
    .setName("clear")
    .setDescription("Clear the queue")
    .onExecute(async (interaction) => {
      queueManager.clearQueue(interaction.guildId);
      await interaction.reply({ embeds: [embed.success({ title: "Queue cleared." })], ephemeral: true });
    });

  // Support both core context and direct context
  let registrar;
  if (typeof ctx.createModuleContext === "function") {
    registrar = ctx.createModuleContext(moduleName).v2;
  } else {
    registrar = v2;
  }
  lifecycle.addDisposable(registrar.register(pauseCmd));
  lifecycle.addDisposable(registrar.register(resumeCmd));
  lifecycle.addDisposable(registrar.register(stopCmd));
  lifecycle.addDisposable(registrar.register(skipCmd));
  lifecycle.addDisposable(registrar.register(volumeCmd));
  lifecycle.addDisposable(registrar.register(shuffleCmd));
  lifecycle.addDisposable(registrar.register(clearCmd));

  return [pauseCmd, resumeCmd, stopCmd, skipCmd, volumeCmd, shuffleCmd, clearCmd];
}

// Moonlink.js and Discord event handlers
export function registerMusicEvents(ctx, moonlink, queueManager) {
  const { embed, logger, lifecycle } = ctx;
  const moduleName = "music";

  // Track start
  const onTrackStart = (player, track) => {
    const channel = ctx.discordClient.channels.cache.get(player.textChannel);
    if (channel) channel.send({ embeds: [embed.success({ title: `Now playing: ${track.title}` })] });
  };
  moonlink.on("trackStart", onTrackStart);
  lifecycle.addDisposable(() => moonlink.off("trackStart", onTrackStart));

  // Track end
  const onTrackEnd = (player, track) => {
    const guildId = player.guildId;
    const queue = queueManager.getQueue(guildId);
    queueManager.removeTrack(guildId, 0);
    if (queue.length) {
      player.play(queue[0]);
    } else {
      player.destroy();
      const channel = ctx.discordClient.channels.cache.get(player.textChannel);
      if (channel) channel.send({ embeds: [embed.info({ title: "Queue ended. Playback stopped." })] });
    }
  };
  moonlink.on("trackEnd", onTrackEnd);
  lifecycle.addDisposable(() => moonlink.off("trackEnd", onTrackEnd));

  // Error
  const onError = (player, error) => {
    logger.error(`[Music] Player error: ${error}`);
    const channel = ctx.discordClient.channels.cache.get(player.textChannel);
    if (channel) channel.send({ embeds: [embed.error({ title: "Playback error.", description: String(error) })] });
  };
  moonlink.on("error", onError);
  lifecycle.addDisposable(() => moonlink.off("error", onError));
}

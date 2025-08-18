export default function(mod, helpers) {
  const { v2, dsl, embed } = mod;
  const { ensureRainlink, logger, config, tryCreatePlayer } = helpers;

  return v2.createInteractionCommand()
    .setName("play")
    .setDescription("Play a track or playlist")
    .addStringOption(opt => opt.setName("query").setDescription("Search query or URL").setRequired(true))
    .onExecute(dsl.withDeferredReply(dsl.withTryCatch(async (interaction, args) => {
      const query = args.query;
      const member = interaction.member;
      const voiceChannel = member?.voice?.channel;

      const reply = async (payload) => {
        try {
          if (interaction.deferred || interaction.replied) return await interaction.followUp(payload);
          return await interaction.reply(payload);
        } catch (e) {
          logger.warn("Reply failed in play handler", { error: e?.message });
        }
      };

      if (!voiceChannel) {
        await reply({ embeds: [embed.error({ title: "You must be in a voice channel." })], ephemeral: true });
        return;
      }
      if (!helpers.state.ready) {
        await reply({ embeds: [embed.error({ title: "Music subsystem not ready." })], ephemeral: true });
        return;
      }
      const rainlink = ensureRainlink();

      let player;
      try {
        player = await tryCreatePlayer(rainlink, { guildId: interaction.guild.id, textId: interaction.channel.id, voiceId: voiceChannel.id, shardId: 0, volume: config.get("MODULE_MUSIC_DEFAULT_VOLUME") ?? 100 });
  try { helpers.getPanelManager()?.onPlayerCreated(player).catch(() => null); } catch (err) { /* ignore */ }
      } catch (err) {
        await reply({ embeds: [embed.error({ title: "Failed to create player.", description: err?.message })], ephemeral: true });
        return;
      }

      const result = await rainlink.search(query, { requester: interaction.user });
      if (!result.tracks.length) {
        await reply({ embeds: [embed.info({ title: "No results found." })], ephemeral: true });
        return;
      }
      if (result.type === "PLAYLIST") {
        for (const t of result.tracks) player.queue.add(t);
        const e = embed.success({ title: `Queued playlist: ${result.playlistName}`, description: `Queued ${result.tracks.length} tracks.` });
        await reply({ embeds: [e] });
        try { helpers.getPanelManager()?.handleEvent(player, 'trackAdded').catch(() => null); } catch (err) { /* ignore */ }
      } else {
        const track = result.tracks[0];
        player.queue.add(track);
        const e = helpers.buildTrackEmbed(track, { title: `Queued: ${track.title}` });
        await reply({ embeds: [e] });
        try { helpers.getPanelManager()?.handleEvent(player, 'trackAdded').catch(() => null); } catch (err) { /* ignore */ }
      }
      if (!player.playing || player.paused) player.play();
      try { helpers.getPanelManager()?.handleEvent(player, 'play').catch(() => null); } catch (err) { /* ignore */ }
    })));
}

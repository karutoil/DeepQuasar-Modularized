// Music module using Rainlink
// Features: play, skip, pause, resume, stop, queue, nowplaying
export default async function init(ctx) {
  const moduleName = "music";

  const hasFactory = typeof ctx?.createModuleContext === "function";
  const mod = hasFactory ? ctx.createModuleContext(moduleName) : ctx;
  const { logger, config, v2, embed, dsl, lifecycle, client } = mod;

  if (!config.isEnabled("MODULE_MUSIC_ENABLED", true)) {
    logger.info("MODULE_MUSIC_ENABLED=false, skipping music module");
    return { name: moduleName, description: "Music module (disabled)" };
  }

  // Local state
  const state = {
    rainlink: null,
    ready: false,
  };

  // Helpers
  function ensureRainlink() {
    if (!state.rainlink) throw new Error("Rainlink not initialized");
    return state.rainlink;
  }

  // Format milliseconds -> H:MM:SS or M:SS
  function formatDuration(ms) {
    if (!ms && ms !== 0) return "--:--";
    const total = Math.max(0, Math.floor(Number(ms) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  // Small textual progress bar for now-playing embeds
  function progressBar(positionMs, durationMs, size = 20) {
    try {
      if (!positionMs || !durationMs || durationMs <= 0) return '';
      const ratio = Math.max(0, Math.min(1, positionMs / durationMs));
      const filled = Math.round(ratio * size);
      const empty = size - filled;
      const bar = '▰'.repeat(filled) + '▱'.repeat(Math.max(0, empty));
      return `${bar} ${formatDuration(positionMs)} / ${formatDuration(durationMs)}`;
    } catch {
      return '';
    }
  }

  function requesterLabel(r) {
    try {
      return r?.tag || r?.username || (typeof r === 'string' ? r : (r?.id ? `<@${r.id}>` : 'unknown'));
    } catch { return 'unknown'; }
  }

  function buildTrackEmbed(track, opts = {}) {
    const title = opts.title || track.title || 'Track';
    const parts = [];
    parts.push(`${track.author || 'Unknown author'} • ${formatDuration(track.duration)}`);
    if (opts.player && typeof opts.player.position === 'number') {
      const p = progressBar(opts.player.position, track.duration);
      if (p) parts.push(p);
    } else if (typeof opts.position === 'number') {
      const p = progressBar(opts.position, track.duration);
      if (p) parts.push(p);
    }
    if (track.requester) parts.push(`Requested by ${requesterLabel(track.requester)}`);

    const desc = parts.join('\n');
    const embedOpts = {
      title,
      description: desc,
      thumbnail: track.artworkUrl || undefined,
      url: track.uri || undefined,
      fields: [],
    };
    return embed.info(embedOpts);
  }

  // Initialize Rainlink immediately so its internal listeners (client.once('ready'), client.on('raw'))
  // are registered before the gateway 'ready' event and raw packets arrive.
  try {
    logger.info("Initializing Rainlink (module)");
    // Dynamic import to avoid hard dependency at load-time if package not installed yet
    const { Rainlink, Library, RainlinkLoopMode } = await import("rainlink");
    let nodes = [];
    try {
      const raw = config.get("MODULE_MUSIC_NODES") || "[]";
      nodes = JSON.parse(raw);
    } catch (err) {
      logger.warn("Failed to parse MODULE_MUSIC_NODES, using empty list", { error: err?.message });
      nodes = [];
    }

  const rl = new Rainlink({ library: new Library.DiscordJS(client), nodes });
    state.rainlink = rl;
    state.ready = true;
  // expose loop enum for commands
  state.loopEnum = RainlinkLoopMode;

  rl.on("nodeConnect", (node) => logger.info(`[Rainlink] node ${node.options.name} connected`));
    rl.on("nodeError", (node, error) => logger.error("[Rainlink] node error", { node: node.options?.name, error }));
    rl.on("trackStart", (player, track) => {
      try {
        const ch = client.channels.cache.get(player.textId);
        if (ch) ch.send({ embeds: [ buildTrackEmbed(track, { title: `Now playing: ${track.title}`, player }) ] });
      } catch (err) { logger.warn("trackStart handler error", { error: err?.message }); }
    });
    rl.on("trackEnd", (player, track) => {
      try {
        const ch = client.channels.cache.get(player.textId);
        if (ch) ch.send({ embeds: [embed.info({ title: `Finished: ${track?.title ?? "track"}` })] });
      } catch (err) { logger.warn("trackEnd handler error", { error: err?.message }); }
    });
    rl.on("queueEmpty", (player) => {
      try {
        const ch = client.channels.cache.get(player.textId);
        if (ch) ch.send({ embeds: [embed.info({ title: `Queue empty — disconnecting.` })] });
        player.destroy();
      } catch (err) { logger.warn("queueEmpty handler error", { error: err?.message }); }
    });

    lifecycle.addDisposable(async () => {
      try { rl.removeAllListeners?.(); } catch (err) { void err; }
      try { await rl.destroy?.(); } catch (err) { void err; }
      state.rainlink = null; state.ready = false;
    });
  } catch (err) {
    logger.error("Failed to initialize Rainlink", { error: err?.message });
  }

  // Module-scoped helper to create player with retries on voice race conditions
  async function tryCreatePlayer(rainlink, opts) {
    const maxAttempts = 4;
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        return await rainlink.create(opts);
      } catch (err) {
        const msg = String(err?.message || '').toLowerCase();
        if ((msg.includes('missing session id') || msg.includes('session id missing') || msg.includes('missing connection endpoint')) && attempt < maxAttempts) {
          const waitMs = 300 * attempt;
          logger.info(`rainlink.create failed due to voice race, retrying in ${waitMs}ms (attempt ${attempt})`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        throw err;
      }
    }
    throw new Error('Failed to create player after retries');
  }

  // Command builders
  const playCmd = v2.createInteractionCommand()
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
      if (!state.ready) {
        await reply({ embeds: [embed.error({ title: "Music subsystem not ready." })], ephemeral: true });
        return;
      }
      const rainlink = ensureRainlink();

      async function tryCreatePlayer(opts) {
        const maxAttempts = 4;
        let attempt = 0;
        while (attempt < maxAttempts) {
          attempt += 1;
          try {
            return await rainlink.create(opts);
          } catch (err) {
            const msg = String(err?.message || '').toLowerCase();
            // Retry on known race condition where server update arrives before session id
            if ((msg.includes('missing session id') || msg.includes('session id missing') || msg.includes('missing connection endpoint')) && attempt < maxAttempts) {
              const waitMs = 300 * attempt;
              logger.info(`rainlink.create failed due to voice race, retrying in ${waitMs}ms (attempt ${attempt})`);
              await new Promise(r => setTimeout(r, waitMs));
              continue;
            }
            throw err;
          }
        }
        throw new Error('Failed to create player after retries');
      }

      let player;
      try {
        player = await tryCreatePlayer({ guildId: interaction.guild.id, textId: interaction.channel.id, voiceId: voiceChannel.id, shardId: 0, volume: config.get("MODULE_MUSIC_DEFAULT_VOLUME") ?? 100 });
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
      } else {
        const track = result.tracks[0];
        player.queue.add(track);
        const e = buildTrackEmbed(track, { title: `Queued: ${track.title}` });
        await reply({ embeds: [e] });
      }
      if (!player.playing || player.paused) player.play();
    })));

  const skipCmd = v2.createInteractionCommand()
    .setName("skip")
    .setDescription("Skip the current track")
    .onExecute(dsl.withTryCatch(async (interaction) => {
      try {
        const rainlink = ensureRainlink();
        const player = rainlink.players.get(interaction.guild.id);
        if (!player) { await interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true }); return; }
        player.stop();
        await interaction.reply({ embeds: [embed.success({ title: "Skipped." })] });
      } catch (err) { await interaction.reply({ embeds: [embed.error({ title: "Error skipping.", description: err?.message })], ephemeral: true }); }
    }));

  const pauseCmd = v2.createInteractionCommand()
    .setName("pause")
    .setDescription("Pause playback")
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) { await interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true }); return; }
      player.pause(true);
      await interaction.reply({ embeds: [embed.success({ title: "Paused." })] });
    }));

  const resumeCmd = v2.createInteractionCommand()
    .setName("resume")
    .setDescription("Resume playback")
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) { await interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true }); return; }
      player.pause(false);
      await interaction.reply({ embeds: [embed.success({ title: "Resumed." })] });
    }));

  const stopCmd = v2.createInteractionCommand()
    .setName("stop")
    .setDescription("Stop playback and clear queue")
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) { await interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true }); return; }
      player.queue.clear();
      await player.destroy();
      await interaction.reply({ embeds: [embed.success({ title: "Stopped and disconnected." })] });
    }));

  const nowCmd = v2.createInteractionCommand()
    .setName("nowplaying")
    .setDescription("Show the currently playing track")
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      const current = player?.queue?.current;
      if (!player || !current) {
        await interaction.reply({ embeds: [embed.info({ title: "Nothing is playing." })], ephemeral: true });
        return;
      }
      const eNow = buildTrackEmbed(current, { title: `Now playing: ${current.title}` });
      await interaction.reply({ embeds: [eNow] });
    }));

  const queueCmd = v2.createInteractionCommand()
    .setName("queue")
    .setDescription("Show the queue")
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) { await interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true }); return; }
      const current = player.queue.current;
      const upcoming = player.queue.slice(0, 25);
      const fields = [];
      if (current) {
        fields.push({ name: 'Now Playing', value: `${current.title}\n${current.author} • ${formatDuration(current.duration)}`, inline: false });
      }
      if (upcoming.length) {
        const list = upcoming.map((t, i) => `${i + 1}. ${t.title} — ${t.author} (${formatDuration(t.duration)})`).join('\n');
        fields.push({ name: `Upcoming (${player.queue.totalSize - (current ? 1 : 0)})`, value: list, inline: false });
      }
      const total = player.queue.totalSize ?? (upcoming.length + (current ? 1 : 0));
      const qEmbed = embed.info({ title: `Queue (${total})`, description: '\u200b', fields });
      if (current?.artworkUrl) qEmbed.setThumbnail(current.artworkUrl);
      await interaction.reply({ embeds: [qEmbed] });
    }));

  // Register commands and lifecycle
  const regs = [];
  regs.push(v2.register(playCmd, moduleName));
  regs.push(v2.register(skipCmd, moduleName));
  regs.push(v2.register(pauseCmd, moduleName));
  regs.push(v2.register(resumeCmd, moduleName));
  regs.push(v2.register(stopCmd, moduleName));
  regs.push(v2.register(nowCmd, moduleName));
  regs.push(v2.register(queueCmd, moduleName));

  lifecycle.addDisposable(() => { for (const off of regs) try { off?.(); } catch (err) { void err; } });

  // Additional commands
  const joinCmd = v2.createInteractionCommand()
    .setName("join")
    .setDescription("Join your voice channel")
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const member = interaction.member;
      const voiceChannel = member?.voice?.channel;
      if (!voiceChannel) return interaction.reply({ embeds: [embed.error({ title: "You must be in a voice channel." })], ephemeral: true });
      const rainlink = ensureRainlink();
      try {
        await tryCreatePlayer(rainlink, { guildId: interaction.guild.id, textId: interaction.channel.id, voiceId: voiceChannel.id, shardId: 0 });
        await interaction.reply({ embeds: [embed.success({ title: "Joined voice channel." })] });
      } catch (err) {
        await interaction.reply({ embeds: [embed.error({ title: "Failed to join voice.", description: err?.message })], ephemeral: true });
      }
    }));

  const leaveCmd = v2.createInteractionCommand()
    .setName("leave")
    .setDescription("Leave voice and destroy player")
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) return interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true });
      await player.destroy();
      await interaction.reply({ embeds: [embed.success({ title: "Left voice and destroyed player." })] });
    }));

  const volumeCmd = v2.createInteractionCommand()
    .setName("volume")
    .setDescription("Set player volume (0-100)")
    .addIntegerOption(opt => opt.setName("amount").setDescription("Volume 0-100").setRequired(true))
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const amt = interaction.options.getInteger("amount");
      if (isNaN(amt) || amt < 0 || amt > 100) return interaction.reply({ embeds: [embed.error({ title: "Volume must be 0-100." })], ephemeral: true });
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) return interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true });
      await player.setVolume(amt);
      await interaction.reply({ embeds: [embed.success({ title: `Volume set to ${amt}` })] });
    }));

  const seekCmd = v2.createInteractionCommand()
    .setName("seek")
    .setDescription("Seek to position (ms)")
    .addIntegerOption(opt => opt.setName("position").setDescription("Position in milliseconds").setRequired(true))
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const pos = interaction.options.getInteger("position");
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) return interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true });
      try {
        await player.seek(pos);
        await interaction.reply({ embeds: [embed.success({ title: `Seeked to ${pos}ms` })] });
      } catch (err) {
        await interaction.reply({ embeds: [embed.error({ title: "Seek failed.", description: err?.message })], ephemeral: true });
      }
    }));

  const shuffleCmd = v2.createInteractionCommand()
    .setName("shuffle")
    .setDescription("Shuffle the queue")
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) return interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true });
      player.queue.shuffle();
      await interaction.reply({ embeds: [embed.success({ title: "Queue shuffled." })] });
    }));

  const removeCmd = v2.createInteractionCommand()
    .setName("remove")
    .setDescription("Remove a track from the queue by index (1-based)")
    .addIntegerOption(opt => opt.setName("index").setDescription("1-based index").setRequired(true))
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const idx = interaction.options.getInteger("index");
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) return interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true });
      try {
        player.queue.remove(idx - 1);
        await interaction.reply({ embeds: [embed.success({ title: `Removed track at ${idx}` })] });
      } catch (err) {
        await interaction.reply({ embeds: [embed.error({ title: "Remove failed.", description: err?.message })], ephemeral: true });
      }
    }));

  const jumpCmd = v2.createInteractionCommand()
    .setName("jump")
    .setDescription("Jump to queue position (1-based)")
    .addIntegerOption(opt => opt.setName("index").setDescription("1-based index").setRequired(true))
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const idx = interaction.options.getInteger("index");
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) return interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true });
      try {
        const track = player.queue[idx - 1];
        if (!track) throw new Error('No track at that position');
        await player.play(track, { replaceCurrent: true });
        await interaction.reply({ embeds: [embed.success({ title: `Jumped to ${idx}: ${track.title}` })] });
      } catch (err) {
        await interaction.reply({ embeds: [embed.error({ title: "Jump failed.", description: err?.message })], ephemeral: true });
      }
    }));

  const previousCmd = v2.createInteractionCommand()
    .setName("previous")
    .setDescription("Play previous track")
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) return interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true });
      await player.previous();
      await interaction.reply({ embeds: [embed.success({ title: "Playing previous track." })] });
    }));

  const loopCmd = v2.createInteractionCommand()
    .setName("loop")
    .setDescription("Set loop mode: none|song|queue")
    .addStringOption(opt => opt.setName("mode").setDescription("none|song|queue").setRequired(true))
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const mode = interaction.options.getString("mode");
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) return interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true });
      if (!state.loopEnum) return interaction.reply({ embeds: [embed.error({ title: "Loop enum not available." })], ephemeral: true });
      const map = { none: state.loopEnum.NONE ?? 'none', song: state.loopEnum.SONG ?? 'song', queue: state.loopEnum.QUEUE ?? 'queue' };
      const chosen = map[mode];
      if (!chosen) return interaction.reply({ embeds: [embed.error({ title: "Invalid loop mode." })], ephemeral: true });
      player.setLoop(chosen);
      await interaction.reply({ embeds: [embed.success({ title: `Loop set to ${mode}` })] });
    }));

  // Register additional commands
  regs.push(v2.register(joinCmd, moduleName));
  regs.push(v2.register(leaveCmd, moduleName));
  regs.push(v2.register(volumeCmd, moduleName));
  regs.push(v2.register(seekCmd, moduleName));
  regs.push(v2.register(shuffleCmd, moduleName));
  regs.push(v2.register(removeCmd, moduleName));
  regs.push(v2.register(jumpCmd, moduleName));
  regs.push(v2.register(previousCmd, moduleName));
  regs.push(v2.register(loopCmd, moduleName));

  return {
    name: moduleName,
    description: "Music module powered by Rainlink",
    dispose: async () => {
      logger.info("Music module unloaded.");
    // Rainlink cleanup handled via lifecycle disposables registered above
    }
  };
}

// Music module using Rainlink
// Features: play, skip, pause, resume, stop, queue, nowplaying
export default async function init(ctx) {
  const moduleName = "music";

  const hasFactory = typeof ctx?.createModuleContext === "function";
  const mod = hasFactory ? ctx.createModuleContext(moduleName) : ctx;
  const { logger, config, v2, embed, _dsl, lifecycle, client } = mod;

  if (!config.isEnabled("MODULE_MUSIC_ENABLED", true)) {
    logger.info("MODULE_MUSIC_ENABLED=false, skipping music module");
    return { name: moduleName, description: "Music module (disabled)" };
  }

  // Local state
  const state = {
    rainlink: null,
    ready: false,
  };
  // Panel manager will track persistent panels per guild
  let panelManager = null;

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
  if (panelManager) panelManager.handleEvent(player, 'trackStart').catch(() => null);
      } catch (err) { logger.warn("trackStart handler error", { error: err?.message }); }
    });
    rl.on("trackEnd", (player, track) => {
      try {
        const ch = client.channels.cache.get(player.textId);
        if (ch) ch.send({ embeds: [embed.info({ title: `Finished: ${track?.title ?? "track"}` })] });
  if (panelManager) panelManager.handleEvent(player, 'trackEnd').catch(() => null);
      } catch (err) { logger.warn("trackEnd handler error", { error: err?.message }); }
    });
    rl.on("queueEmpty", (player) => {
      try {
        const ch = client.channels.cache.get(player.textId);
        if (ch) ch.send({ embeds: [embed.info({ title: `Queue empty — disconnecting.` })] });
        player.destroy();
  // don't touch panel on queueEmpty; panel lifecycle is tied to trackStart/trackEnd
      } catch (err) { logger.warn("queueEmpty handler error", { error: err?.message }); }
    });

    lifecycle.addDisposable(async () => {
      try { rl.removeAllListeners?.(); } catch (err) { void err; }
      // Destroy all players first (best-effort)
      try {
        if (rl.players && typeof rl.players.values === 'function') {
          for (const p of rl.players.values()) {
            try { await p.destroy?.(); } catch (err) { /* ignore per-player errors */ }
          }
        }
      } catch (err) { /* ignore players iteration errors */ }
      try { await rl.destroy?.(); } catch (err) { void err; }
      state.rainlink = null; state.ready = false;
      // Attempt to clean up any panels we know about
      try {
        if (panelManager && typeof panelManager.dispose === 'function') await panelManager.dispose();
      } catch (err) { void err; }
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

  // Instantiate panel manager (moved below PanelManager declaration)

  /** Panel manager: creates and maintains a persistent queue panel per guild when enabled.
   * Behavior:
   * - When a player is first created, if persistent panel enabled for the guild, record origin channelId
   *   (if not already set) and post a queue panel in that channel.
   * - Listens for messages in the panel channel and will repost the panel after a threshold (default 5).
   * - Also reposts on important music events (track start/end, track added, queue empty).
   */
  class PanelManager {
    constructor(ctx) {
      this.ctx = ctx;
      this.client = ctx.client;
      this.embed = ctx.embed;
      this.logger = ctx.logger;
      this.config = ctx.config;
    this.panels = {}; // guildId -> { channelId, messageId, counter }
    }

    async dispose() {
      // Attempt to delete any posted panel messages and clear timers, then clear in-memory state.
      try {
        for (const guildId of Object.keys(this.panels)) {
          const p = this.panels[guildId];
          try {
            if (p.updateTimer) {
              clearTimeout(p.updateTimer);
              p.updateTimer = null;
            }
            if (p.messageId && p.channelId) {
              const channel = this.client.channels.cache.get(p.channelId);
              if (channel) {
                const old = await channel.messages.fetch(p.messageId).catch(() => null);
                if (old) await old.delete().catch(() => null);
              }
            }
          } catch (err) { /* ignore per-panel errors */ }
        }
      } catch (err) { this.logger.warn('PanelManager.dispose failed', { error: err?.message }); }
      this.panels = {};
    }

    async onPlayerCreated(player) {
      try {
        // No-op: panel creation is handled on trackStart only.
        // Keep a record of origin channel if desired in-memory, but do not post here.
        const guildId = player.guildId || player.guild?.id || null;
        const originChannel = player.textId || null;
        if (!guildId || !originChannel) return;
        const s = await (await import('./services/settingsService.js')).getSettings(this.ctx, guildId);
        if (!s || !s.persistentQueuePanel || !s.persistentQueuePanel.enabled) return;
        this.panels[guildId] = this.panels[guildId] || { channelId: originChannel, messageId: null, counter: 0 };
      } catch (err) { this.logger.warn('onPlayerCreated failed', { error: err?.message }); }
    }

    async handleEvent(player, reason = 'update') {
      try {
        const guildId = player.guildId || player.guild?.id || null;
        if (!guildId) return;
        const s = await (await import('./services/settingsService.js')).getSettings(this.ctx, guildId);
        if (!s || !s.persistentQueuePanel || !s.persistentQueuePanel.enabled) return;
        // Only act on trackStart (post/update) and trackEnd (delete)
        if (reason === 'trackStart') {
          const channelId = player.textId || (this.panels[guildId] && this.panels[guildId].channelId) || null;
          if (!channelId) return;
          // clear any pending update debounce for this guild since we're posting on trackStart
          if (this.panels[guildId] && this.panels[guildId].updateTimer) {
            clearTimeout(this.panels[guildId].updateTimer);
            this.panels[guildId].updateTimer = null;
          }
          this.panels[guildId] = this.panels[guildId] || { channelId, messageId: null, counter: 0 };
          await this.repostPanel(guildId, player);
        } else if (reason === 'trackEnd') {
          // delete the panel message if present
          const p = this.panels[guildId];
          if (!p || !p.messageId) return;
          try {
            const channel = this.client.channels.cache.get(p.channelId);
            if (channel) {
              const old = await channel.messages.fetch(p.messageId).catch(() => null);
              if (old) await old.delete().catch(() => null);
            }
          } catch (err) { void err; }
          // clear any pending update timer and remove panel entry
          if (p.updateTimer) {
            clearTimeout(p.updateTimer);
            p.updateTimer = null;
          }
          delete this.panels[guildId];
        }
        else if (reason === 'queueUpdated') {
          // Schedule a debounced delete+repost after configured delay.
          const p = this.panels[guildId] = this.panels[guildId] || { channelId: player.textId || null, messageId: null, counter: 0 };
          const debounceMs = Number(this.config.get('MODULE_MUSIC_PANEL_DEBOUNCE_MS') || 3000);
          // clear existing timer
          if (p.updateTimer) clearTimeout(p.updateTimer);
          // schedule repost after debounce
          p.updateTimer = setTimeout(async () => {
            try {
              // clear the timer ref
              p.updateTimer = null;
              await this.repostPanel(guildId, player);
            } catch (err) { this.logger.warn('deferred repost failed', { error: err?.message, guildId }); }
          }, debounceMs);
        }
      } catch (err) { this.logger.warn('handleEvent failed', { error: err?.message }); }
    }

    async repostPanel(guildId, player) {
      try {
        const p = this.panels[guildId];
        if (!p) return;
        // debounce reposts that happen in quick succession
        const now = Date.now();
        const debounceMs = Number(this.config.get('MODULE_MUSIC_PANEL_DEBOUNCE_MS') || 3000);
        if (p.lastPosted && (now - p.lastPosted) < debounceMs) {
          this.logger.info('Skipping repost due to debounce', { guildId, delta: now - p.lastPosted });
          return;
        }
        const channel = this.client.channels.cache.get(p.channelId);
        if (!channel) return;
        // delete old message if present
        if (p.messageId) {
          try {
            const old = await channel.messages.fetch(p.messageId).catch(() => null);
            if (old) await old.delete().catch(() => null);
          } catch (err) { void err; }
        }
        // build embed from player if provided or try to fetch player
        const pl = player || (this.ctx.core?.rainlink?.players?.get ? this.ctx.core.rainlink.players.get(guildId) : null) || (this.ctx.rainlink?.players?.get ? this.ctx.rainlink.players.get(guildId) : null) || null;
        const embedMsg = this._buildQueueEmbed(pl);
  const sent = await channel.send({ embeds: [embedMsg] });
  p.messageId = sent.id;
  p.counter = 0;
  p.lastPosted = Date.now();
      } catch (err) { this.logger.warn('repostPanel error', { error: err?.message }); }
    }

    _buildQueueEmbed(player) {
      try {
        if (!player) return this.embed.info({ title: 'Queue', description: 'No active player.' });
        const current = player.queue?.current;
        const upcoming = player.queue?.slice ? player.queue.slice(0, 25) : [];
        const fields = [];
        if (current) {
          fields.push({ name: 'Now Playing', value: `${current.title}\n${current.author} • ${formatDuration(current.duration)}`, inline: false });
        }
        if (upcoming.length) {
          const list = upcoming.map((t, i) => `${i + 1}. ${t.title} — ${t.author} (${formatDuration(t.duration)})`).join('\n');
          fields.push({ name: `Upcoming (${player.queue.totalSize - (current ? 1 : 0)})`, value: list, inline: false });
        }
        const total = player.queue?.totalSize ?? (upcoming.length + (current ? 1 : 0));
        const qEmbed = this.embed.info({ title: `Queue (${total})`, description: '\u200b', fields });
        if (current?.artworkUrl) qEmbed.setThumbnail(current.artworkUrl);
        return qEmbed;
      } catch (err) { return this.embed.info({ title: 'Queue', description: 'Error building queue.' }); }
    }

    async _postPanelMessage(guildId, player) {
      try {
        const p = this.panels[guildId];
        if (!p) return;
        const channel = this.client.channels.cache.get(p.channelId);
        if (!channel) return;
        const embedMsg = this._buildQueueEmbed(player);
        // Prevent immediate duplicate posts
        const now = Date.now();
        const debounceMs = Number(this.config.get('MODULE_MUSIC_PANEL_DEBOUNCE_MS') || 3000);
        if (p.lastPosted && (now - p.lastPosted) < debounceMs) {
          this.logger.info('Skipping initial post due to debounce', { guildId, delta: now - p.lastPosted });
          return;
        }
        // delete previous message if present
        if (p.messageId) {
          try {
            const old = await channel.messages.fetch(p.messageId).catch(() => null);
            if (old) await old.delete().catch(() => null);
          } catch (err) { void err; }
        }
        const sent = await channel.send({ embeds: [embedMsg] });
        p.messageId = sent.id;
        p.counter = 0;
        p.lastPosted = Date.now();
      } catch (err) { this.logger.warn('postPanel failed', { error: err?.message }); }
    }
  }

  // Instantiate panel manager after class declaration
  try {
    panelManager = new PanelManager(mod);
    lifecycle.addDisposable(async () => { try { await panelManager.dispose(); } catch (err) { void err; } });
  } catch (err) { logger.warn('Failed to create PanelManager', { error: err?.message }); }

  // Command builders
  // Load command builders from separate files
  const regs = [];
  const cmdHelpers = { state, ensureRainlink, buildTrackEmbed, tryCreatePlayer, formatDuration, requesterLabel, logger, config, getPanelManager: () => panelManager };
  try {
    const playMod = await import('./commands/play.js');
    const skipMod = await import('./commands/skip.js');
    const pauseMod = await import('./commands/pause.js');
    const resumeMod = await import('./commands/resume.js');
    const stopMod = await import('./commands/stop.js');
    const nowMod = await import('./commands/nowplaying.js');
    const queueMod = await import('./commands/queue.js');

    const joinMod = await import('./commands/join.js');
    const leaveMod = await import('./commands/leave.js');
    const volumeMod = await import('./commands/volume.js');
    const seekMod = await import('./commands/seek.js');
    const shuffleMod = await import('./commands/shuffle.js');
    const removeMod = await import('./commands/remove.js');
    const jumpMod = await import('./commands/jump.js');
    const previousMod = await import('./commands/previous.js');
    const loopMod = await import('./commands/loop.js');
  const settingsMod = await import('./commands/settings.js');

    const playCmd = playMod.default(mod, cmdHelpers);
    const skipCmd = skipMod.default(mod, cmdHelpers);
    const pauseCmd = pauseMod.default(mod, cmdHelpers);
    const resumeCmd = resumeMod.default(mod, cmdHelpers);
    const stopCmd = stopMod.default(mod, cmdHelpers);
    const nowCmd = nowMod.default(mod, cmdHelpers);
    const queueCmd = queueMod.default(mod, cmdHelpers);

    const joinCmd = joinMod.default(mod, cmdHelpers);
    const leaveCmd = leaveMod.default(mod, cmdHelpers);
    const volumeCmd = volumeMod.default(mod, cmdHelpers);
    const seekCmd = seekMod.default(mod, cmdHelpers);
    const shuffleCmd = shuffleMod.default(mod, cmdHelpers);
    const removeCmd = removeMod.default(mod, cmdHelpers);
    const jumpCmd = jumpMod.default(mod, cmdHelpers);
    const previousCmd = previousMod.default(mod, cmdHelpers);
    const loopCmd = loopMod.default(mod, cmdHelpers);
  const settingsCmd = settingsMod.default(mod, cmdHelpers);

    regs.push(v2.register(playCmd, moduleName));
    regs.push(v2.register(skipCmd, moduleName));
    regs.push(v2.register(pauseCmd, moduleName));
    regs.push(v2.register(resumeCmd, moduleName));
    regs.push(v2.register(stopCmd, moduleName));
    regs.push(v2.register(nowCmd, moduleName));
    regs.push(v2.register(queueCmd, moduleName));

    regs.push(v2.register(joinCmd, moduleName));
    regs.push(v2.register(leaveCmd, moduleName));
    regs.push(v2.register(volumeCmd, moduleName));
    regs.push(v2.register(seekCmd, moduleName));
    regs.push(v2.register(shuffleCmd, moduleName));
    regs.push(v2.register(removeCmd, moduleName));
    regs.push(v2.register(jumpCmd, moduleName));
    regs.push(v2.register(previousCmd, moduleName));
    regs.push(v2.register(loopCmd, moduleName));
  regs.push(v2.register(settingsCmd, moduleName));
  } catch (err) {
    logger.warn('Failed to load command modules', { error: err?.message });
  }

  lifecycle.addDisposable(() => { for (const off of regs) try { off?.(); } catch (err) { void err; } });

  // ... command implementations moved to individual files under ./commands

  return {
    name: moduleName,
    description: "Music module powered by Rainlink",
    dispose: async () => {
      logger.info("Music module unloaded.");
      // Best-effort: destroy players and cleanup panels if lifecycle didn't already.
      try {
        const rl = state.rainlink || (mod.core && mod.core.rainlink) || null;
        if (rl && rl.players && typeof rl.players.values === 'function') {
          for (const p of rl.players.values()) {
            try { await p.destroy?.(); } catch (err) { /* ignore */ }
          }
        }
      } catch (err) { /* ignore */ }
      try { if (panelManager && typeof panelManager.dispose === 'function') await panelManager.dispose(); } catch (err) { /* ignore */ }
      // Rainlink cleanup handled via lifecycle disposables registered above
    }
  };
}

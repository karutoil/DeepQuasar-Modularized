// Music Module Entry Point
import { LavalinkManager } from "lavalink-client";
import { createPlayCommand } from "./handlers/play.js";
import { createSkipCommand } from "./handlers/skip.js";
import { createStopCommand } from "./handlers/stop.js";
import { createQueueCommand } from "./handlers/queue.js";
import { createNowPlayingCommand } from "./handlers/nowplaying.js";
import { createPauseCommand } from "./handlers/pause.js";
import { createResumeCommand } from "./handlers/resume.js";
import { createLoopCommand } from "./handlers/loop.js";
import { createVolumeCommand } from "./handlers/volume.js";
import { createSeekCommand } from "./handlers/seek.js";
import { createDisconnectCommand } from "./handlers/disconnect.js";
import { ensureIndexes } from "./services/settings.js";

export default async function init(ctx) {
  const { logger, config, lifecycle, v2 } = ctx;
  const moduleName = "music";

  if (!config.isEnabled("MODULE_MUSIC_ENABLED", true)) {
    logger.info("[Music] Module disabled via config.");
    return { name: moduleName, description: "Music module (disabled)" };
  }

  // Ensure DB indexes
  await ensureIndexes(ctx);

  // Initialize Lavalink Manager
  // Read and validate Lavalink config. Support single-node env vars or JSON LAVALINK_NODES
  const lavalinkNodesRaw = config.get("LAVALINK_NODES") || "";
  let nodesConfig = [];

  if (lavalinkNodesRaw) {
    try {
      // Allow JSON array or CSV-ish fallback
      nodesConfig = typeof lavalinkNodesRaw === 'string' ? JSON.parse(lavalinkNodesRaw) : lavalinkNodesRaw;
      if (!Array.isArray(nodesConfig)) nodesConfig = [];
    } catch (err) {
      logger.warn('[Music] Could not parse LAVALINK_NODES as JSON, falling back to single-node env parsing.');
    }
  }

  // Fallback to legacy single-node env vars
  if (nodesConfig.length === 0) {
    const lavalinkHost = config.get("LAVALINK_HOST");
    const lavalinkPort = config.get("LAVALINK_PORT");
    const lavalinkPassword = config.get("LAVALINK_PASSWORD");
    const lavalinkSecure = config.get("LAVALINK_SECURE") || config.get("LAVALINK_USE_TLS") || false;

    logger.debug(`[Music] Lavalink config: Host=${lavalinkHost}, Port=${lavalinkPort}, Password=${lavalinkPassword ? '***' : 'undefined'}, Secure=${!!lavalinkSecure}`);

    if (!lavalinkHost || !lavalinkPort || !lavalinkPassword) {
      logger.error("[Music] Lavalink host, port, or password not configured. Music module cannot start.");
      return { name: moduleName, description: "Music module (error: config missing)" };
    }

    const portNum = Number(lavalinkPort);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      logger.error(`[Music] Invalid LAVALINK_PORT: ${lavalinkPort}. Must be an integer between 1 and 65535.`);
      return { name: moduleName, description: "Music module (error: config invalid)" };
    }

    nodesConfig = [
      {
        id: "main",
        host: lavalinkHost,
        port: portNum,
        password: lavalinkPassword,
        secure: !!lavalinkSecure,
      }
    ];
  }

  const manager = new LavalinkManager({
    nodes: nodesConfig.map(n => ({
      id: n.id || `${n.host}:${n.port}`,
      host: n.host,
      port: Number(n.port),
      authorization: n.password || n.authorization,
      secure: !!n.secure,
    })),
    sendToShard: (guildId, payload) => {
      try {
        const guild = ctx.client.guilds.cache.get(guildId);
        if (guild && guild.shard && typeof guild.shard.send === 'function') {
          return guild.shard.send(payload);
        }
        // Fallbacks for different Discord.js versions or missing guild cache
        if (ctx.client.shard && typeof ctx.client.shard.broadcast === 'function') {
          return ctx.client.shard.broadcast(payload, { guild_id: guildId });
        }
        if (ctx.client.ws && typeof ctx.client.ws.send === 'function') {
          // Best-effort: send raw payload via WebSocket if available and supports it
          return ctx.client.ws.send(payload);
        }
        logger.warn(`[Music] Unable to send payload to guild ${guildId}: guild not cached and no shard fallback available.`);
      } catch (err) {
        logger.warn(`[Music] sendToShard error for guild ${guildId}: ${err.message}`);
      }
    },
    autoSkip: true,
    playerOptions: {
      applyVolumeAsFilter: false,
      clientBasedPositionUpdateInterval: 50,
      defaultSearchPlatform: "ytsearch",
      volumeDecrementer: 0.75,
      onDisconnect: {
        autoReconnect: true,
        destroyPlayer: false
      },
      onEmptyQueue: {
        destroyAfterMs: 30_000,
      },
      useUnresolvedData: true,
    },
    advancedOptions: {
      enableDebugEvents: true,
      maxFilterFixDuration: 600_000, // only allow instafixfilterupdate for tracks sub 10mins
      debugOptions: {
        noAudio: false,
        playerDestroy: {
          dontThrowError: false,
          debugLog: false,
        },
        logCustomSearches: false,
      }
    }
  });

  manager.on("nodeConnect", node => logger.info(`[Music] Node "${node.id}" connected.`));
  manager.on("nodeDisconnect", node => logger.warn(`[Music] Node "${node.id}" disconnected.`));
  manager.on("nodeError", (node, error) => {
    try {
      logger.error(`[Music] Node "${node?.id}" encountered an error: ${error?.message}`);
      logger.debug(error?.stack || 'No stack available');
    } catch (err) {
      logger.warn(`[Music] Error logging nodeError: ${err.message}`);
    }
  });

  manager.on("trackStart", (player, track) => {
    try {
      const title = track?.info?.title || '<unknown title>';
      const author = track?.info?.author || '<unknown author>';
      logger.info(`[Music] Started playing ${title} by ${author} on guild ${player?.guildId} in channel ${player?.voiceChannelId}`);
      logger.debug(`[Music] Track details: ${JSON.stringify(track?.info || {})}`);
    } catch (err) {
      logger.warn(`[Music] trackStart handler failed: ${err.message}`);
    }
  });

  manager.on("trackEnd", (player, track) => {
    try {
      const title = track?.info?.title || '<unknown title>';
      logger.info(`[Music] Finished playing ${title} on guild ${player?.guildId}.`);
      if (!player) return;
      if (player._transitioning) {
        logger.debug(`[Music] trackEnd ignored because player ${player.guildId} is transitioning.`);
        return;
      }
      if (player.queue && player.queue.size > 0) {
        player._transitioning = true;
        if (typeof player.play === 'function') player.play();
        player._transitioning = false;
      } else {
        logger.info(`[Music] Queue ended on guild ${player?.guildId}.`);
      }
    } catch (err) {
      logger.warn(`[Music] trackEnd handler failed: ${err.message}`);
    }
  });

  manager.on("queueEnd", player => {
    try {
      logger.info(`[Music] Queue ended on guild ${player?.guildId} in channel ${player?.voiceChannelId}. Destroying player.`);
      if (player) {
        if (player._transitioning) {
          logger.debug(`[Music] queueEnd ignored because player ${player.guildId} is transitioning.`);
          return;
        }
        player._transitioning = true;
        if (typeof player.destroy === 'function') player.destroy();
        player._transitioning = false;
      }
    } catch (err) {
      logger.warn(`[Music] queueEnd handler failed: ${err.message}`);
    }
  });

  // CRITICAL: Handle Discord raw events for voice connections
  const rawHandler = d => manager.sendRawData(d);
  ctx.client.on('raw', rawHandler);
  lifecycle.addDisposable(() => ctx.client.off('raw', rawHandler));

  // Expose manager to context for other handlers
  ctx.music = {
    manager,
  };

  // Initialize Lavalink Manager when the Discord client is ready
  const onReady = async () => {
    try {
      await manager.init({
        id: ctx.client.user.id,
        username: ctx.client.user.username,
      });
      logger.info("[Music] Lavalink Manager initialized.");
    } catch (error) {
      logger.error(`[Music] Failed to initialize Lavalink Manager: ${error.message}`);
    }
  };
  ctx.client.once("ready", onReady);
  lifecycle.addDisposable(() => ctx.client.off("ready", onReady));

  // Register music commands
  const cmdPlay = createPlayCommand(ctx);
  const disposePlayCmd = v2.register(cmdPlay, moduleName);

  const cmdSkip = createSkipCommand(ctx);
  const disposeSkipCmd = v2.register(cmdSkip, moduleName);

  const cmdStop = createStopCommand(ctx);
  const disposeStopCmd = v2.register(cmdStop, moduleName);

  const cmdQueue = createQueueCommand(ctx);
  const disposeQueueCmd = v2.register(cmdQueue, moduleName);

  const cmdNowPlaying = createNowPlayingCommand(ctx);
  const disposeNowPlayingCmd = v2.register(cmdNowPlaying, moduleName);

  const cmdPause = createPauseCommand(ctx);
  const disposePauseCmd = v2.register(cmdPause, moduleName);

  const cmdResume = createResumeCommand(ctx);
  const disposeResumeCmd = v2.register(cmdResume, moduleName);

  const cmdLoop = createLoopCommand(ctx);
  const disposeLoopCmd = v2.register(cmdLoop, moduleName);

  const cmdVolume = createVolumeCommand(ctx);
  const disposeVolumeCmd = v2.register(cmdVolume, moduleName);

  const cmdSeek = createSeekCommand(ctx);
  const disposeSeekCmd = v2.register(cmdSeek, moduleName);

  const cmdDisconnect = createDisconnectCommand(ctx);
  const disposeDisconnectCmd = v2.register(cmdDisconnect, moduleName);
  lifecycle.addDisposable(disposePlayCmd);
  lifecycle.addDisposable(disposeSkipCmd);
  lifecycle.addDisposable(disposeStopCmd);
  lifecycle.addDisposable(disposeQueueCmd);
  lifecycle.addDisposable(disposeNowPlayingCmd);
  lifecycle.addDisposable(disposePauseCmd);
  lifecycle.addDisposable(disposeResumeCmd);
  lifecycle.addDisposable(disposeLoopCmd);
  lifecycle.addDisposable(disposeVolumeCmd);
  lifecycle.addDisposable(disposeSeekCmd);
  lifecycle.addDisposable(disposeDisconnectCmd);

  let _disposed = false;
  async function disposeModule() {
    if (_disposed) return;
    _disposed = true;
    logger.info("[Music] Module unloaded.");
    try {
      disposePlayCmd?.();
      disposeSkipCmd?.();
      disposeStopCmd?.();
      disposeQueueCmd?.();
      disposeNowPlayingCmd?.();
      disposePauseCmd?.();
      disposeResumeCmd?.();
      disposeLoopCmd?.();
      disposeVolumeCmd?.();
      disposeSeekCmd?.();
      disposeDisconnectCmd?.();
    } catch (err) {
      logger.warn(`[Music] Error disposing commands: ${err.message}`);
    }
    try {
      manager.nodeManager.disconnectAll(false, true);
    } catch (err) {
      logger.warn(`[Music] Error disconnecting nodes: ${err.message}`);
    }
  }

  lifecycle.addDisposable(() => disposeModule());

  logger.info("[Music] Module loaded.");
  return {
    name: moduleName,
    description: "Feature-rich music module powered by Lavalink.",
    dispose: disposeModule
  };
}

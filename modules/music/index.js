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
  const lavalinkHost = config.get("LAVALINK_HOST");
  const lavalinkPort = config.get("LAVALINK_PORT");
  const lavalinkPassword = config.get("LAVALINK_PASSWORD");

  logger.debug(`[Music] Lavalink config: Host=${lavalinkHost}, Port=${lavalinkPort}, Password=${lavalinkPassword ? '***' : 'undefined'}`);

  if (!lavalinkHost || !lavalinkPort || !lavalinkPassword) {
    logger.error("[Music] Lavalink host, port, or password not configured. Music module cannot start.");
    return { name: moduleName, description: "Music module (error: config missing)" };
  }

  const manager = new LavalinkManager({
    nodes: [
      {
        id: "main", // You can make this configurable if needed
        host: lavalinkHost,
        port: Number(lavalinkPort),
        authorization: lavalinkPassword,
        secure: false, // You can make this configurable if needed
      },
    ],
    sendToShard: (guildId, payload) => {
      const guild = ctx.client.guilds.cache.get(guildId);
      if (guild) guild.shard.send(payload);
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
  manager.on("nodeError", (node, error) => logger.error(`[Music] Node "${node.id}" encountered an error: ${error.message}`));
  manager.on("trackStart", (player, track) => {
    logger.info(`[Music] Started playing ${track.info.title} by ${track.info.author} on guild ${player.guildId} in channel ${player.voiceChannelId}`);
    logger.debug(`[Music] Track details: ${JSON.stringify(track.info)}`);
  });
  manager.on("trackEnd", (player, track) => {
    logger.info(`[Music] Finished playing ${track.info.title} on guild ${player.guildId}.`);
    if (player.queue.size > 0) {
      player.play();
    } else {
      logger.info(`[Music] Queue ended on guild ${player.guildId}.`);
      // Optionally destroy player after a delay if no more tracks and nobody is in voice channel
      // For now, let's rely on onEmptyQueue destroyAfterMs
    }
  });

  manager.on("queueEnd", player => {
    logger.info(`[Music] Queue ended on guild ${player.guildId} in channel ${player.voiceChannelId}. Destroying player.`);
    player.destroy();
  });

  // CRITICAL: Handle Discord raw events for voice connections
  ctx.client.on("raw", d => manager.sendRawData(d));
  lifecycle.addDisposable(() => ctx.client.off("raw", d => manager.sendRawData(d)));

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

  lifecycle.addDisposable(() => {
    logger.info("[Music] Module unloaded.");
    manager.destroy(); // Disconnect from Lavalink
  });

  logger.info("[Music] Module loaded.");
  return {
    name: moduleName,
    description: "Feature-rich music module powered by Lavalink.",
    dispose: async () => {
      logger.info("[Music] Module unloaded.");
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
      manager.destroy();
    }
  };
}

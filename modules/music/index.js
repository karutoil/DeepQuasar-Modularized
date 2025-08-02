// Music Module Entry Point
import { createMoonlinkClient } from "./services/moonlinkClient.js";
import { createPlayCommand } from "./handlers/play.js";
import { createQueueCommand } from "./handlers/queue.js";
import { createControlCommands } from "./handlers/controls.js";
import { registerMusicEvents } from "./handlers/events.js";
import { createNowPlayingCommand } from "./handlers/nowplaying.js";
import { createSeekCommand } from "./handlers/seek.js";
import { createMusicStatusCommand } from "./handlers/status.js";
import { createInactivityService } from "./services/inactivityService.js";

export default async function init(ctx) {
  const { logger, config, lifecycle } = ctx;
  const moduleName = "music";

  if (!config.isEnabled("MODULE_MUSIC_ENABLED", true)) {
    logger.info("Music module disabled via config.");
    return { name: moduleName, description: "Music module (disabled)" };
  }

  // Initialize Moonlink.js Manager
  const moonlink = createMoonlinkClient(ctx); // returns Manager
  // Store on ctx immediately so handlers loaded below can access the latest instance
  ctx.moonlink = moonlink;

  // Inactivity strategy: keep service until Moonlink autoLeave is adopted in Lavalink stack
  const inactivity = createInactivityService(ctx, moonlink);

  // Make moonlink available in ctx for handlers that derive it from context
  // (already set above immediately after creation)

  // Forward Discord raw events to Moonlink Manager for voice state updates
  {
    const rawHandler = (packet) => {
      try {
        if (moonlink && typeof moonlink.packetUpdate === "function") {
          moonlink.packetUpdate(packet);
        }
      } catch (e) {
        logger.warn("[Moonlink] packetUpdate forwarding error", { error: e?.message });
      }
    };
    ctx.client.on("raw", rawHandler);
    lifecycle.addDisposable(() => {
      try { ctx.client.off("raw", rawHandler); } catch {}
    });
  }

  // Register commands (all Moonlink-native; no QueueManager/PlayerSession)
  createPlayCommand(ctx, moonlink);
  createQueueCommand(ctx);
  createControlCommands(ctx, moonlink);
  createNowPlayingCommand(ctx, moonlink);
  createSeekCommand(ctx, moonlink);
  createMusicStatusCommand(ctx, moonlink);
  // New: /search command
  try {
    const { createSearchCommand } = await import("./handlers/play.js");
    createSearchCommand(ctx, moonlink);
  } catch (e) {
    logger.warn("[Music] Failed to register /search command", { error: e?.message });
  }

  // Register events (Moonlink-native)
  registerMusicEvents(ctx, moonlink);

  // Voice empty watcher -> inactivity auto leave
  {
    const voiceHandler = (oldState, newState) => {
      try {
        const guildId = (oldState?.guild?.id) || (newState?.guild?.id);
        if (!guildId) return;
        const player = moonlink.players?.get?.(guildId);
        if (!player) return;
        const channelId = player.voiceChannelId || player.voiceChannel || oldState?.channelId || newState?.channelId;
        if (!channelId) return;
        const channel = oldState?.guild?.channels?.cache?.get(channelId) || newState?.guild?.channels?.cache?.get(channelId);
        if (!channel || !channel.members) return;
        const nonBotCount = channel.members.filter(m => !m.user?.bot).size;
        if (nonBotCount === 0) {
          inactivity.schedule(guildId, player);
        } else {
          inactivity.clear(guildId);
        }
      } catch (e) {
        logger.warn("[Music] voiceStateUpdate handling error", { error: e?.message });
      }
    };
    ctx.client.on("voiceStateUpdate", voiceHandler);
    lifecycle.addDisposable(() => {
      try { ctx.client.off("voiceStateUpdate", voiceHandler); } catch {}
    });
  }

  logger.info("Music module loaded.");
  return {
    name: moduleName,
    description: "Music playback and queue management using Moonlink.js Manager.",
    postReady: async (readyCtx) => {
      try {
        const userId = readyCtx.client?.user?.id;
        readyCtx.logger.info("[Moonlink] postReady init", { userIdPresent: Boolean(userId), userId });
        if (userId) {
          // Always re-init the freshly created Manager instance on hot reload.
          // Guard only prevents double init within the same module lifetime.
          if (moonlink && moonlink.init) {
            try {
              await moonlink.init(userId);
              // Attach a lightweight ready resolver so commands don't run before nodes are connected
              if (typeof moonlink.__initialized === "undefined") {
                Object.defineProperty(moonlink, "__initialized", { value: true, writable: false });
              }
              readyCtx.logger.info("[Moonlink] postReady init() invoked");
            } catch (e) {
              readyCtx.logger.error("[Moonlink] init failed", { error: e?.message || e });
            }
          }
        } else {
          readyCtx.logger.warn("[Moonlink] postReady: Client user id not available");
        }
      } catch (err) {
        readyCtx.logger.error("[Moonlink] postReady init error", { error: err });
      }
    },
    dispose: async () => {
      logger.info("Music module unloaded.");
      // Hot-reload safe teardown: only destroy Manager transport to keep Lavalink sessions resumable
      try { moonlink?.destroy?.(); } catch {}
      try {
        for (const [gid] of inactivity.timers || []) inactivity.clear(gid);
      } catch {}
    }
  };
}

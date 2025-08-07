// Music Module Entry Point
import { createMoonlinkClient } from "./services/moonlinkClient.js";
import { QueueManager } from "./services/queueManager.js";
import { createPlayCommand } from "./handlers/play.js";
import { createQueueCommand } from "./handlers/queue.js";
import { createControlCommands } from "./handlers/controls.js";
import { registerMusicEvents } from "./handlers/events.js";

export default async function init(ctx) {
  const { logger, config, lifecycle } = ctx;
  const moduleName = "music";

  // Feature flag
  if (!config.isEnabled("MODULE_MUSIC_ENABLED", true)) {
    logger.info("Music module disabled via config.");
    return { name: moduleName, description: "Music module (disabled)" };
  }

  // Initialize Moonlink.js Manager and queue manager
  const moonlink = createMoonlinkClient(ctx); // returns Manager
  const queueManager = new QueueManager();

  // Register commands
  createPlayCommand(ctx, moonlink, queueManager);
  createQueueCommand(ctx, queueManager);
  createControlCommands(ctx, moonlink, queueManager);

  // Register events
  registerMusicEvents(ctx, moonlink, queueManager);

  //logger.info("Music module loaded.");
  return {
    name: moduleName,
    description: "Music playback and queue management using Moonlink.js Manager.",
    dispose: async () => {
      logger.info("Music module unloaded.");
      moonlink.destroy();
      // All handlers/events are cleaned up via lifecycle disposables
    },
  };
}


import { createShoukakuManager } from './services/shoukakuManager.js';
import { QueueManager } from './services/queueManager.js';
import { registerPlayCommand } from './handlers/play.js';
import { registerControlCommands } from './handlers/controls.js';
import { registerQueueCommands } from './handlers/queue.js';
import { registerPlayerEvents } from './handlers/events.js';

export default async function init(ctx) {
  const moduleName = 'music';
  const { logger, config, lifecycle, events } = ctx;

  if (!config.isEnabled('MODULE_MUSIC_ENABLED', false)) {
    logger.info(`[${moduleName}] Module disabled via config.`);
    return { name: moduleName, description: 'Music module (disabled)' };
  }
  
  try {
    config.require(['LAVALINK_URL', 'LAVALINK_PASSWORD']);
  } catch (e) {
    logger.error(`[${moduleName}] Missing required Lavalink configuration.`, { error: e.message });
    return { name: moduleName, description: 'Music module (misconfigured)' };
  }

  const queueManager = new QueueManager(ctx);

  ctx.music = {
    shoukaku: null, // Initialize as null
    queueManager,
  };

  const disposers = [];
  try {
    disposers.push(registerPlayCommand(ctx));
    disposers.push(registerControlCommands(ctx));
    disposers.push(registerQueueCommands(ctx));
  } catch (e) {
    logger.error(`[${moduleName}] Failed to register commands`, { error: e?.message });
  }

  // Remove player event registration outside bot-ready logic

  const offReady = events.once(moduleName, 'ready', (client) => {
    logger.info(`[${moduleName}] Bot is ready, creating Shoukaku instance...`);
    
    // Instantiate and connect Shoukaku now that the client is ready
    const { shoukaku, nodes } = createShoukakuManager(ctx);
    if (!shoukaku.id) shoukaku.id = client.user.id;
    ctx.music.shoukaku = shoukaku;

    // Manually add nodes to trigger connection
    for (const nodeOption of nodes) {
      shoukaku.addNode(nodeOption);
    }

    // Register player events now that shoukaku is created
    registerPlayerEvents(ctx);
  });
  disposers.push(offReady);
  
  lifecycle.addDisposable(() => {
    logger.info(`[${moduleName}] Unloading module.`);
    shoukaku.closeAll();
    for (const d of disposers) {
      try { d?.(); } catch {}
    }
  });

  logger.info(`[${moduleName}] Module loaded.`);
  return {
    name: moduleName,
    description: 'Plays music using Lavalink and Shoukaku.',
    dispose: () => {
      logger.info(`[${moduleName}] Disposing module.`);
      shoukaku.closeAll();
      for (const d of disposers) {
        try { d?.(); } catch {}
      }
    }
  };
}

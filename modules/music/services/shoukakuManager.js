
import { Shoukaku, Connectors } from 'shoukaku';

/**
 * Creates and manages the Shoukaku instance.
 * @param {object} ctx - The module context.
 * @returns {Shoukaku} The Shoukaku instance.
 */
export function createShoukakuManager(ctx) {
  const { logger, config, client } = ctx;

  // Lavalink node configuration
  const nodes = [{
    name: 'Lavalink-Primary',
    url: config.get('LAVALINK_URL', 'localhost:2333'),
    auth: config.get('LAVALINK_PASSWORD', 'youshallnotpass'),
    secure: config.getBool('LAVALINK_SECURE', false)
  }];

  // Shoukaku options
  const shoukakuOptions = {
    resume: false, // Try to resume the session if the bot disconnects
    resumeTimeout: 30, // seconds
    reconnectTries: 2,
    restTimeout: 10000, // milliseconds
  };

  // Instantiate Shoukaku
  logger.debug(`[Shoukaku] Initializing Shoukaku with client ID: ${client.user?.id}`);
  const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, shoukakuOptions);

  // --- Event Listeners ---

  shoukaku.on('ready', (name, reconnected) => {
    logger.info(`[Shoukaku] Lavalink node '${name}' is now connected. ${reconnected ? '(Reconnected)' : ''}`);
  });

  shoukaku.on('error', (name, error) => {
    logger.error(`[Shoukaku] Lavalink node '${name}' encountered an error.`, { error });
  });

  shoukaku.on('close', (name, code, reason) => {
    logger.warn(`[Shoukaku] Lavalink node '${name}' connection closed. Code: ${code}, Reason: ${reason || 'No reason'}`);
  });

  shoukaku.on('debug', (name, info) => {
    if (process.env.NODE_ENV === 'development') {
      logger.info(`[Shoukaku] Lavalink node '${name}' debug:`, { info });
    }
  });

  return { shoukaku, nodes };
}

// core/statusCycler.js

import fs from 'fs';
// path not required here
import { fileURLToPath } from 'node:url';
// Use native timers for the status cycler
import { getLogger } from './logger.js';
import { ActivityType } from 'discord.js';
const logger = getLogger();

/**
 * Initializes the Discord bot status cycler.
 * @param {object} client - Discord.js client instance.
 * @param {object} options - Options object.
 *   @property {Array} statusDefinitions - Array of status definition objects/functions.
 *   @property {object} moduleStates - Map of active modules (optional, for dynamic status).
 *   @property {string} [version] - Bot version (optional, will auto-fetch from package.json if not provided).
 */
function initStatusCycler(client, options = {}) {
  const {
    statusDefinitions = [],
    moduleStates,
    version,
    interval = 30000, // 30 seconds
  } = options;

  // Helper to get bot version from package.json (works in ESM)
  function getBotVersion() {
    if (version) return version;
    try {
      const pkgPath = new URL('../package.json', import.meta.url);
      const pkg = JSON.parse(fs.readFileSync(fileURLToPath(pkgPath), 'utf8'));
      return pkg.version || 'unknown';
    } catch (err) {
      logger.debug('[StatusCycler] getBotVersion error', err?.message || err);
      return 'unknown';
    }
  }

  // Default status definitions (can be extended)
  const defaultStatusDefinitions = [
    {
      type: 'Watching',
      getMessage: () => 'Fully modular discord bot',
    },
    {
      type: 'Watching',
      getMessage: () => {
        if (!moduleStates) return 'Modules: unknown';
        return `Modules: ${Array.from(moduleStates.keys()).join(', ') || 'none'}`;
      },
    },
    {
      type: 'Watching',
      getMessage: async () => {
        try {
          const guilds = await client.guilds.fetch();
          return `Total Guilds: ${guilds.size}`;
        } catch {
          return 'Total Guilds: unknown';
        }
      },
    },
    {
      type: 'Watching',
      getMessage: async () => {
        try {
          const guilds = await client.guilds.fetch();
          let total = 0;
          for (const guild of guilds.values()) {
            const g = await client.guilds.fetch(guild.id);
            total += g.memberCount || 0;
          }
          return `Total Users: ${total}`;
        } catch {
          return 'Total Users: unknown';
        }
      },
    },
    {
      type: 'Listening',
      getMessage: () => 'for /help and other commands',
    },
    {
      type: 'Watching',
      getMessage: () => {
        const uptimeHours = Math.floor((client.uptime || 0) / 1000 / 60 / 60);
        return `Uptime: ${uptimeHours} hours`;
      },
    },
    {
      type: 'Watching',
      getMessage: () => `Ping: ${client.ws.ping} ms`,
    },
    {
      type: 'Watching',
      getMessage: () => `Bot Version: ${getBotVersion()}`,
    },
  ];

  // Merge user-provided and default definitions
  const allStatusDefinitions = [...statusDefinitions, ...defaultStatusDefinitions];

  let currentIndex = 0;
  let timer = null;

  async function updateStatus() {
    const idx = currentIndex % allStatusDefinitions.length;
    const def = allStatusDefinitions[idx];
    let message = '';
    try {
      message =
        typeof def.getMessage === 'function' ? await def.getMessage() : String(def.getMessage);
    } catch (err) {
      logger.error('[StatusCycler] Error getting status message:', err);
      message = 'Status error';
    }

    // Skip empty or errored messages; setting an empty activity can clear presence
    if (!message || String(message).trim() === '' || message === 'Status error') {
      logger.debug('[StatusCycler] Skipping empty/errored status update', { index: idx, type: def?.type, message });
      currentIndex = (currentIndex + 1) % allStatusDefinitions.length;
      return;
    }

    // Discord.js v14: client.user.setActivity / setPresence
    // Normalize activity type to ActivityType enum when provided as a string
    let activityType = def.type;
    if (typeof def.type === 'string') {
      // ActivityType keys are like 'Playing', 'Streaming', 'Listening', 'Watching', 'Competing'
      activityType = ActivityType[def.type] ?? def.type;
    }

    // Truncate to a safe length for Discord presence
    const safeMessage = String(message).slice(0, 128);
    const activityOptions = {
      name: safeMessage,
      type: activityType,
    };
    if (def.type === 'Streaming' && def.url) {
      activityOptions.url = def.url;
    }

    // Debug logging
    /*     logger.log('[StatusCycler] Attempting to set activity:', activityOptions); */

    if (client.user) {
      logger.debug('[StatusCycler] Attempting to set activity', { index: idx, activityOptions });
      // Prefer v14 setPresence API
      if (typeof client.user.setPresence === 'function') {
        try {
          // Set presence with an explicit status
          await client.user.setPresence({ activities: [activityOptions], status: 'online' });
        } catch (err) {
          logger.error('[StatusCycler] Error setting presence:', err);
        }
      } else if (typeof client.user.setActivity === 'function') {
        try {
          await client.user.setActivity(activityOptions);
        } catch (err) {
          logger.error('[StatusCycler] Error setting activity:', err);
        }
      } else {
        logger.error('[StatusCycler] client.user has no setPresence or setActivity.');
      }
    } else {
      logger.error('[StatusCycler] client.user not available.');
    }

    currentIndex = (currentIndex + 1) % allStatusDefinitions.length;
  }

  // Only start the interval and do an initial update after the client is ready.
  const start = () => {
    // Initial immediate update
    void updateStatus();

    // Start native interval timer
    timer = setInterval(updateStatus, interval);
  };

  if (client?.isReady && client.isReady()) {
    // Already ready
    start();
  } else if (client && typeof client.once === 'function') {
    client.once('ready', start);
  }

  // Return a handle for future extensibility (e.g., to add/remove status messages)
  return {
    stop: () => {
      if (timer && typeof timer.clear === 'function') {
        timer.clear();
      } else if (timer) {
        clearInterval(timer);
      }
    },
    addStatus: (def) => {
      allStatusDefinitions.push(def);
    },
    getStatusDefinitions: () => allStatusDefinitions.slice(),
  };
}

export { initStatusCycler };

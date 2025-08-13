// core/statusCycler.js

import fs from 'fs';
import path from 'path';
import * as scheduler from './scheduler.js'; // Optional, fallback to setInterval if not present
import * as logger from './logger.js';

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

  // Helper to get bot version from package.json
  function getBotVersion() {
    if (version) return version;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
      return pkg.version || 'unknown';
    } catch {
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
  const allStatusDefinitions = [
    ...statusDefinitions,
    ...defaultStatusDefinitions,
  ];

  let currentIndex = 0;
  let timer = null;

  async function updateStatus() {
    const def = allStatusDefinitions[currentIndex % allStatusDefinitions.length];
    let message = '';
    try {
      message = typeof def.getMessage === 'function'
        ? await def.getMessage()
        : String(def.getMessage);
    } catch (err) {
      logger.error('[StatusCycler] Error getting status message:', err);
      message = 'Status error';
    }
  
    // Discord.js v14: client.user.setActivity
    const activityOptions = {
      name: message,
      type: def.type,
    };
    if (def.type === 'Streaming' && def.url) {
      activityOptions.url = def.url;
    }
  
    // Debug logging
/*     logger.log('[StatusCycler] Attempting to set activity:', activityOptions); */
  
    if (client.user) {
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

  // Use scheduler if available, else setInterval
  if (typeof scheduler?.setInterval === 'function') {
    timer = scheduler.setInterval(updateStatus, interval);
  } else {
    timer = setInterval(updateStatus, interval);
  }

  // Initial status update after client is fully ready
  client.once('ready', updateStatus);

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
import { SlashCommandBuilder } from 'discord.js';
import { setup as storeSetup } from './services/store.js';
import { LevelService } from './services/levelService.js';
import messageCreate from './handlers/messageCreate.js';
import interactionCreate from './handlers/interactionCreate.js';
import adminConfigCmd from './commands/admin-config.js';
import userCommands from './commands/user-commands.js';
import { startRoleWorker, stopRoleWorker } from './services/roleWorker.js';

let unregisterInteraction;
let messageListener;
let levelService;

export async function setup(core) {
  const logger = core.logger || (await import('../../core/logger.js')).default;
  logger.info('[leveling] setup: initializing DB collections and indexes');
  // initialize store (creates indexes)
  await storeSetup(core);
  levelService = new LevelService(core);
}

export async function start(core) {
  const logger = core.logger || (await import('../../core/logger.js')).default;
  logger.info('[leveling] start: registering handlers and commands');

  // register slash commands
  const cmdHandler = core.commands;
  if (!cmdHandler) throw new Error('core.commands missing');

  // Admin single command: /leveling config
  const adminCmd = new SlashCommandBuilder()
    .setName('leveling')
    .setDescription('Leveling module administration')
    .addSubcommand((s) => s.setName('config').setDescription('Open the interactive leveling configuration UI'))
    .toJSON();

  cmdHandler.registerSlash('leveling', adminCmd);
  cmdHandler.v2RegisterExecute('leveling', async (interaction) => {
    await adminConfigCmd.execute(interaction, core, levelService);
  });

  // user facing commands
  const userCmds = userCommands.build();
  cmdHandler.registerSlash('leveling', ...userCmds);
  userCommands.registerHandlers(core, levelService);

  // register interaction handler (legacy path)
  unregisterInteraction = cmdHandler.onInteractionCreate('leveling', async (i) => {
    await interactionCreate(i, core, levelService);
  });

  // register messageCreate
  messageListener = async (msg) => {
    try {
      await messageCreate(msg, core, levelService);
    } catch (err) {
      core.logger.error('[leveling] messageCreate handler error', { err: err?.message, stack: err?.stack });
    }
  };
  core.client.on('messageCreate', messageListener);
  // start background worker for temporary role cleanup
  try { startRoleWorker(core); } catch (e) { core.logger.warn('[leveling] roleWorker failed to start', { err: e?.message }); }
}

export async function stop(core) {
  core.logger.info('[leveling] stop: removing handlers and flushing tasks');
  if (unregisterInteraction) unregisterInteraction();
  if (messageListener) core.client.off('messageCreate', messageListener);
  // TODO: flush scheduled role removals if queued
  try { stopRoleWorker(core); } catch (e) { core.logger.warn('[leveling] roleWorker failed to stop', { err: e?.message }); }
}

// Default init function expected by the core loader
export default async function init(ctx) {
  const { logger, config, lifecycle } = ctx;
  const moduleName = 'leveling';

  if (!config.isEnabled?.(`MODULE_${moduleName.toUpperCase()}_ENABLED`, true)) {
    logger.info(`[${moduleName}] Module disabled via config.`);
    return { name: moduleName, description: 'Leveling module (disabled)' };
  }

  // run setup/start using the module context
  await setup(ctx);
  await start(ctx);

  // ensure stop is called on unload/hot-reload
  if (lifecycle?.addDisposable) {
    lifecycle.addDisposable(() => stop(ctx));
  }

  return {
    name: moduleName,
    description: 'Leveling module (XP, leaderboards, profiles, admin UI)',
    dispose: async () => {
      try { await stop(ctx); } catch (e) { logger.warn('[leveling] dispose error', { err: e?.message }); }
    }
  };
}

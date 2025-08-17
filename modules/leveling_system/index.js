export default async function init(ctx) {
  const moduleName = 'leveling_system';
  const hasFactory = typeof ctx?.createModuleContext === 'function';
  const mod = hasFactory ? ctx.createModuleContext(moduleName) : ctx;

  const { logger, config, lifecycle, client, v2 } = mod;

  if (!config.isEnabled('MODULE_LEVELING_SYSTEM_ENABLED', true)) {
    logger.info('[Leveling] Module disabled via config.');
    return { name: moduleName, description: 'Leveling system (disabled)' };
  }

  // Ensure indexes
  try {
    await (await import('./services/levelService.js')).ensureIndexes(mod);
  } catch (err) {
    logger.warn('[Leveling] ensureIndexes failed', { error: err?.message });
  }

  // Message handler
  const onMessage = async (message) => {
    try {
      if (!message.guildId) return;
      if (message.author?.bot) return;
      await (await import('./services/levelService.js')).handleMessage(mod, message);
    } catch (err) {
      logger.warn('[Leveling] message handler error', { error: err?.message });
    }
  };
  client.on('messageCreate', onMessage);
  lifecycle.addDisposable(() => { try { client.off('messageCreate', onMessage); } catch (e) { void e; } });

  // Voice state updates
  const onVoice = async (oldState, newState) => {
    try {
      await (await import('./services/levelService.js')).handleVoiceState(mod, oldState, newState);
    } catch (err) {
      logger.warn('[Leveling] voiceStateUpdate error', { error: err?.message });
    }
  };
  client.on('voiceStateUpdate', onVoice);
  lifecycle.addDisposable(() => { try { client.off('voiceStateUpdate', onVoice); } catch (e) { void e; } });

  // Start voice ticker
  const vs = await (await import('./services/levelService.js')).startVoiceTicker(mod);
  lifecycle.addDisposable(() => { try { vs?.stop?.(); } catch (e) { void e; } });

  // Register commands
  try {
    const rankHandler = (await import('./handlers/rank.js')).default;
    const leaderboardHandler = (await import('./handlers/leaderboard.js')).default;
    const adminHandler = (await import('./handlers/admin.js')).default;

    const cmdRank = v2.createInteractionCommand()
      .setName('rank')
      .setDescription('Show a user\'s leveling profile')
      .addUserOption(opt => opt.setName('user').setDescription('User to query').setRequired(false))
      .onExecute(async (interaction) => await rankHandler(mod)(interaction));
    lifecycle.addDisposable(v2.register(cmdRank, moduleName));

    const cmdLeaderboard = v2.createInteractionCommand()
      .setName('leaderboard')
      .setDescription('Show the leveling leaderboard')
      .addIntegerOption(opt => opt.setName('limit').setDescription('Number of results').setRequired(false))
      .onExecute(async (interaction) => await leaderboardHandler(mod)(interaction));
    lifecycle.addDisposable(v2.register(cmdLeaderboard, moduleName));

    const cmdAdmin = v2.createInteractionCommand()
      .setName('level_admin')
      .setDescription('Open leveling system admin panel')
      .onExecute(async (interaction) => await adminHandler(mod)(interaction));
    lifecycle.addDisposable(v2.register(cmdAdmin, moduleName));
  } catch (err) {
    logger.warn('[Leveling] Failed to register commands', { error: err?.message });
  }

  logger.info('[Leveling] Module loaded.');

  return {
    name: moduleName,
    description: 'Per-guild leveling and XP system with leaderboards and admin UI.',
    dispose: async () => {
      logger.info('[Leveling] Module unloaded.');
      try { client.off('messageCreate', onMessage); } catch (e) { void e; }
      try { client.off('voiceStateUpdate', onVoice); } catch (e) { void e; }
      try { vs?.stop?.(); } catch (e) { void e; }
    }
  };
}

export default async function init(ctx) {
  const moduleName = 'invite-leaderboard';
  const hasFactory = typeof ctx?.createModuleContext === 'function';
  const mod = hasFactory ? ctx.createModuleContext(moduleName) : ctx;

  const { logger, config, events, lifecycle, scheduler, client, v2 } = mod;

  if (!config.isEnabled('MODULE_INVITE_LEADERBOARD_ENABLED', true)) {
    logger.info('[InviteLeaderboard] Module disabled via config.');
    return { name: moduleName, description: 'Invite leaderboard (disabled)' };
  }

  // Lazy import service and handlers to keep startup fast
  const { ensureIndexes, initGuildBaseline, handleInviteCreate, handleInviteDelete, processGuildMemberAdd, reconcileAllGuilds } = await import('./services/inviteService.js');

  // Ensure indexes on startup
  try {
    await ensureIndexes(mod);
  } catch (err) {
    logger.warn('[InviteLeaderboard] ensureIndexes failed', { error: err?.message });
  }

  // If the client is already ready (module loaded after ready), initialize baselines now
  try {
    if (client?.readyTimestamp) {
      logger.info('[InviteLeaderboard] Client already ready - initializing invite baselines immediately');
      const guilds = client.guilds?.cache?.values?.() ? Array.from(client.guilds.cache.values()) : [];
      for (const g of guilds) {
        try {
          await initGuildBaseline(mod, g);
        } catch (e) {
          logger.warn('[InviteLeaderboard] init baseline failed for guild (immediate)', { guildId: g.id, error: e?.message });
        }
      }
    }
  } catch (err) {
    logger.warn('[InviteLeaderboard] immediate baseline check failed', { error: err?.message });
  }

  // When the client is ready, build baseline for all cached guilds
  const offReady = events.once(moduleName, 'ready', async () => {
    logger.info('[InviteLeaderboard] Client ready - initializing invite baselines');
    try {
      const guilds = client.guilds?.cache?.values?.() ? Array.from(client.guilds.cache.values()) : [];
      for (const g of guilds) {
        try {
          await initGuildBaseline(mod, g);
        } catch (e) {
          logger.warn('[InviteLeaderboard] init baseline failed for guild', { guildId: g.id, error: e?.message });
        }
      }
    } catch (err) {
      logger.error('[InviteLeaderboard] baseline initialization error', { error: err?.message });
    }
  });
  lifecycle.addDisposable(offReady);

  // Register core Discord events
  const offInviteCreate = events.on(moduleName, 'inviteCreate', async (invite) => {
    try {
      await handleInviteCreate(mod, invite);
    } catch (err) {
      logger.warn('[InviteLeaderboard] handleInviteCreate failed', { guildId: invite.guild?.id, error: err?.message });
    }
  });
  lifecycle.addDisposable(offInviteCreate);

  const offInviteDelete = events.on(moduleName, 'inviteDelete', async (invite) => {
    try {
      await handleInviteDelete(mod, invite);
    } catch (err) {
      logger.warn('[InviteLeaderboard] handleInviteDelete failed', { guildId: invite.guild?.id, error: err?.message });
    }
  });
  lifecycle.addDisposable(offInviteDelete);

  const offGuildMemberAdd = events.on(moduleName, 'guildMemberAdd', async (member) => {
    try {
      await processGuildMemberAdd(mod, member.guild, member);
    } catch (err) {
      logger.warn('[InviteLeaderboard] processGuildMemberAdd failed', { guildId: member.guild?.id, error: err?.message });
    }
  });
  lifecycle.addDisposable(offGuildMemberAdd);

  // When joining a new guild, initialize baseline
  const offGuildCreate = events.on(moduleName, 'guildCreate', async (guild) => {
    try {
      await initGuildBaseline(mod, guild);
    } catch (err) {
      logger.warn('[InviteLeaderboard] init baseline failed on guildCreate', { guildId: guild.id, error: err?.message });
    }
  });
  lifecycle.addDisposable(offGuildCreate);

  // Periodic reconciliation to catch missed changes (every 10 minutes)
  const stopReconcile = scheduler.schedule('*/10 * * * *', async () => {
    try {
      await reconcileAllGuilds(mod);
    } catch (err) {
      logger.warn('[InviteLeaderboard] reconcileAllGuilds failed', { error: err?.message });
    }
  });
  lifecycle.addDisposable(stopReconcile);

  // Register a simple /invites leaderboard command (v2)
  try {
    const leaderboardHandler = (await import('./handlers/leaderboard.js')).default;
    const cmdInvites = v2.createInteractionCommand()
      .setName('invites')
      .setDescription('Invite utilities')
      .addOption((root) => {
        root.addSubcommand((sub) =>
          sub
            .setName('leaderboard')
            .setDescription('Show top inviters for this guild')
            .addIntegerOption((opt) => opt.setName('limit').setDescription('Number of results').setRequired(false))
        );
      })
      .onExecute(async (interaction) => {
        const sub = interaction.options.getSubcommand();
        if (sub === 'leaderboard') {
          await leaderboardHandler(mod)(interaction);
        }
      });

    const disposeCmd = v2.register(cmdInvites, moduleName);
    lifecycle.addDisposable(disposeCmd);
  } catch (err) {
    logger?.warn?.('[InviteLeaderboard] failed to register command', { error: err?.message });
  }

  logger.info('[InviteLeaderboard] Module loaded.');

  return {
    name: moduleName,
    description: 'Invite leaderboard tracking (per-guild)',
    dispose: async () => {
      logger.info('[InviteLeaderboard] Module unloaded.');
      try {
        offReady?.();
      } catch (err) { void err; }
      try {
        offInviteCreate?.();
      } catch (err) { void err; }
      try {
        offInviteDelete?.();
      } catch (err) { void err; }
      try {
        offGuildMemberAdd?.();
      } catch (err) { void err; }
      try {
        offGuildCreate?.();
      } catch (err) { void err; }
      try {
        stopReconcile?.();
      } catch (err) { void err; }
      try { events.removeModule?.(moduleName); } catch (err) { void err; }
    },
  };
}

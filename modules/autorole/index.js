// Autorole Module Entry Point
import { createConfigureCommand } from "./handlers/configure.js";
import { registerMemberJoinHandler } from "./handlers/memberJoin.js";
import { ensureIndexes, invalidateGuildSettingsCache } from "./services/settings.js";

export default async function init(ctx) {
  const { logger, config, lifecycle } = ctx;
  const moduleName = "autorole";

  if (!config.isEnabled("MODULE_AUTOROLE_ENABLED", true)) {
    logger.info("[Autorole] Module disabled via config.");
    return { name: moduleName, description: "Autorole module (disabled)" };
  }

  // Ensure DB indexes
  await ensureIndexes(ctx);

  // Track scheduled timers for delayed role applications
  const timers = new Map(); // key: `${guildId}:${userId}` -> timeoutId

  // Expose helpers for handlers
  ctx.autorole = {
    invalidate: (guildId) => invalidateGuildSettingsCache(guildId),
    timers,
  };

  // Register slash command handler for interactive configuration
  createConfigureCommand(ctx);

  // Register member join listener
  const disposer = registerMemberJoinHandler(ctx);

  // Lifecycle disposal
  lifecycle.addDisposable(() => {
    try { disposer?.(); } catch {}
    // Clear all pending timers
    try {
      for (const [, timeoutId] of timers) {
        clearTimeout(timeoutId);
      }
      timers.clear();
    } catch {}
  });

  //logger.info("[Autorole] Module loaded.");
  return {
    name: moduleName,
    description: "Automatically assign a configured role to new members with optional delay and account age gating.",
    dispose: async () => {
      logger.info("[Autorole] Module unloaded.");
      try { disposer?.(); } catch {}
      try {
        for (const [, timeoutId] of timers) clearTimeout(timeoutId);
        timers.clear();
      } catch {}
    }
  };
}
// ModerationModule Entry Point

import { createConfig } from "../../core/config.js";

// Handlers
import { createKickCommand } from "./handlers/kick.js";
import { createBanCommand } from "./handlers/ban.js";
import { createWarnCommand } from "./handlers/warn.js";
import { createMuteCommand } from "./handlers/mute.js";
import { createModlogCommand } from "./handlers/modlog.js";

// Services
import { warningService } from "./services/warningService.js";
import { logAction } from "./services/loggingService.js";

export default async function init(ctx) {
  const { logger, v2, _embed, lifecycle } = ctx;
  const config = ctx.config ?? createConfig();
  const moduleName = "moderation";

  // DEBUG: Validate modlog and guildConfig context
  logger.debug?.("[ModerationModule] ctx.modlog at entry:", ctx.modlog);
  logger.debug?.("[ModerationModule] ctx.guildConfig at entry:", ctx.guildConfig);

  if (!config.isEnabled("MODERATION_ENABLED", true)) {
    logger.info("[ModerationModule] Module disabled via config.");
    return { name: moduleName, description: "Moderation module (disabled)" };
  }

  // Attach services to context for handlers
  ctx.services = ctx.services || {};
  ctx.services.warnings = warningService;
  ctx.moderation = {
    warningService,
    logAction,
  };

  // Register each moderation command from handler files
  const kickCmd = createKickCommand(ctx);
  const banCmd = createBanCommand(ctx);
  const warnCmd = createWarnCommand(ctx);
  const muteCmd = createMuteCommand(ctx);
  const modlogCmd = createModlogCommand(ctx);

  // Register and manage lifecycle for each command
  const disposeKick = v2.register(kickCmd, moduleName);
  const disposeBan = v2.register(banCmd, moduleName);
  const disposeWarn = v2.register(warnCmd, moduleName);
  const disposeMute = v2.register(muteCmd, moduleName);
  const disposeModlog = v2.register(modlogCmd, moduleName);

  lifecycle.addDisposable(disposeKick);
  lifecycle.addDisposable(disposeBan);
  lifecycle.addDisposable(disposeWarn);
  lifecycle.addDisposable(disposeMute);
  lifecycle.addDisposable(disposeModlog);

  return {
    name: moduleName,
    description: "Moderation actions: kick, ban, warn, mute, modlog.",
    dispose: async () => {
      logger.info("[ModerationModule] Module unloaded.");
    }
  };
}
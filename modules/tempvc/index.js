
import { createInteractionCommand } from "../../core/builders.js";
import { registerSetupCommand } from "./handlers/setup.js";
import { registerVoiceStateListener } from "./handlers/userVcPanel.js";
import { ensureIndexes as ensureTempVcIndexes } from "./services/tempvcService.js";
import { ensureIndexes as ensureSettingsIndexes } from "./services/settingsService.js";

export default async function init(ctx) {
  const { logger, lifecycle } = ctx;
  const MODULE_NAME = "tempvc";

  logger.info("Registering TempVC module...");

  // Ensure MongoDB indexes
  await ensureTempVcIndexes(ctx);
  await ensureSettingsIndexes(ctx);

  // Register admin setup command
  const setupCommand = registerSetupCommand(ctx, MODULE_NAME);
  lifecycle.addDisposable(ctx.v2.register(setupCommand));

  // Register voice state listener for user panel
  const disposeVoiceListener = registerVoiceStateListener(ctx, MODULE_NAME);
  lifecycle.addDisposable(disposeVoiceListener);

  logger.info("TempVC module registered.");

  return {
    name: MODULE_NAME,
    description: "A feature-rich temporary voice channel module.",
    dispose: () => {
      logger.info("TempVC module unloaded.");
    },
  };
}

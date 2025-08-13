/**
 * WelcomeLeaveModule Entry Point
 * Registers all interactions and event handlers, ensures hot-reload safety.
 */
import { ensureIndexes as ensureSettingsIndexes } from "./services/settingsService.js";
import { registerSetupCommand } from "./handlers/setup.js";
import { registerComponentHandlers } from "./handlers/componentHandlers.js";
import { registerMemberEventHandlers } from "./handlers/memberEvents.js";

export default async function init(ctx) {
  const { logger, config, lifecycle } = ctx;
  const moduleName = "WelcomeLeaveModule";

  if (!config.isEnabled("MODULE_WELCOMELEAVE_ENABLED", true)) {
    logger.info("[WelcomeLeave] Module disabled via config.");
    return { name: moduleName, description: "Welcome/Leave module (disabled)" };
  }

  // Ensure DB indexes for settings
  try { await ensureSettingsIndexes(ctx); } catch (e) { logger.warn("[WelcomeLeave] ensureSettingsIndexes failed", { error: e?.message }); }

  // Register handlers
  const disposers = [];
  try { const d = await registerSetupCommand(ctx); if (typeof d === "function") disposers.push(d); } catch (e) { logger.error("[WelcomeLeave] Failed to register setup command", { error: e?.message }); }
  try { const d = await registerComponentHandlers(ctx); if (typeof d === "function") disposers.push(d); } catch (e) { logger.error("[WelcomeLeave] Failed to register component handlers", { error: e?.message }); }
  try { const d = await registerMemberEventHandlers(ctx); if (typeof d === "function") disposers.push(d); } catch (e) { logger.error("[WelcomeLeave] Failed to register member event handlers", { error: e?.message }); }

  // Lifecycle disposal
  lifecycle.addDisposable(() => {
    for (const d of disposers) { try { d?.(); } catch {} }
    try { ctx.interactions?.removeModule?.(moduleName); } catch {}
  });

  return {
    name: moduleName,
    description: "Configurable welcome/leave system with interactive setup and embed builder.",
    postReady: async (readyCtx) => {
      readyCtx.logger.info("[WelcomeLeave] postReady: module active");
    },
    dispose: async () => {
      logger.info("[WelcomeLeave] Module unloaded.");
      for (const d of disposers) { try { d?.(); } catch {} }
    }
  };
}
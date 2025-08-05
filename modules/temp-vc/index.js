/* Temporary Voice Channels Module Entry Point
 * Mirrors modules/tickets lifecycle: registers commands/interactions/events,
 * ensures DB indexes, schedules integrity/idle checks, and supports hot-reload.
 */
import { createScheduler } from "../../core/scheduler.js";

// Handlers
import { registerSetupCommand } from "./handlers/setup.js";
import { registerAdminMenus } from "./handlers/adminMenus.js";
import { registerUserCommands } from "./handlers/userCommands.js";
import { registerVoiceEventHandlers } from "./handlers/voiceEvents.js";
import { registerUiControlHandlers } from "./handlers/uiControls.js";

// Services (ensureIndexes + scheduler wiring)
import { ensureIndexes as ensureRepoIndexes } from "./services/repository.js";
import { ensureIndexes as ensureSettingsIndexes } from "./services/settingsService.js";
import { ensureIndexes as ensureMetricsIndexes } from "./services/metricsService.js";
import { createVCScheduler } from "./services/scheduler.js";
import { integrityStartupScan } from "./services/integrityService.js";

export default async function init(ctx) {
  const { logger, config, lifecycle, client } = ctx;
  const moduleName = "temp-vc";

  if (!config.isEnabled("MODULE_TEMP_VC_ENABLED", true)) {
    logger.info("[TempVC] Module disabled via config.");
    return { name: moduleName, description: "Temporary Voice Channels module (disabled)" };
  }

  // Defensive: require Mongo via ctx.mongo (project-standard)
  if (!ctx.mongo) {
    logger.warn("[TempVC] ctx.mongo is missing. Ensure core/mongo.js initialized and core.createCore() provides mongo.");
    return { name: moduleName, description: "Temporary Voice Channels module (mongo unavailable)" };
  }

  // Ensure DB indexes for repository (collections), settings, metrics
  try { await ensureRepoIndexes(ctx); } catch (e) { logger.warn("[TempVC] ensureRepoIndexes failed", { error: e?.message }); }
  try { await ensureSettingsIndexes(ctx); } catch (e) { logger.warn("[TempVC] ensureSettingsIndexes failed", { error: e?.message }); }
  try { await ensureMetricsIndexes(ctx); } catch (e) { logger.warn("[TempVC] ensureMetricsIndexes failed", { error: e?.message }); }

  // Register handlers
  const disposers = [];
  try { const d = await registerSetupCommand(ctx); if (typeof d === "function") disposers.push(d); } catch (e) { logger.error("[TempVC] Failed to register setup command", { error: e?.message }); }
  try { const d = await registerAdminMenus(ctx); if (typeof d === "function") disposers.push(d); } catch (e) { logger.error("[TempVC] Failed to register admin menus", { error: e?.message }); }
  try { const d = await registerUserCommands(ctx); if (typeof d === "function") disposers.push(d); } catch (e) { logger.error("[TempVC] Failed to register user commands", { error: e?.message }); }
  try { const d = await registerUiControlHandlers(ctx); if (typeof d === "function") disposers.push(d); } catch (e) { logger.error("[TempVC] Failed to register UI control handlers", { error: e?.message }); }
  try { const d = await registerVoiceEventHandlers(ctx); if (typeof d === "function") disposers.push(d); } catch (e) { logger.error("[TempVC] Failed to register voice event handlers", { error: e?.message }); }

  // Scheduler: idle checks and integrity scans
  const scheduler = createScheduler(logger);
  let stopVCJobs = () => {};
  try {
    stopVCJobs = createVCScheduler(ctx, scheduler) || (() => {});
  } catch (e) {
    logger.warn("[TempVC] Scheduler initialization failed", { error: e?.message });
  }

  // Lifecycle disposal
  lifecycle.addDisposable(() => {
    try { stopVCJobs?.(); } catch {}
    for (const d of disposers) { try { d?.(); } catch {} }
    try { ctx.interactions?.removeModule?.(moduleName); } catch {}
  });

  logger.info("[TempVC] Module loaded.");
  return {
    name: moduleName,
    description: "Temporary Voice Channels with resilience, persistence, and self-healing.",
    postReady: async (readyCtx) => {
      // Avoid postReady work if mongo is unavailable or not configured
      if (!readyCtx.mongo) {
        readyCtx.logger.warn("[TempVC] postReady skipped (mongo unavailable)");
        return;
      }
      // If Mongo URI is not configured, getDb() may return null; guard scan
      const maybeDb = await readyCtx.mongo.getDb();
      if (!maybeDb) {
        readyCtx.logger.warn("[TempVC] postReady skipped (mongo not configured)");
        return;
      }
      // Delay startup scan slightly to avoid early cache/gateway races after ready
      const delayMs = Number(process.env.TEMPVC_STARTUP_SCAN_DELAY_MS || 15000);
      try {
        readyCtx.logger.info("[TempVC] Scheduling startup integrity scan", { delayMs });
        setTimeout(async () => {
          try {
            readyCtx.logger.info("[TempVC] Running delayed startup integrity scan");
            await integrityStartupScan(readyCtx);
            readyCtx.logger.info("[TempVC] Delayed startup integrity scan complete");
          } catch (e) {
            readyCtx.logger.error("[TempVC] Delayed startup integrity scan failed", { error: e?.message });
          }
        }, delayMs);
      } catch (e) {
        readyCtx.logger.error("[TempVC] postReady scheduling delayed scan failed", { error: e?.message });
      }
      readyCtx.logger.info("[TempVC] postReady: scheduler active");
    },
    dispose: async () => {
      logger.info("[TempVC] Module unloaded.");
      try { stopVCJobs?.(); } catch {}
      for (const d of disposers) { try { d?.(); } catch {} }
    }
  };
}
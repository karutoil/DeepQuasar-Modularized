/* Tickets Module Entry Point (modeled after modules/music lifecycle)
 * Registers all interactions against core/interactions under the module namespace
 * and ensures hot-reload safety by removing module handlers on dispose.
 */
import { createScheduler } from "../../core/scheduler.js";

// Handlers
import { registerSetupCommand } from "./handlers/setup.js";
import { registerAdminMenus } from "./handlers/adminMenus.js";
import { registerPanelHandlers } from "./handlers/panel.js";
import { registerTicketInteractionHandlers } from "./handlers/ticketInteraction.js";
import { registerTicketControlHandlers } from "./handlers/ticketControls.js";

// Services
import { ensureIndexes as ensureSettingsIndexes } from "./services/settingsService.js";
import { ensureIndexes as ensureTicketIndexes } from "./services/ticketService.js";
import { ensureIndexes as ensurePanelIndexes } from "./services/panelService.js";
import { ensureIndexes as ensureTypeIndexes } from "./services/typeService.js";
import { createTicketScheduler } from "./services/scheduler.js";

export default async function init(ctx) {
  const { logger, config, lifecycle, client } = ctx;
  const moduleName = "tickets";

  if (!config.isEnabled("MODULE_TICKETS_ENABLED", true)) {
    logger.info("[Tickets] Module disabled via config.");
    return { name: moduleName, description: "Tickets module (disabled)" };
  }

  // Ensure DB indexes for settings, tickets, panels, and types
  try { await ensureSettingsIndexes(ctx); } catch (e) { logger.warn("[Tickets] ensureSettingsIndexes failed", { error: e?.message }); }
  try { await ensureTicketIndexes(ctx); } catch (e) { logger.warn("[Tickets] ensureTicketIndexes failed", { error: e?.message }); }
  try { await ensurePanelIndexes(ctx); } catch (e) { logger.warn("[Tickets] ensurePanelIndexes failed", { error: e?.message }); }
  try { await ensureTypeIndexes(ctx); } catch (e) { logger.warn("[Tickets] ensureTypeIndexes failed", { error: e?.message }); }

  // Register handlers (ctx already contains the core interactions service)
  const disposers = [];
  try { const d = await registerSetupCommand(ctx); if (typeof d === "function") disposers.push(d); } catch (e) { logger.error("[Tickets] Failed to register setup command", { error: e?.message }); }
  try { const d = await registerAdminMenus(ctx); if (typeof d === "function") disposers.push(d); } catch (e) { logger.error("[Tickets] Failed to register admin menus", { error: e?.message }); }
  try { const d = await registerPanelHandlers(ctx); if (typeof d === "function") disposers.push(d); } catch (e) { logger.error("[Tickets] Failed to register panel handlers", { error: e?.message }); }
  try { const d = await registerTicketInteractionHandlers(ctx); if (typeof d === "function") disposers.push(d); } catch (e) { logger.error("[Tickets] Failed to register ticket interaction handlers", { error: e?.message }); }
  try { const d = await registerTicketControlHandlers(ctx); if (typeof d === "function") disposers.push(d); } catch (e) { logger.error("[Tickets] Failed to register ticket control handlers", { error: e?.message }); }

  // Scheduler for inactivity warnings and auto-close
  const scheduler = createScheduler(logger);
  const stopTicketJobs = createTicketScheduler(ctx, scheduler);

  // Lifecycle disposal
  lifecycle.addDisposable(() => {
    try { stopTicketJobs?.(); } catch (err) { void err; }
    for (const d of disposers) { try { d?.(); } catch (err) { void err; } }
    try { interactions?.removeModule?.(moduleName); } catch (err) { void err; }
  });

  //logger.info("[Tickets] Module loaded.");
  return {
    name: moduleName,
    description: "Embed-first ticketing system with per-guild settings and MongoDB persistence.",
    postReady: async (readyCtx) => {
      readyCtx.logger.info("[Tickets] postReady: scheduler active");
    },
    dispose: async () => {
      logger.info("[Tickets] Module unloaded.");
      try { stopTicketJobs?.(); } catch (err) { void err; }
      for (const d of disposers) { try { d?.(); } catch (err) { void err; } }
    }
  };
}
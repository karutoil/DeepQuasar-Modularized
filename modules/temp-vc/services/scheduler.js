/**
 * Scheduler wiring for Temporary Voice Channels.
 * Uses core/scheduler to run:
 * - Idle checks every 5 minutes
 * - Integrity scan hourly
 */
import { integrityService } from "./integrityService.js";
import { stateService } from "./stateService.js";

export function createVCScheduler(ctx, scheduler) {
  const { logger } = ctx;
  const svcIntegrity = integrityService(ctx);
  const svcState = stateService(ctx);

  const stops = [];

  // Every 5 minutes: idle checks and pending deletions
  stops.push(
    scheduler.schedule("*/5 * * * *", async () => {
      await svcIntegrity.runIdleChecks();
      await svcIntegrity.processScheduledDeletions();
    }, { immediate: false })
  );

  // Hourly: integrity scan (permissions, ownership, orphan cleanup)
  stops.push(
    scheduler.schedule("0 * * * *", async () => {
      await svcIntegrity.runHourlyIntegrityScan();
    }, { immediate: true })
  );

  logger.info("[TempVC] Scheduler registered (5m idle checks, hourly integrity scan)");
  return () => {
    for (const stop of stops) { try { stop?.(); } catch {} }
    logger.info("[TempVC] Scheduler stopped");
  };
}
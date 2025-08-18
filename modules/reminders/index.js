// Reminders Module Entry Point

export default async function init(ctx) {
  const { logger, config, lifecycle } = ctx;
  const moduleName = "reminders";

  if (!config.isEnabled("MODULE_REMINDERS_ENABLED", true)) {
    logger.info("[Reminders] Module disabled via config.");
    return { name: moduleName, description: "Reminders module (disabled)" };
  }

  // Ensure DB indexes for reminders and timezones
  try {
    const { ensureIndexes: ensureReminderIndexes } = await import("./services/reminderService.js");
    await ensureReminderIndexes(ctx);
  } catch (e) {
    logger.warn("[Reminders] Failed to ensure reminder indexes", { error: e?.message });
  }

  try {
    const { ensureIndexes: ensureTimezoneIndexes } = await import("./services/timezoneService.js");
    await ensureTimezoneIndexes(ctx);
  } catch (e) {
    logger.warn("[Reminders] Failed to ensure timezone indexes", { error: e?.message });
  }

  // Register handlers
  const disposers = [];
  try {
    const { setup: setupRemind } = await import("./handlers/remind.js");
    const d = setupRemind(ctx);
    if (typeof d === "function") disposers.push(d);
  } catch (e) {
    logger.error("[Reminders] Failed to register remind handler", { error: e?.message });
  }

  try {
    const { setup: setupRemindChannel } = await import("./handlers/remindChannel.js");
    const d = setupRemindChannel(ctx);
    if (typeof d === "function") disposers.push(d);
  } catch (e) {
    logger.error("[Reminders] Failed to register remindChannel handler", { error: e?.message });
  }

  try {
    const { setup: setupReminders } = await import("./handlers/reminders.js");
    const d = setupReminders(ctx);
    if (typeof d === "function") disposers.push(d);
  } catch (e) {
    logger.error("[Reminders] Failed to register reminders handler", { error: e?.message });
  }

  try {
    const { setup: setupRemindEvery } = await import("./handlers/remindEvery.js");
    const d = setupRemindEvery(ctx);
    if (typeof d === "function") disposers.push(d);
  } catch (e) {
    logger.error("[Reminders] Failed to register remindEvery handler", { error: e?.message });
  }

  try {
    const { setup: setupTimezone } = await import("./handlers/timezone.js");
    const d = setupTimezone(ctx);
    if (typeof d === "function") disposers.push(d);
  } catch (e) {
    logger.error("[Reminders] Failed to register timezone handler", { error: e?.message });
  }

  // Register scheduled jobs
  try {
    const { setup: setupScheduler } = await import("./services/scheduler.js");
    const d = setupScheduler(ctx);
    if (typeof d === "function") disposers.push(d);
  } catch (e) {
    logger.error("[Reminders] Failed to register scheduler jobs", { error: e?.message });
  }

  // Lifecycle disposal
  lifecycle.addDisposable(() => {
    for (const d of disposers) {
      try { d?.(); } catch (err) { void err; }
    }
  });

  //logger.info("[Reminders] Module loaded.");
  return {
    name: moduleName,
    description: "User and channel reminders with scheduling, timezones, and recurring options.",
    dispose: async () => {
      logger.info("[Reminders] Module unloaded.");
      for (const d of disposers) {
        try { d?.(); } catch (err) { void err; }
      }
    }
  };
}
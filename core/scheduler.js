import cron from "node-cron";

/**
 * Cron scheduler wrapper tracked by lifecycle for safe hot-reload cleanup.
 * Provides schedule(cronExpr, fn, options) -> stop(), and list() for debug.
 */
export function createScheduler(logger) {
  const jobs = new Set();

  function schedule(cronExpr, fn, { timezone, immediate = false } = {}) {
    const job = cron.schedule(
      cronExpr,
      async () => {
        try {
          await fn();
        } catch (err) {
          logger.error(`Scheduled job error: ${err?.message}`, { stack: err?.stack });
        }
      },
      { timezone }
    );
    jobs.add(job);
    if (immediate) {
      Promise.resolve()
        .then(fn)
        .catch((err) => logger.error(`Immediate job run error: ${err?.message}`, { stack: err?.stack }));
    }
    return () => {
      try {
        job.stop();
        jobs.delete(job);
      } catch (err) { void err; }
    };
  }

  function stopAll() {
    for (const job of jobs) {
      try {
        job.stop();
      } catch (err) { void err; }
    }
    jobs.clear();
  }

  function list() {
    return Array.from(jobs).length;
  }

  return {
    schedule,
    stopAll,
    list,
  };
}
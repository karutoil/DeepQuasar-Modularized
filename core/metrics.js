/**
 * Minimal metrics facade (no-op by default).
 * Provides counters, gauges, and timers to standardize measurements.
 */
export function createMetrics(logger) {
  function counter(name) {
    let value = 0;
    return {
      inc(n = 1) {
        value += n;
      },
      get() {
        return value;
      },
      reset() {
        value = 0;
      },
    };
  }

  function gauge(name) {
    let value = 0;
    return {
      set(v) {
        value = Number(v) || 0;
      },
      add(n = 1) {
        value += n;
      },
      sub(n = 1) {
        value -= n;
      },
      get() {
        return value;
      },
      reset() {
        value = 0;
      },
    };
  }

  function timer(name) {
    let start = 0;
    return {
      start() {
        start = performance.now();
      },
      stop(log = false) {
        const ms = performance.now() - start;
        if (log) logger.info(`Timer ${name}: ${ms.toFixed(2)}ms`);
        return ms;
      },
      withTiming: async (fn, { logResult = false } = {}) => {
        const t0 = performance.now();
        try {
          const result = await fn();
          const ms = performance.now() - t0;
          if (logResult) logger.info(`Timer ${name}: ${ms.toFixed(2)}ms`);
          return { ms, result, error: null };
        } catch (error) {
          const ms = performance.now() - t0;
          logger.error(`Timer ${name} error after ${ms.toFixed(2)}ms: ${error?.message}`, { stack: error?.stack });
          return { ms, result: null, error };
        }
      },
    };
  }

  return {
    counter,
    gauge,
    timer,
  };
}
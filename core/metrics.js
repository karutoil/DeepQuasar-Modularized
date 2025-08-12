/**
 * Minimal metrics facade (no-op by default).
 * Provides counters, gauges, and timers to standardize measurements.
 */
/**
 * Returns a metrics object for the given namespace.
 * Aggregates counters and provides a snapshot of current values.
 */
const _metricsRegistry = new Map();

export function getMetrics(namespace, logger = console) {
  if (_metricsRegistry.has(namespace)) {
    return _metricsRegistry.get(namespace);
  }

  // Internal storage for counters
  const counters = new Map();

  function increment(name, n = 1) {
    if (!counters.has(name)) counters.set(name, 0);
    counters.set(name, counters.get(name) + n);
  }

  function get(name) {
    return counters.get(name) || 0;
  }

  function reset(name) {
    counters.set(name, 0);
  }

  function snapshot() {
    // Return a shallow copy of all counters
    return Object.fromEntries(counters.entries());
  }

  const metricsObj = {
    increment,
    get,
    reset,
    snapshot,
  };

  _metricsRegistry.set(namespace, metricsObj);
  return metricsObj;
}

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

/*  * Reports a metric value using the provided logger.
 * @param {string} namespace - The metric namespace.
 * @param {string} name - The metric name.
 * @param {number} value - The metric value.
 * @param {object} [logger=console] - Optional logger. */
export function reportMetric(namespace, name, value, logger = console) {
  logger.info(`[Metric] ${namespace}.${name}: ${value}`);
}

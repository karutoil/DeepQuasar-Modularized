/**
 * Minimal error reporting service with optional Sentry integration.
 * Provides a unified `report(error, context?)` used across core/DSL.
 */

let sentryLoaded = false;
let Sentry = null;

function initSentry(config, logger) {
  try {
    const dsn = config.get("SENTRY_DSN");
    if (!dsn) return;
    // Dynamic ESM import at runtime to avoid hard dep if not configured
    // Note: package.json already includes @sentry/node
    return import("@sentry/node").then(mod => {
      Sentry = mod;
      Sentry.init({
        dsn,
        tracesSampleRate: Number(config.get("SENTRY_TRACES_SAMPLE_RATE", "0")) || 0,
        environment: config.get("NODE_ENV", "development"),
      });
      sentryLoaded = true;
      logger?.info?.("Sentry initialized");
    }).catch(err => {
      logger?.warn?.(`Failed to initialize Sentry: ${err?.message}`);
    });
  } catch (err) {
    logger?.warn?.(`Sentry init error: ${err?.message}`);
  }
}

export function createErrorReporter({ config, logger }) {
  // Kick off Sentry init (non-blocking)
  initSentry(config, logger);

  async function report(error, context = {}) {
    try {
      // Always log locally
      const message = error?.message || String(error);
      logger?.error?.(`Reported error: ${message}`, { stack: error?.stack, ...context });

      // Send to Sentry if configured
      if (sentryLoaded && Sentry) {
        Sentry.captureException(error, (scope) => {
          try {
            const extras = { ...context };
            Object.entries(extras).forEach(([k, v]) => scope.setExtra(k, v));
          } catch {}
          return scope;
        });
      }
    } catch (e) {
      logger?.warn?.(`Error while reporting error: ${e?.message}`);
    }
  }

  return {
    report,
  };
}
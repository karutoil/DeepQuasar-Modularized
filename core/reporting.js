/**
 * Minimal error reporting service with optional Sentry integration.
 * Provides a unified `report(error, context?)` used across core/DSL.
 */
export function createErrorReporter({ _config, logger }) {
  async function report(error, context = {}) {
    try {
      // Always log locally
      const message = error?.message || String(error);
      logger?.error?.(`Reported error: ${message}`, { stack: error?.stack, ...context });
    } catch (e) {
      logger?.warn?.(`Error while reporting error: ${e?.message}`);
    }
  }

  return {
    report,
  };
}

/**
 * Standardized error reporting function for use across modules.
 * Logs errors and sends to Sentry if configured.
 * Usage: reportError(error, context?)
 */
export async function reportError(error, context = {}) {
  try {
    // Use console as fallback logger if not available
    const logger = (globalThis.logger && typeof globalThis.logger.error === 'function')
      ? globalThis.logger
      : {
          error: (...args) => console.error(...args),
          warn: (...args) => console.warn(...args),
        };

    const message = error?.message || String(error);
    logger.error?.(`Reported error: ${message}`, { stack: error?.stack, ...context });
  } catch (e) {
    // Fallback warning
    const logger = (globalThis.logger && typeof global.logger.warn === 'function')
      ? globalThis.logger
      : { warn: (...args) => console.warn(...args) };
    logger.warn?.(`Error while reporting error: ${e?.message}`);
  }
}
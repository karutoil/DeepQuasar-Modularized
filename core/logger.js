import winston from "winston";

// Global Winston singleton guarded via globalThis to avoid multiple Console pipes
const GLOBAL_KEY = "__DQ__WINSTON_LOGGER_SINGLETON__";
const PATCH_KEY = "__DQ__WINSTON_PATCHED__";

function patchWinstonOnce() {
  try {
    if (globalThis[PATCH_KEY]) return;
    // Defensive patch: prevent duplicate piping of the same transport stream to Console
    const LoggerProto = winston.Logger?.prototype || winston.createLogger({ transports: [] }).constructor.prototype;
    const originalAdd = LoggerProto.add;
    LoggerProto.add = function patchedAdd(transport) {
      try {
        // If a transport with same name and stream exists, skip re-adding
        const exists = Array.isArray(this.transports) && this.transports.some((t) => {
          try {
            return (t?.name === transport?.name) && (t?._stream === transport?._stream);
          } catch { return false; }
        });
        if (exists) {
          return this;
        }
      } catch {}
      return originalAdd.call(this, transport);
    };
    globalThis[PATCH_KEY] = true;
  } catch {}
}

// Diagnostics disabled
let LOGGER_INIT_COUNT = 0;
let FIRST_INIT_STACK = null;

function buildBaseLogger(level = "info") {
  const { combine, timestamp, colorize, printf, splat, errors, metadata } = winston.format;

  const fmt = printf(({ level, message, timestamp, stack, ...meta }) => {
    const extra = meta.metadata && Object.keys(meta.metadata).length ? ` ${JSON.stringify(meta.metadata)}` : "";
    const base = `${timestamp} [${level}] ${message}`;
    return stack ? `${base}\n${stack}${extra}` : `${base}${extra}`;
  });

  // Create a single Console transport instance for the singleton
  const consoleTransport = new winston.transports.Console();

  const baseLogger = winston.createLogger({
    level,
    format: combine(
      errors({ stack: true }),
      splat(),
      metadata({ fillExcept: ["message", "level", "timestamp", "label"] }),
      timestamp(),
      colorize({ all: true }),
      fmt
    ),
    defaultMeta: {},
    transports: [consoleTransport],
  });

  // Diagnostics: count console transports attached to this logger
  // diagnostics disabled

  // Provide a child() method that reuses transports without creating a new Logger instance
  baseLogger.child = (meta = {}) => {
    const child = baseLogger; // reuse the singleton instance
    const merged = { ...(child.defaultMeta || {}), ...meta };
    // We create a shallow facade that proxies to the singleton but carries defaultMeta
    const facade = new Proxy(child, {
      get(target, prop) {
        if (prop === "defaultMeta") return merged;
        return Reflect.get(target, prop);
      }
    });
    return facade;
  };

  return baseLogger;
}

// Public API: getLogger() returns the process-wide singleton
export function getLogger(level = "info") {
  patchWinstonOnce();
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = buildBaseLogger(level);
  } else {
    try {
      if (level && globalThis[GLOBAL_KEY].level !== level) {
        globalThis[GLOBAL_KEY].level = level;
      }
    } catch {}
  }
  return globalThis[GLOBAL_KEY];
}

// Backward-compat: createLogger now delegates to the singleton
export function createLogger(level = "info") {
  return getLogger(level);
}

export function childLogger(parent, moduleName) {
  if (typeof parent?.child === "function") {
    return parent.child({ module: moduleName });
  }
  return parent;
}
import winston from "winston";
import LokiTransport from 'winston-loki';
import { randomUUID } from 'crypto';
import os from 'os';

// Global Winston singleton guarded via globalThis to avoid multiple Console pipes
const GLOBAL_KEY = "__DQ__WINSTON_LOGGER_SINGLETON__";
const PATCH_KEY = "__DQ__WINSTON_PATCHED__";

// Utility function to generate correlation IDs
export function generateCorrelationId() {
  return randomUUID();
}

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
      } catch (err) { void err; } // eslint-disable-line no-empty
      return originalAdd.call(this, transport);
    };
    globalThis[PATCH_KEY] = true;
  } catch (err) { void err; } // eslint-disable-line no-empty
}

// Diagnostics disabled
let LOGGER_INIT_COUNT = 0;
let FIRST_INIT_STACK = null;

function buildBaseLogger(level = "info", config) {
  const { combine, timestamp, colorize, printf, splat, errors, metadata, json } = winston.format;

  // Enhanced console format for better readability
  const consoleFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
    const extra = meta.metadata && Object.keys(meta.metadata).length ? ` ${JSON.stringify(meta.metadata)}` : "";
    const base = `${timestamp} [${level}] ${message}`;
    return stack ? `${base}\n${stack}${extra}` : `${base}${extra}`;
  });

  // Structured format for Loki with enhanced metadata
  const lokiFormat = combine(
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    errors({ stack: true }),
    splat(),
    metadata({ fillExcept: ["message", "level", "timestamp", "label"] }),
    json()
  );

  // Create a single Console transport instance for the singleton
  const consoleTransport = new winston.transports.Console({
    format: combine(
      errors({ stack: true }),
      splat(),
      metadata({ fillExcept: ["message", "level", "timestamp", "label"] }),
      timestamp(),
      colorize({ all: true }),
      consoleFormat
    )
  });

  const transports = [
    consoleTransport,
  ];

  const lokiUrl = config.get("LOKI_URL");
  if (lokiUrl) {
    const lokiUsername = config.get("LOKI_USERNAME");
    const lokiPassword = config.get("LOKI_PASSWORD");
    const environment = config.get("NODE_ENV") || "development";
    const serviceName = config.get("SERVICE_NAME") || "deepquasar";
    const serviceVersion = config.get("SERVICE_VERSION") || "unknown";
    
    transports.push(
      new LokiTransport({
        host: lokiUrl,
        json: true,
        format: lokiFormat,
        labels: (info) => {
          // Base labels for filtering and grouping in Grafana
          const baseLabels = { 
            app: serviceName,
            environment: environment,
            level: info.level,
            service_version: serviceVersion
          };
          
          // Add module label if present in metadata
          if (info.metadata && info.metadata.module) {
            baseLabels.module = info.metadata.module;
          }
          
          // Add request/correlation ID if present
          if (info.metadata && info.metadata.requestId) {
            baseLabels.request_id = info.metadata.requestId;
          }
          
          // Add user ID if present for user-specific filtering
          if (info.metadata && info.metadata.userId) {
            baseLabels.user_id = info.metadata.userId;
          }
          
          // Add guild ID for Discord-specific filtering
          if (info.metadata && info.metadata.guildId) {
            baseLabels.guild_id = info.metadata.guildId;
          }
          
          // Add error type for better error tracking
          if (info.level === 'error' && info.metadata && info.metadata.errorType) {
            baseLabels.error_type = info.metadata.errorType;
          }
          
          return baseLabels;
        },
        ...(lokiUsername && lokiPassword && { basicAuth: { username: lokiUsername, password: lokiPassword } }),
        onConnectionError: (err) => console.error('Loki connection error:', err),
        // Enhanced options for better performance and reliability
        interval: 5,
        timeout: 30000,
        batching: true,
        batchSize: 400
      })
    );
  }

  const baseLogger = winston.createLogger({
    level,
    format: lokiFormat, // Use the structured format as default
    defaultMeta: {
      service: config.get("SERVICE_NAME") || "deepquasar",
      environment: config.get("NODE_ENV") || "development",
      pid: process.pid,
      hostname: os.hostname()
    },
    transports,
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

  // Add helper methods for structured logging
  baseLogger.logError = function(error, context = {}) {
    const errorData = {
      errorType: error.constructor.name,
      errorMessage: error.message,
      errorStack: error.stack,
      ...context
    };
    this.error('Error occurred', errorData);
  };

  baseLogger.logRequest = function(req, res, duration, context = {}) {
    const requestData = {
      method: req?.method,
      url: req?.url,
      statusCode: res?.statusCode,
      duration,
      userAgent: req?.headers?.['user-agent'],
      ip: req?.ip || req?.connection?.remoteAddress,
      ...context
    };
    this.info('HTTP Request', requestData);
  };

  baseLogger.logDiscordEvent = function(eventType, guildId, userId, context = {}) {
    const discordData = {
      eventType,
      guildId,
      userId,
      ...context
    };
    this.info('Discord Event', discordData);
  };

  baseLogger.logPerformance = function(operation, duration, context = {}) {
    const perfData = {
      operation,
      duration,
      performanceMarker: true,
      ...context
    };
    this.info('Performance Metric', perfData);
  };

  return baseLogger;
}

// Public API: getLogger() returns the process-wide singleton
export function getLogger(level = "info", config) {
  patchWinstonOnce();
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = buildBaseLogger(level, config);
  } else {
    try {
      if (level && globalThis[GLOBAL_KEY].level !== level) {
        globalThis[GLOBAL_KEY].level = level;
      }
    } catch (err) { void err; } // eslint-disable-line no-empty
  }
  return globalThis[GLOBAL_KEY];
}

// Backward-compat: createLogger now delegates to the singleton
export function createLogger(level = "info", config) {
  return getLogger(level, config);
}

export function childLogger(parent, moduleName, additionalMeta = {}) {
  if (typeof parent?.child === "function") {
    return parent.child({ 
      module: moduleName,
      ...additionalMeta
    });
  }
  return parent;
}

// Helper function to create a request-scoped logger with correlation ID
export function createRequestLogger(baseLogger, requestId = null, additionalMeta = {}) {
  const correlationId = requestId || generateCorrelationId();
  return childLogger(baseLogger, 'request', {
    requestId: correlationId,
    ...additionalMeta
  });
}

// Helper function to create a user-scoped logger
export function createUserLogger(baseLogger, userId, guildId = null, additionalMeta = {}) {
  return childLogger(baseLogger, 'user', {
    userId,
    ...(guildId && { guildId }),
    ...additionalMeta
  });
}

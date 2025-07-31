import winston from "winston";

export function createLogger(level = "info") {
  const { combine, timestamp, colorize, printf, splat, errors, metadata } = winston.format;

  const fmt = printf(({ level, message, timestamp, stack, ...meta }) => {
    // meta.metadata holds extra fields when metadata() is used
    const extra = meta.metadata && Object.keys(meta.metadata).length ? ` ${JSON.stringify(meta.metadata)}` : "";
    const base = `${timestamp} [${level}] ${message}`;
    return stack ? `${base}\n${stack}${extra}` : `${base}${extra}`;
  });

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
    transports: [new winston.transports.Console()],
  });

  // Provide a child() method that attaches defaultMeta without relying on clone()
  baseLogger.child = (meta = {}) => {
    return winston.createLogger({
      level: baseLogger.level,
      format: baseLogger.format,
      defaultMeta: { ...(baseLogger.defaultMeta || {}), ...meta },
      transports: baseLogger.transports,
    });
  };

  return baseLogger;
}

export function childLogger(parent, moduleName) {
  // Safely create a child logger with module name as metadata
  if (typeof parent.child === "function") {
    return parent.child({ module: moduleName });
  }
  return parent; // fallback
}
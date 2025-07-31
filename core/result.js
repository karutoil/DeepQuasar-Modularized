/**
 * Standard Result helpers for consistent success/error returns across modules.
 */
export class Result {
  constructor(ok, value, error) {
    this.ok = ok;
    this.value = value;
    this.error = error;
  }
  static ok(value) {
    return new Result(true, value, null);
  }
  static err(code, message, meta = {}) {
    return new Result(false, null, { code, message, meta });
  }
}

export const ErrorCodes = Object.freeze({
  UNKNOWN: "UNKNOWN",
  PERMISSION: "PERMISSION",
  RATE_LIMIT: "RATE_LIMIT",
  VALIDATION: "VALIDATION",
  EXTERNAL: "EXTERNAL",
});

export function normalizeError(e, fallbackCode = ErrorCodes.UNKNOWN) {
  if (!e) return { code: fallbackCode, message: "Unknown error", meta: {} };
  if (typeof e === "string") return { code: fallbackCode, message: e, meta: {} };
  return {
    code: e.code || fallbackCode,
    message: e.message || "Error",
    meta: e.meta || {},
  };
}
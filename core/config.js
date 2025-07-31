import dotenv from "dotenv";

dotenv.config();

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off"]);

/**
 * Config service to access environment variables with validation and helpers.
 */
class Config {
  constructor(env = process.env) {
    this._env = { ...env };
    this._frozen = Object.freeze({ ...env });
  }

  all() {
    return this._frozen;
  }

  get(key, fallback = undefined) {
    const v = this._env[key];
    return v === undefined ? fallback : v;
  }

  getBool(key, fallback = false) {
    const v = this._env[key];
    if (v === undefined) return fallback;
    const norm = String(v).trim().toLowerCase();
    if (TRUE_VALUES.has(norm)) return true;
    if (FALSE_VALUES.has(norm)) return false;
    return fallback;
  }

  require(keys) {
    const missing = [];
    for (const k of keys) {
      if (!this.get(k)) missing.push(k);
    }
    if (missing.length) {
      throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
    }
  }

  isEnabled(flagName, defaultVal = true) {
    const v = this._env[flagName];
    if (v === undefined) return defaultVal;
    return this.getBool(flagName, defaultVal);
  }
}

export function createConfig() {
  return new Config();
}
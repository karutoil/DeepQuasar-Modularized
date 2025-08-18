/**
 * Minimal Guild Config service.
 * Purpose: provide locale resolution preferences per guild and simple key-value storage.
 * Backed by in-memory Map by default. If a Mongo client is provided, it can be extended later.
 */

export function createGuildConfig({ mongo: _mongo, logger: _logger, config: _config }) {
  // In-memory store shape:
  // guildData: Map<guildId, { locale?: string, data?: Record<string, any> }>
  const guildData = new Map();

  function getGuild(guildId) {
    if (!guildId) return null;
    let v = guildData.get(guildId);
    if (!v) {
      v = { data: {} };
      guildData.set(guildId, v);
    }
    return v;
  }

  function setLocale(guildId, locale) {
    const g = getGuild(guildId);
    if (!g) return;
    g.locale = normalizeLocale(locale);
  }

  function getLocale(guildId) {
    const g = getGuild(guildId);
    return g?.locale || null;
  }

  function set(guildId, key, value) {
    const g = getGuild(guildId);
    if (!g) return;
    g.data[key] = value;
  }

  function get(guildId, key, fallback = undefined) {
    const g = getGuild(guildId);
    if (!g) return fallback;
    return g.data[key] === undefined ? fallback : g.data[key];
  }

  function normalizeLocale(l) {
    try {
      if (typeof l !== "string") return "en";
      return l.trim() || "en";
    } catch {
      return "en";
    }
  }

  return {
    setLocale,
    getLocale,
    set,
    get,
    // For future persistence/mongo: placeholders
    _debugDump: () => Object.fromEntries(guildData),
  };
}
/**
 * Minimal i18n service to satisfy core imports and provide basic translation.
 * Design:
 * - Key-value lookup with optional per-module namespace: `${moduleName}.${key}` fallback to `key`
 * - Locale resolution from provided opts or Discord guild preferredLocale/user locale
 * - Safe accessor `safeT` for cases where missing keys are acceptable with defaultValue
 *
 * This is intentionally lightweight. It can be expanded later to load per-module
 * translation files under modules/<name>/i18n/<locale>.json, add pluralization, etc.
 */

export function createI18n({ config, logger }) {
  // Default locale from env or fallback
  const defaultLocale = config.get("DEFAULT_LOCALE", "en");

  // In-memory translations map: { [locale: string]: { [key: string]: string } }
  // Start empty; modules may register keys at runtime via `register` if desired.
  const translations = new Map();

  function set(locale, entries) {
    if (!locale || !entries || typeof entries !== "object") return;
    const current = translations.get(locale) || {};
    translations.set(locale, { ...current, ...entries });
  }

  function get(locale) {
    return translations.get(locale) || {};
  }

  /**
   * Resolve the locale to use.
   * opts: { guildId?, userLocale? }
   * - userLocale wins if present
   * - otherwise try to infer from Discord (caller can pass it in)
   * - fallback to DEFAULT_LOCALE or "en"
   */
  function resolveLocale({ _guildId = null, userLocale = null } = {}) {
    const envLocale = config.get("DEFAULT_LOCALE");
    const locale = userLocale || envLocale || defaultLocale || "en";
    return normalizeLocale(locale);
  }

  function normalizeLocale(l) {
    // Make sure we have a simple tag like "en" or "en-US"
    try {
      if (typeof l !== "string") return "en";
      return l.trim() || "en";
    } catch {
      return "en";
    }
  }

  /**
   * Interpolate simple template parameters in a string: "Hello, {name}" + { name: "John" }
   */
  function format(str, params = {}) {
    if (!params || typeof params !== "object") return str;
    return String(str).replace(/\{([^}]+)\}/g, (_m, key) => {
      const v = params[key.trim()];
      return v === undefined || v === null ? "" : String(v);
    });
  }

  /**
   * Translate a key with module-aware fallback.
   * args: { key, params?, locale?, moduleName? }
   * Lookup order:
   *   1) `${moduleName}.${key}`
   *   2) `${key}`
   * If not found, returns the key itself.
   */
  function t({ key, params = {}, locale, moduleName } = {}) {
    try {
      const loc = normalizeLocale(locale || defaultLocale);
      const dict = get(loc);
      const namespaced = moduleName ? `${moduleName}.${key}` : null;

      let template;
      if (namespaced && dict[namespaced] !== undefined) {
        template = dict[namespaced];
      } else if (dict[key] !== undefined) {
        template = dict[key];
      } else {
        // fallback to default locale dictionary if different
        if (loc !== "en") {
          const enDict = get("en");
          if (namespaced && enDict[namespaced] !== undefined) {
            template = enDict[namespaced];
          } else if (enDict[key] !== undefined) {
            template = enDict[key];
          }
        }
      }

      if (template === undefined) return key;
      return format(template, params);
    } catch (err) {
      logger?.warn?.(`i18n.t error: ${err?.message}`);
      return key;
    }
  }

  /**
   * Safe translate with defaultValue and options:
   * safeT(key, { defaultValue, locale, moduleName, params })
   */
  function safeT(key, { defaultValue = key, locale, moduleName, params = {} } = {}) {
    try {
      const result = t({ key, params, locale, moduleName });
      if (result === key && defaultValue !== undefined) return format(defaultValue, params);
      return result;
    } catch {
      return defaultValue;
    }
  }

  /**
   * Optional runtime registration API for modules to inject translations.
   * register('en', { 'ping.details': 'Show details' })
   */
  function register(locale, entries) {
    set(normalizeLocale(locale), entries);
  }

  // Seed minimal defaults so UI texts in core DSL read better out-of-the-box
  register("en", {
    "dsl.error.title": "Error",
    "dsl.error.default": "An error occurred while processing your request.",
    "dsl.rateLimited.title": "Rate limited",
    "dsl.rateLimited.message": "You're doing that too much. Please slow down.",
    "dsl.notAllowed.title": "Not allowed",
    "dsl.notAllowed.message": "You are not allowed to perform this action.",
    "dsl.cancelled": "Cancelled.",
    "dsl.confirm": "Confirm",
    "dsl.cancel": "Cancel",
  });

  return {
    resolveLocale,
    t,
    safeT,
    register,
    // For possible external inspection/testing
    _getTranslations: () => translations,
  };
}
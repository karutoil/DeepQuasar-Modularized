/**
 * Localization keys for Message Quote module.
 * Centralize user-facing strings for translation.
 *
 * Use with ctx.t(key, params).
 */
export const tKeys = {
  errors: {
    missingPermsTitle: "message-quote.errors.missingPermsTitle",
    missingPerms: "message-quote.errors.missingPerms",
    fetchFailedTitle: "message-quote.errors.fetchFailedTitle",
    fetchFailed: "message-quote.errors.fetchFailed"
  },
  header: {
    quotedBy: "message-quote.header.quotedBy"
  },
  main: {
    channel: "message-quote.main.channel",
    messageId: "message-quote.main.messageId",
    noContent: "message-quote.main.noContent",
    timestampFooter: "message-quote.main.timestampFooter"
  },
  button: {
    goTo: "message-quote.button.goTo"
  }
};

// Default English strings (active by default)
// If your global i18n overrides these keys, ctx.t will use that; otherwise these serve as defaults.
const en = {
  "message-quote.errors.missingPermsTitle": "Missing permissions",
  "message-quote.errors.missingPerms": "I cannot read the referenced channel. Missing: {perms}",
  "message-quote.errors.fetchFailedTitle": "Cannot fetch message",
  "message-quote.errors.fetchFailed": "I could not fetch the referenced message.",
  "message-quote.header.quotedBy": "Quoted by {username}",
  "message-quote.main.channel": "Channel",
  "message-quote.main.messageId": "ID: {id}",
  "message-quote.main.noContent": "(no text content)",
  "message-quote.main.timestampFooter": "Original message • {ts}",
  "message-quote.button.goTo": "Go to message"
};

/**
 * Translate helper with default English fallback.
 * Usage: t(ctx, key, params)
 */
export function t(ctx, key, params, opts) {
  try {
    // Prefer repository/global i18n if available
    const translated = ctx?.t?.(key, params, opts);
    if (translated && translated !== key) return translated;
  } catch {
    // ignore and fallback
  }
  // Fallback to local English defaults
  return format(en[key] ?? key, params);
}

function format(template, params) {
  if (!params) return template;
  return String(template).replace(/\{(\w+)\}/g, (_, k) => {
    return Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : `{${k}}`;
  });
}
/**
 * Message Quote module
 * Automatically converts valid in-guild Discord message links into rich embeds.
 *
 * Feature flag: MODULE_MESSAGE_QUOTE_ENABLED (default true)
 * Per-guild config (via ctx.guildConfig):
 *  - message_quote_enabled: boolean (default true)
 *  - message_quote_delete_original: boolean (default false)
 */
export default async function init(ctx) {
  const moduleName = "message-quote";
  const { logger, config, lifecycle } = ctx;

  const enabledFlag = config.isEnabled("MODULE_MESSAGE_QUOTE_ENABLED", true);
  if (!enabledFlag) {
    logger.info("[MessageQuote] Module disabled via env flag.");
    return { name: moduleName, description: "Message Quote module (disabled)" };
  }

  const disposers = [];

  try {
    const { registerMessageCreateHandler } = await import("./handlers/events.js");
    const d = registerMessageCreateHandler(ctx);
    if (typeof d === "function") disposers.push(d);
  } catch (e) {
    logger.error("[MessageQuote] Failed to register messageCreate handler", { error: e?.message });
  }

  lifecycle.addDisposable(() => {
    for (const d of disposers) {
      try { d?.(); } catch {}
    }
  });

  //logger.info("[MessageQuote] Module loaded.");
  return {
    name: moduleName,
    description: "Converts valid in-guild message links into rich embeds with a jump button.",
    dispose: async () => {
      logger.info("[MessageQuote] Module unloaded.");
      for (const d of disposers) {
        try { d?.(); } catch {}
      }
    }
  };
}
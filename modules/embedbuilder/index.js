export default async function init(ctx) {
  const moduleName = "embedbuilder";
  const { logger, config, lifecycle } = ctx;

  if (!config.isEnabled("MODULE_EMBEDBUILDER_ENABLED", true)) {
    logger.info("[EmbedBuilder] Module disabled via config.");
    return { name: moduleName, description: "Embed Builder (disabled)" };
  }

  const disposers = [];

  // Ensure DB indexes for templates
  try {
    const { ensureIndexes } = await import("./services/templates.js");
    await ensureIndexes(ctx);
  } catch (e) {
    logger.warn("[EmbedBuilder] ensureIndexes failed", { error: e?.message });
  }

  // Register the /embedbuilder command and interactions
  try {
    const { registerEmbedBuilder } = await import("./handlers/builder.js");
    const d = registerEmbedBuilder(ctx);
    if (typeof d === "function") disposers.push(d);
  } catch (e) {
    logger.error("[EmbedBuilder] Failed to register builder command", { error: e?.message });
  }

  lifecycle.addDisposable(() => {
    for (const d of disposers) {
      try { d?.(); } catch {}
    }
  });

  //logger.info("[EmbedBuilder] Module loaded.");
  return {
    name: moduleName,
    description: "Interactive embed builder with live preview, per-guild templates, import/export, and send-to-channel.",
    dispose: async () => {
      logger.info("[EmbedBuilder] Module unloaded.");
      for (const d of disposers) {
        try { d?.(); } catch {}
      }
    }
  };
}
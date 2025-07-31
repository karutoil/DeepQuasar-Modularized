/**
 * DSL helpers (decorators) to standardize interaction handlers.
 * Provides wrappers: withTryCatch, withDeferredReply, withCooldown, withPerms.
 */
export function createDsl({ logger, embed, rateLimiter, permissions }) {
  /**
   * Wrap handler with try/catch and standardized error reply.
   */
  function withTryCatch(handler, { errorMessage = "An error occurred while processing your request." } = {}) {
    return async (interaction) => {
      try {
        await handler(interaction);
      } catch (err) {
        logger.error(`Handler error: ${err?.message}`, { stack: err?.stack });
        try {
          if (interaction.isRepliable?.()) {
            const e = embed.error({ title: "Error", description: errorMessage });
            if (interaction.replied || interaction.deferred) {
              await interaction.followUp({ embeds: [e], ephemeral: true });
            } else {
              await interaction.reply({ embeds: [e], ephemeral: true });
            }
          }
        } catch (e) {
          logger.error(`Error replying after failure: ${e?.message}`, { stack: e?.stack });
        }
      }
    };
  }

  /**
   * Ensure interaction is deferred before executing handler.
   */
  function withDeferredReply(handler, { ephemeral = true } = {}) {
    return async (interaction) => {
      if (interaction.isRepliable?.() && !interaction.deferred && !interaction.replied) {
        try {
          await interaction.deferReply({ ephemeral });
        } catch (e) {
          logger.warn(`Failed to defer reply: ${e?.message}`);
        }
      }
      return handler(interaction);
    };
  }

  /**
   * Apply a simple cooldown using the core rateLimiter.
   * keyFn should return a unique key (e.g. `${module}:${cmd}:${interaction.user.id}`).
   */
  function withCooldown(handler, { keyFn, capacity = 1, refillPerSec = 1, message = "You're doing that too much. Please slow down." } = {}) {
    return async (interaction) => {
      const key = keyFn ? keyFn(interaction) : null;
      if (!key) return handler(interaction);

      rateLimiter.setConfig(key, { capacity, refillPerSec });
      const result = rateLimiter.take(key, { capacity, refillPerSec });
      if (!result.allowed) {
        if (interaction.isRepliable?.()) {
          const w = embed.warn({ title: "Rate limited", description: message });
          try {
            if (interaction.replied || interaction.deferred) {
              await interaction.followUp({ embeds: [w], ephemeral: true });
            } else {
              await interaction.reply({ embeds: [w], ephemeral: true });
            }
          } catch {}
        }
        return;
      }
      return handler(interaction);
    };
  }

  /**
   * Ensure permissions (user and bot) before running handler.
   */
  function withPerms(handler, { userPerms = [], botPerms = [] } = {}) {
    return async (interaction) => {
      const ok = await permissions.ensureInteractionPerms(interaction, { userPerms, botPerms });
      if (!ok) return;
      return handler(interaction);
    };
  }

  return {
    withTryCatch,
    withDeferredReply,
    withCooldown,
    withPerms,
  };
}
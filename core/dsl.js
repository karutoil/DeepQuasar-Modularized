/**
 * DSL helpers (decorators) to standardize interaction handlers.
 * Provides wrappers: withTryCatch, withDeferredReply, withCooldown, withPerms, withConfirmation.
 * V3: adds preconditions support and centralized error reporting/i18n integration.
 */
export function createDsl({ logger, embed, rateLimiter, permissions, errorReporter, i18n }) {
  /**
   * Wrap handler with try/catch and standardized error reply.
   */
  function withTryCatch(
    handler,
    { errorMessage = 'An error occurred while processing your request.' } = {}
  ) {
    return async (interaction, ...rest) => {
      try {
        await handler(interaction, ...rest);
      } catch (err) {
        logger.error(`Handler error: ${err?.message}`, { stack: err?.stack });
        try {
          await errorReporter?.report(err, {
            scope: 'handler',
            interactionName: getInteractionName(interaction),
          });
        } catch (err) {
          logger?.warn?.('errorReporter.report failed', err);
        }
        try {
          if (interaction.isRepliable?.()) {
            const e = embed.error({ title: 'Error', description: errorMessage });
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
    return async (interaction, ...rest) => {
      if (interaction.isRepliable?.() && !interaction.deferred && !interaction.replied) {
        try {
          await interaction.deferReply({ ephemeral });
        } catch (e) {
          logger.warn(`Failed to defer reply: ${e?.message}`);
        }
      }
      return handler(interaction, ...rest);
    };
  }

  /**
   * Apply a simple cooldown using the core rateLimiter.
   * keyFn should return a unique key (e.g. `${module}:${cmd}:${interaction.user.id}`).
   */
  function withCooldown(
    handler,
    {
      keyFn,
      capacity = 1,
      refillPerSec = 1,
      message = "You're doing that too much. Please slow down.",
    } = {}
  ) {
    return async (interaction, ...rest) => {
      const key = keyFn ? keyFn(interaction) : null;
      if (!key) return handler(interaction, ...rest);

      rateLimiter.setConfig(key, { capacity, refillPerSec });
      const result = rateLimiter.take(key, { capacity, refillPerSec });
      if (!result.allowed) {
        if (interaction.isRepliable?.()) {
          const w = embed.warn({ title: 'Rate limited', description: message });
          try {
            if (interaction.replied || interaction.deferred) {
              await interaction.followUp({ embeds: [w], ephemeral: true });
            } else {
              await interaction.reply({ embeds: [w], ephemeral: true });
            }
          } catch (err) {
            logger?.warn?.('errorReporter.report failed', err);
          }
        }
        return;
      }
      return handler(interaction, ...rest);
    };
  }

  /**
   * Ensure permissions (user and bot) before running handler.
   */
  function withPerms(handler, { userPerms = [], botPerms = [] } = {}) {
    return async (interaction, ...rest) => {
      const ok = await permissions.ensureInteractionPerms(interaction, { userPerms, botPerms });
      if (!ok) return;
      return handler(interaction, ...rest);
    };
  }

  /**
   * Ask for a confirmation before executing the handler. Works well with builder .onButton()
   * Usage:
   *   .onButton("delete", dsl.withConfirmation("Are you sure?", handler, { confirmLabel, cancelLabel }))
   */
  function withConfirmation(
    prompt,
    handler,
    { confirmLabel = 'Confirm', cancelLabel = 'Cancel', ephemeral = true } = {}
  ) {
    return async (interaction) => {
      try {
        const components = [
          {
            type: 1,
            components: [
              { type: 2, style: 3, label: confirmLabel, custom_id: 'dsl_confirm' },
              { type: 2, style: 4, label: cancelLabel, custom_id: 'dsl_cancel' },
            ],
          },
        ];
        // If we can update existing message, do so, otherwise reply
        if (interaction.isMessageComponent?.()) {
          await interaction.update({ content: prompt, components, ephemeral });
        } else if (interaction.isRepliable?.()) {
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: prompt, components, ephemeral });
          } else {
            await interaction.reply({ content: prompt, components, ephemeral });
          }
        }
        const filter = (i) =>
          i.user?.id === interaction.user?.id &&
          (i.customId === 'dsl_confirm' || i.customId === 'dsl_cancel');
        const msg = interaction.message || (await interaction.fetchReply?.());
        const collector = msg?.createMessageComponentCollector?.({ time: 15000, max: 1, filter });
        if (!collector) return;

        await new Promise((resolve) => {
          collector.on('collect', async (i) => {
            try {
              if (i.customId === 'dsl_confirm') {
                await handler(i);
              } else {
                try {
                  await i.update?.({ content: 'Cancelled.', components: [] });
                } catch (err) { void err; }
              }
            } finally {
              resolve();
            }
          });
          collector.on('end', async (collected) => {
            if (!collected?.size) {
              try {
                await interaction.editReply?.({ components: [] });
              } catch (err) { void err; }
            }
          });
        });
      } catch (e) {
        logger?.warn?.(`withConfirmation error: ${e?.message}`);
      }
    };
  }

  /**
   * Preconditions: composable authorization/validation checks.
   * A precondition is a function (interaction) => Promise<boolean | string>
   * - return true to allow
   * - return false or a string (message key) to block
   */
  function withPreconditions(handler, ...preconditions) {
    return async (interaction, ...rest) => {
      for (const pre of preconditions.flat()) {
        try {
          const res = await pre(interaction);
          if (res === true) continue;
          const reason =
            typeof res === 'string' ? res : 'You are not allowed to perform this action.';
          // i18n-aware message if available
          const locale = interaction.locale || interaction.guild?.preferredLocale;
          const msg = i18n?.safeT?.(reason, { defaultValue: reason, locale }) ?? reason;
          if (interaction.isRepliable?.()) {
            const w = embed.warn({ title: 'Not allowed', description: msg });
            try {
              if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [w], ephemeral: true });
              } else {
                await interaction.reply({ embeds: [w], ephemeral: true });
              }
            } catch (err) {
              logger?.warn?.('errorReporter.report failed', err);
            }
          }
          return;
        } catch (err) {
          logger.warn(`precondition error: ${err?.message}`);
          try {
            await errorReporter?.report(err, {
              scope: 'precondition',
              interactionName: getInteractionName(interaction),
            });
          } catch (err) { void err; }
          return;
        }
      }
      return handler(interaction, ...rest);
    };
  }

  // Helpers
  function getInteractionName(i) {
    try {
      if (i?.isChatInputCommand?.()) return `/${i.commandName}`;
      if (i?.isButton?.()) return `button:${i.customId}`;
      if (i?.isAnySelectMenu?.()) return `select:${i.customId}`;
      if (i?.type === 5 /* ModalSubmit */) return `modal:${i.customId}`;
    } catch (err) { void err; }
    return 'interaction';
  }

  return {
    withTryCatch,
    withDeferredReply,
    withCooldown,
    withPerms,
    withConfirmation,
    withPreconditions,
  };
}

import { PermissionFlagsBits, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { createSearchHandler } from './handlers/search.js';
import { createInspectHandler } from './handlers/inspect.js';
import { buildExportHandler } from './handlers/export.js';
import { suggestAuditEvent as suggestAuditEventDirect } from './utils/constants.js';

/**
 * ModLog module entry point (v2 builder wiring)
 */
export default async function init(ctx) {
  const moduleName = 'modlog';
  const hasFactory = typeof ctx?.createModuleContext === 'function';
  const mod = hasFactory ? ctx.createModuleContext(moduleName) : ctx;

  const { logger, config, lifecycle, interactions, v2, embed } = mod;

  if (!config.isEnabled('MODULE_MODLOG_ENABLED', true)) {
    logger.info('[ModLog] Module disabled via config.');
    return { name: moduleName, description: 'ModLog search module (disabled)' };
  }

  // Builders: one top-level /modlog, with subcommands implemented as separate builders for clarity
  const cmdModlog = v2
    .createInteractionCommand()
    .setName('auditlog')
    .setDescription('Audit log utilities')
    .setDefaultMemberPermissions(PermissionFlagsBits.ViewAuditLog); // already set

  // /modlog search
  cmdModlog.addOption((root) => {
    root.addSubcommand((sub) =>
      sub
        .setName('search')
        .setDescription('Search Discord Audit Logs with filters')
        .addStringOption((opt) =>
          opt
            .setName('event')
            .setDescription("Event type or alias (or 'all')")
            .setRequired(false)
            .setAutocomplete(true)
        )
        .addUserOption((opt) =>
          opt.setName('executor').setDescription('Requestor (executor) user').setRequired(false)
        )
        .addUserOption((opt) =>
          opt.setName('target').setDescription('Actioned (target) user').setRequired(false)
        )
        .addChannelOption((opt) =>
          opt.setName('channel').setDescription('Channel reference').setRequired(false)
        )
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Role reference').setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName('emoji').setDescription('Emoji ID').setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName('webhook').setDescription('Webhook ID').setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName('integration').setDescription('Integration ID').setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('since')
            .setDescription('ISO datetime or relative (e.g., 7d,4h)')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('until')
            .setDescription('ISO datetime or relative (e.g., now, 1d)')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Reason contains text').setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt.setName('page').setDescription('Page to open').setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt.setName('page_size').setDescription('Results per page').setRequired(false)
        )
    );
  });

  // /modlog export
  cmdModlog.addOption((root) => {
    root.addSubcommand((sub) =>
      sub
        .setName('export')
        .setDescription('Export audit log search to CSV/JSON (uses same filters)')
        .addStringOption((opt) =>
          opt
            .setName('format')
            .setDescription('Export format')
            .setRequired(true)
            .addChoices({ name: 'csv', value: 'csv' }, { name: 'json', value: 'json' })
        )
        .addStringOption((opt) =>
          opt
            .setName('event')
            .setDescription("Event type or alias (or 'all')")
            .setRequired(false)
            .setAutocomplete(true)
        )
        .addUserOption((opt) =>
          opt.setName('executor').setDescription('Requestor (executor) user').setRequired(false)
        )
        .addUserOption((opt) =>
          opt.setName('target').setDescription('Actioned (target) user').setRequired(false)
        )
        .addChannelOption((opt) =>
          opt.setName('channel').setDescription('Channel reference').setRequired(false)
        )
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Role reference').setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName('emoji').setDescription('Emoji ID').setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName('webhook').setDescription('Webhook ID').setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName('integration').setDescription('Integration ID').setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('since')
            .setDescription('ISO datetime or relative (e.g., 7d,4h)')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('until')
            .setDescription('ISO datetime or relative (e.g., now, 1d)')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Reason contains text').setRequired(false)
        )
    );
  });

  // /modlog inspect
  cmdModlog.addOption((root) => {
    root.addSubcommand((sub) =>
      sub
        .setName('inspect')
        .setDescription('Inspect a single audit log entry by ID')
        .addStringOption((opt) =>
          opt.setName('id').setDescription('Audit log entry ID (snowflake)').setRequired(true)
        )
    );
  });

  // Wire execution (single entry point with subcommands)
  cmdModlog.onExecute(async (interaction) => {
    const sub = interaction.options.getSubcommand();
    if (sub === 'search') {
      await createSearchHandler(mod)(interaction);
    } else if (sub === 'export') {
      await buildExportHandler(mod)(interaction);
    } else if (sub === 'inspect') {
      await createInspectHandler(mod)(interaction);
    }
  });

  // Autocomplete for "event" on both subcommands with robust error handling
  // IMPORTANT: Avoid throwing and ensure we always respond within 3 seconds. Also ensure the handler is registered via v2.register below.
  cmdModlog.onAutocomplete('event', async (interaction) => {
    try {
      // Some wrappers may not provide getFocused(true) initially; handle both cases.
      const focused =
        interaction.options?.getFocused?.(true) || interaction.options?.getFocused?.() || '';
      const query = typeof focused === 'object' ? (focused?.value ?? '') : (focused ?? '');
      const q = String(query || '');

      const choicesRaw = suggestAuditEventDirect(q);
      const choices = Array.isArray(choicesRaw) ? choicesRaw : [];

      // Clamp, sanitize, dedupe, and ensure "all"
      const seen = new Set();
      const payload = [];

      // Always include 'all' first to guarantee at least one option even when query filters out all others
      payload.push({ name: 'all', value: 'all' });
      seen.add('all');

      for (const c of choices) {
        const name = String(c?.name ?? '').trim();
        const value = String(c?.value ?? '').trim();
        if (!name || !value) continue;
        if (seen.has(value)) continue;
        seen.add(value);
        // Discord requires name/value to be <=100 chars. Also avoid uppercase-only "ALL" mismatch.
        const nm = name.slice(0, 100);
        const val = value.slice(0, 100);
        payload.push({ name: nm, value: val });
        if (payload.length >= 25) break;
      }

      // Respond MUST be called within 3s and exactly once; catch specific API errors
      try {
        await interaction.respond(payload.slice(0, 25));
      } catch (err) {
        // If already responded or expired, ignore; else provide minimal fallback
        try {
          await interaction.respond([{ name: 'all', value: 'all' }]);
        } catch {}
      }
    } catch (e) {
      // Final fallback
      try {
        await interaction.respond([{ name: 'all', value: 'all' }]);
      } catch {}
      try {
        mod.logger?.warn?.('[ModLog] Autocomplete failed, responded with fallback', {
          error: e?.message,
        });
      } catch {}
    }
  });

  // Register pagination button using interactions with prefix
  const searchHandler = createSearchHandler(mod);
  const offButton = interactions.registerButton(
    moduleName,
    'modlog:page:',
    async (interaction) => {
      await searchHandler.handlePagination(interaction);
    },
    { prefix: true }
  );
  lifecycle.addDisposable(offButton);
  const offSelect = interactions.registerSelect(
    moduleName,
    'modlog:page:',
    async (interaction) => {
      await searchHandler.handlePagination(interaction);
    },
    { prefix: true }
  );
  lifecycle.addDisposable(offSelect);

  // Register the command builder via v2 registrar
  const disposeCmd = v2.register(cmdModlog, moduleName);
  lifecycle.addDisposable(disposeCmd);

  //logger.info("[ModLog] Module loaded (v2).");
  return {
    name: moduleName,
    description: 'Audit Log search and export utilities (v2 wired)',
    dispose: async () => {
      logger.info('[ModLog] Module unloaded.');
      try {
        disposeCmd?.();
      } catch {}
      try {
        offButton?.();
      } catch {}
      try {
        interactions.removeModule(moduleName);
      } catch {}
    },
  };
}

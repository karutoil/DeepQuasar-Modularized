import { checkAuditPermissions } from "../utils/permissions.js";
import { normalizeFilters } from "../utils/filters.js";
import { searchAuditLogs } from "../services/auditSearchService.js";
import { buildSearchEmbeds, decodeState, buildDetailEmbed } from "../utils/formatters.js";
import { resolveEventAlias } from "../utils/constants.js";

/**
 * Factory returning the search command handler plus pagination handler.
 */
export function createSearchHandler(ctx) {
  const { logger, config } = ctx;

  async function handleSlash(interaction) {
    try {
      logger.debug("[ModLog] /modlog search invoked", {
        guildId: interaction.guildId,
        userId: interaction.user?.id,
        options: safeOpts(interaction)
      });

      const perms = checkAuditPermissions(interaction);
      if (!perms.ok) {
        logger.debug("[ModLog] Permission denied", { reason: perms.message });
        return interaction.reply({ content: perms.message, ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true }).catch((e) => {
        logger.warn("[ModLog] deferReply failed", { error: e?.message });
      });

      const filters = normalizeFilters(interaction, config);
      logger.debug("[ModLog] Normalized filters", { filters: redact(filters) });

      const res = await searchAuditLogs(ctx, interaction.guild, filters);
      logger.debug("[ModLog] Search results", { total: res?.meta?.total, page: res?.meta?.page, pageSize: res?.meta?.pageSize });

      const { embeds, components } = buildSearchEmbeds(ctx, interaction, res.items, res.meta, {
        ...filters,
        type: filters.type ?? "all"
      });

      return interaction.editReply({ embeds, components });
    } catch (err) {
      logger.error("[ModLog] search handler error", { error: err?.message, stack: err?.stack });
      try {
        if (interaction.isRepliable?.()) {
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: "An error occurred while processing search.", ephemeral: true });
          } else {
            await interaction.reply({ content: "An error occurred while processing search.", ephemeral: true });
          }
        }
      } catch (err) { void err; }
    }
  }

  async function handlePagination(interaction) {
    try {
      logger.debug("[ModLog] Pagination received", { customId: interaction.customId });

      const perms = checkAuditPermissions(interaction);
      if (!perms.ok) {
        logger.debug("[ModLog] Permission denied (pagination)", { reason: perms.message });
        return interaction.reply({ content: perms.message, ephemeral: true });
      }

      const state = decodeState(interaction.customId);
      if (!state) {
        logger.warn("[ModLog] Invalid pagination token", { customId: interaction.customId });
        return interaction.reply({ content: "Invalid pagination token.", ephemeral: true });
      }
  logger.debug("[ModLog] Decoded pagination state", { state: redact(state) });

  // If this is a select interaction (details request), show a detail view
  if (interaction.isSelectMenu?.()) {
        const vals = interaction.values || [];
        const selectedId = vals[0];
        if (!selectedId) return interaction.reply({ content: "No entry selected.", ephemeral: true });

        // Re-run the search for the same page to obtain items (we don't persist items across interactions)
        const baseFiltersForSelect = {
          ...state,
          ...(typeof state.type === "string" ? resolveEventAlias(state.type) : { type: state.type })
        };

        const selRes = await searchAuditLogs(ctx, interaction.guild, {
          ...baseFiltersForSelect,
          page: Number(baseFiltersForSelect.page) || 1,
          pageSize: Number(baseFiltersForSelect.pageSize) || Number(ctx.config.get("MODLOG_DEFAULT_PAGE_SIZE", 10))
        });

        const entry = selRes.items.find(e => String(e.id) === String(selectedId));
        if (!entry) {
          return interaction.reply({ content: "Selected entry not found (it may be out of range).", ephemeral: true });
        }

        const detail = buildDetailEmbed(ctx, interaction, entry);
        // Build a back button that encodes current state so we can restore the page
        const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = await import("discord.js");
        const backId = String(interaction.customId).replace(/:select$/, ":back");
        const backBtn = new ButtonBuilder().setCustomId(backId).setLabel("Back").setStyle(ButtonStyle.Secondary);
        const row = new ActionRowBuilder().addComponents(backBtn);

        try {
          if (interaction.isButton?.() || interaction.isSelectMenu?.()) {
            await interaction.update({ embeds: [detail], components: [row], ephemeral: true });
          } else {
            await interaction.reply({ embeds: [detail], components: [row], ephemeral: true });
          }
        } catch (e) {
          try { await interaction.reply({ embeds: [detail], components: [row], ephemeral: true }); } catch (err) { void err; }
        }
        return;
      }

      // If this is a 'back' button from the detail view, restore the search page
      if (interaction.isButton?.() && String(interaction.customId).endsWith(":back")) {
        const baseFilters = {
          ...state,
          ...(typeof state.type === "string" ? resolveEventAlias(state.type) : { type: state.type })
        };

        const res = await searchAuditLogs(ctx, interaction.guild, {
          ...baseFilters,
          page: Number(baseFilters.page) || 1,
          pageSize: Number(baseFilters.pageSize) || Number(ctx.config.get("MODLOG_DEFAULT_PAGE_SIZE", 10))
        });

        const { embeds, components } = buildSearchEmbeds(ctx, interaction, res.items, res.meta, {
          ...res.meta,
          ...state
        });

        try {
          await interaction.update({ embeds, components });
        } catch (e) {
          logger.warn("[ModLog] back button update failed, replying instead", { error: e?.message });
          try { await interaction.reply({ embeds, components, ephemeral: true }); } catch (err) { void err; }
        }
        return;
      }

      const baseFilters = {
        ...state,
        ...(typeof state.type === "string" ? resolveEventAlias(state.type) : { type: state.type })
      };

      const res = await searchAuditLogs(ctx, interaction.guild, {
        ...baseFilters,
        page: Number(baseFilters.page) || 1,
        pageSize: Number(baseFilters.pageSize) || Number(ctx.config.get("MODLOG_DEFAULT_PAGE_SIZE", 10))
      });
      logger.debug("[ModLog] Pagination search results", { total: res?.meta?.total, page: res?.meta?.page });

      const { embeds, components } = buildSearchEmbeds(ctx, interaction, res.items, res.meta, {
        ...res.meta,
        ...state
      });

      try {
        if (interaction.isButton?.()) {
          await interaction.update({ embeds, components });
        } else {
          await interaction.reply({ embeds, components, ephemeral: true });
        }
      } catch (e) {
        logger.warn("[ModLog] pagination update failed, replying instead", { error: e?.message });
        try { await interaction.reply({ embeds, components, ephemeral: true }); } catch (err) { void err; }
      }
    } catch (err) {
      logger.error("[ModLog] pagination handler error", { error: err?.message, stack: err?.stack });
      try { await interaction.reply({ content: "Pagination failed.", ephemeral: true }); } catch (err) { void err; }
    }
  }

  const handler = (interaction) => handleSlash(interaction);
  handler.handlePagination = handlePagination;
  return handler;
}

function safeOpts(interaction) {
  try {
    // pull out only primitive option values for logging
    const data = interaction?.options?._hoistedOptions || [];
    return data.map(o => ({ name: o.name, type: o.type, value: sanitize(o.value) }));
  } catch {
    return null;
  }
}
function sanitize(v) {
  if (v == null) return v;
  const s = String(v);
  return s.length > 120 ? s.slice(0, 117) + "..." : s;
}
function redact(obj) {
  try {
    const clone = JSON.parse(JSON.stringify(obj));
    // nothing particularly sensitive, but keep consistent interface
    return clone;
  } catch {
    return {};
  }
}
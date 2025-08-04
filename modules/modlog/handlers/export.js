import { checkAuditPermissions } from "../utils/permissions.js";
import { normalizeFilters } from "../utils/filters.js";
import { searchAuditLogs } from "../services/auditSearchService.js";
import { toCSV, toJSONL } from "../utils/formatters.js";
import { AttachmentBuilder } from "discord.js";

export function buildExportHandler(ctx) {
  const { logger, config } = ctx;

  return async function handleExport(interaction) {
    const perms = checkAuditPermissions(interaction);
    if (!perms.ok) {
      return interaction.reply({ content: perms.message, ephemeral: true });
    }

    const format = interaction.options.getString("format", true); // csv | json
    const filters = normalizeFilters(interaction, config);
    const exportMax = Number(config.get?.("MODLOG_EXPORT_MAX", 2000));

    await interaction.deferReply({ ephemeral: true });

    try {
      // Fetch as many as allowed by export cap; override page size so we can serialize
      const res = await searchAuditLogs(ctx, interaction.guild, { ...filters, page: 1, pageSize: exportMax });
      const items = res.items;

      let buf;
      let filename;
      if (format === "csv") {
        const csv = toCSV(items);
        buf = Buffer.from(csv, "utf8");
        filename = `audit-export-${Date.now()}.csv`;
      } else {
        const jsonl = toJSONL(items);
        buf = Buffer.from(jsonl, "utf8");
        filename = `audit-export-${Date.now()}.jsonl`;
      }

      const attachment = new AttachmentBuilder(buf, { name: filename });

      return interaction.editReply({
        content: `Exported ${items.length} item(s) in ${format.toUpperCase()}.`,
        files: [attachment]
      });
    } catch (e) {
      logger.error("[ModLog] export error", { error: e?.stack || e?.message || String(e) });
      return interaction.editReply({ content: "Failed to export audit log search." });
    }
  };
}
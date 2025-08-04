import { checkAuditPermissions } from "../utils/permissions.js";
import { EmbedBuilder, codeBlock, time, TimestampStyles } from "discord.js";

/**
 * Inspect a single audit log entry by ID (snowflake).
 */
export function createInspectHandler(ctx) {
  const { logger } = ctx;

  return async function handleInspect(interaction) {
    const perms = checkAuditPermissions(interaction);
    if (!perms.ok) {
      return interaction.reply({ content: perms.message, ephemeral: true });
    }

    const id = interaction.options.getString("id", true);

    await interaction.deferReply({ ephemeral: true });

    try {
      // There is no direct fetch-by-id in discord.js v14 audit logs; fetch windows until found.
      // We do a bounded search scanning recent pages.
      const MAX_PAGES = 10;
      let before;
      let found = null;

      for (let i = 0; i < MAX_PAGES && !found; i++) {
        const logs = await interaction.guild.fetchAuditLogs({ limit: 100, ...(before ? { before } : {}) });
        if (!logs?.entries?.size) break;

        for (const entry of logs.entries.values()) {
          if (entry.id === id) { found = entry; break; }
        }

        // move cursor
        const ids = [...logs.entries.keys()];
        before = ids[ids.length - 1];

        if (logs.entries.size < 100) break;
      }

      if (!found) {
        return interaction.editReply({ content: `Audit log entry ${id} not found in recent logs.` });
      }

      const embed = formatInspectEmbed(found);
      return interaction.editReply({ embeds: [embed] });
    } catch (e) {
      logger.error("[ModLog] inspect error", { error: e?.stack || e?.message || String(e) });
      return interaction.editReply({ content: "Failed to inspect the audit log entry." });
    }
  };
}

function formatInspectEmbed(entry) {
  const eb = new EmbedBuilder()
    .setTitle(`Audit Entry • ${entry.action}`)
    .setColor(0x5865F2)
    .setTimestamp(entry.createdAt ?? new Date())
    .addFields(
      { name: "ID", value: `\`${entry.id}\``, inline: true },
      { name: "When", value: entry.createdAt ? time(entry.createdAt, TimestampStyles.RelativeTime) : "Unknown", inline: true },
      { name: "Executor", value: entry.executorId ? `\`${entry.executorId}\`` : "Unknown", inline: true },
      { name: "Target", value: entry.targetId ? `\`${entry.targetId}\`` : "Unknown", inline: true },
      { name: "Reason", value: entry.reason ? codeBlock(safe(entry.reason)) : "None", inline: false }
    );

  if (entry.changes?.length) {
    const lines = entry.changes.slice(0, 10).map(c => `- ${c.key}: ${formatVal(c.old)} → ${formatVal(c.new)}`);
    eb.addFields({ name: "Changes", value: lines.join("\n").slice(0, 1024) });
  }

  if (entry.extra) {
    eb.addFields({ name: "Extra", value: codeBlock(trim(JSON.stringify(entry.extra, null, 2), 1000)) });
  }

  return eb;
}

function formatVal(v) {
  if (v === null || typeof v === "undefined") return "—";
  if (typeof v === "string") return `"${trim(v, 64)}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return trim(JSON.stringify(v), 64);
}

function trim(s, n) {
  const str = String(s);
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

function safe(s) {
  return String(s).slice(0, 1900);
}
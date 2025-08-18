import { EmbedBuilder, time, TimestampStyles, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, codeBlock } from "discord.js";
import { EVENT_NAME_BY_CODE } from "./constants.js";

/**
 * Build embeds for a page of audit log entries plus pagination components.
 */
export function buildSearchEmbeds(ctx, interaction, items, meta, filters) {
  const { client } = ctx;
  const guild = interaction?.guild;
  const embeds = [];
  const description = [
    `Filters: ${summarizeFilters(ctx, guild, filters)}`,
    `Page ${meta.page}/${meta.totalPages} • ${meta.total} result(s)`
  ].join("\n");

  const embed = new EmbedBuilder()
    .setTitle("Audit Log Search")
    .setDescription(description)
    .setColor(0x5865F2)
    .setTimestamp(new Date());

  for (const entry of items) {
  const name = formatEntryTitle(entry);
  const value = formatEntryBody(entry, client, guild);
    embed.addFields({ name, value });
  }

  embeds.push(embed);

  const components = buildPaginationComponents(meta, filters, items, client, guild);

  return { embeds, components };
}

function formatActionReadable(entry) {
  // Prefer human-readable alias (e.g., "member_ban_add", "channel_create")
  const code = entry?.action;
  const alias = typeof code === "number" ? EVENT_NAME_BY_CODE.get(code) : null;
  const kind = entry?.actionType; // e.g., "Create" | "Delete" | "Update"
  if (alias) {
    return kind ? `${alias} (${kind})` : alias;
  }
  // Fallback to numeric if unmapped
  return kind ? `type:${code} (${kind})` : `type:${code}`;
}

function formatEntryTitle(entry) {
  const when = entry.createdAt
    ? `${time(entry.createdAt, TimestampStyles.RelativeTime)}`
    : "";
  const action = formatActionReadable(entry);
  return `${action} • ${when}`;
}

function formatEntryBody(entry, client, guild) {
  const exec = entry.executorId ? userRef(client, guild, entry.executorId) : "Unknown";
  const target = entry.targetId ? ` → ${resolveTargetRef(guild, client, entry.targetId, entry)}` : "";
  const reason = entry.reason ? `\nReason: ${sanitize(entry.reason)}` : "";
  const id = `ID: ${entry.id}`;
  return `${exec}${target}\n${id}${reason}`;
}

function userRef(client, guild, id) {
  // Prefer guild member display (if available), then user cache
  try {
    const m = guild?.members?.cache?.get?.(id);
    if (m && m.user) return `${m.user.tag} (${m.id})`;
  } catch (err) { void err; }
  const u = client.users?.cache?.get?.(id);
  return u ? `${u.tag} (${id})` : idRef(id);
}

function resolveTargetRef(guild, client, id, entry) {
  // Try member, channel, role, emoji in that order. Fall back to old/new name from audit entry, then id.
  try {
    const m = guild?.members?.cache?.get?.(id);
    if (m && m.user) return `${m.user.tag} (${m.id})`;
  } catch (err) { void err; }
  try {
    const ch = guild?.channels?.cache?.get?.(id);
    if (ch) return `#${ch.name} (${id})`;
  } catch (err) { void err; }
  try {
    const r = guild?.roles?.cache?.get?.(id);
    if (r) return `@${r.name} (${id})`;
  } catch (err) { void err; }
  try {
    const e = client?.emojis?.cache?.get?.(id);
    if (e) return `${e.name} (:${e.identifier}:) (${id})`;
  } catch (err) { void err; }

  // Try to extract a name from audit entry changes (useful for deleted channels/roles)
  try {
    const changes = entry?.changes;
    if (changes) {
      // changes may be a Collection or an Array
      const arr = typeof changes.find === "function" ? [...changes.values?.() || changes] : changes;
      const nameChange = arr.find?.(c => c?.key === "name") || arr.find?.(c => c?.key === "channel") || arr.find?.(Boolean);
      if (nameChange) {
        const nm = nameChange.old ?? nameChange.previous ?? nameChange.new ?? nameChange.newValue ?? nameChange.oldValue ?? null;
        if (nm) return `${nm} (${id})`;
      }
    }
  } catch (err) { void err; }

  return idRef(id);
}

function idRef(id) {
  return `\`${id}\``;
}

function sanitize(s) {
  return String(s).slice(0, 1024);
}

export function buildPaginationComponents(meta, filters, items = [], _client, _guild) {
  // Build distinct IDs to avoid duplicate custom_id collisions on Discord
  const prevState = { ...filters, page: Math.max(1, meta.page - 1) };
  const nextState = { ...filters, page: Math.min(meta.totalPages, meta.page + 1) };

  const prevId = withRole(encodeState(prevState), "prev");
  const nextId = withRole(encodeState(nextState), "next");

  const prev = new ButtonBuilder()
    .setCustomId(prevId)
    .setStyle(ButtonStyle.Secondary)
    .setLabel("Prev")
    .setDisabled(meta.page <= 1);

  const next = new ButtonBuilder()
    .setCustomId(nextId)
    .setStyle(ButtonStyle.Secondary)
    .setLabel("Next")
    .setDisabled(meta.page >= meta.totalPages);

  const row = new ActionRowBuilder().addComponents(prev, next);

  // Build select menu for details (one option per visible entry)
  const select = new StringSelectMenuBuilder()
    .setCustomId(withRole(encodeState(filters), "select"))
    .setPlaceholder("Select an entry for details")
    .setMinValues(1)
    .setMaxValues(1);

  const options = items.slice(0, 25).map((e) => {
    const label = formatActionReadable(e).slice(0, 100);
    const desc = e.reason ? truncate(e.reason, 50) : (e.targetId || e.executorId || `ID:${e.id}`);
    return new StringSelectMenuOptionBuilder()
      .setLabel(label)
      .setDescription(String(desc).slice(0, 100))
      .setValue(String(e.id));
  });

  if (options.length) {
    select.addOptions(options);
    const selRow = new ActionRowBuilder().addComponents(select);
    return [row, selRow];
  }

  return [row];
}

export function buildDetailEmbed(ctx, interaction, entry) {
  const guild = interaction?.guild;
  const client = ctx.client;
  const embed = new EmbedBuilder()
    .setTitle(`Audit Log Entry: ${entry.id}`)
    .setColor(0x5865F2)
    .setTimestamp(entry.createdAt || new Date());

  const fields = [];
  fields.push({ name: "Action", value: formatActionReadable(entry), inline: true });
  fields.push({ name: "When", value: time(entry.createdAt || new Date(), TimestampStyles.RelativeTime), inline: true });
  fields.push({ name: "Executor", value: entry.executorId ? userRef(client, guild, entry.executorId) : "Unknown", inline: true });
  if (entry.targetId) fields.push({ name: "Target", value: resolveTargetRef(guild, client, entry.targetId, entry), inline: true });
  if (entry.reason) fields.push({ name: "Reason", value: sanitize(entry.reason) });

  // Show change details if present
  if (entry.changes && (entry.changes.size || entry.changes.length)) {
    // Normalize to an array of change objects
    let changesArr;
    if (typeof entry.changes.map === 'function') {
      changesArr = entry.changes.map?.(c => c) || [...entry.changes.values?.() || []];
    } else if (Array.isArray(entry.changes)) {
      changesArr = entry.changes;
    } else if (entry.changes.values) {
      changesArr = [...entry.changes.values()];
    } else {
      changesArr = [entry.changes];
    }

    const rendered = [];
    for (const c of changesArr) {
      const key = c?.key ?? c?.keyName ?? '(unknown)';
      const oldV = c?.old ?? c?.previous ?? c?.oldValue ?? null;
      const newV = c?.new ?? c?.newValue ?? null;

      const formatInline = (v) => {
        if (v == null || v === "") return '`(empty)`';
        if (typeof v === 'object') {
          try { return codeBlock('json', JSON.stringify(v, null, 2)); } catch { return codeBlock('text', String(v)); }
        }
        return `\`${String(v)}\``;
      };

      if (typeof oldV === 'object' || typeof newV === 'object') {
        // Render complex values as JSON blocks
        const oldText = oldV ? JSON.stringify(oldV, null, 2) : '';
        const newText = newV ? JSON.stringify(newV, null, 2) : '';
        const chunk = `**${key}**:\nOld:\n${codeBlock('json', oldText || '(empty)')}\nNew:\n${codeBlock('json', newText || '(empty)')}`;
        rendered.push(chunk);
      } else {
        rendered.push(`**${key}**: ${formatInline(oldV)} → ${formatInline(newV)}`);
      }
    }

    // Join and ensure embed field size limits (1024 chars per field). Split into multiple 'Changes (x/n)' fields if needed.
    const all = rendered.join('\n');
    const maxLen = 1024;
    if (all.length <= maxLen) {
      fields.push({ name: 'Changes', value: all || '(no details)' });
    } else {
      // Split by lines to preserve readability
      const lines = all.split('\n');
      let part = '';
      let _partIndex = 1;
      const parts = [];
      for (const line of lines) {
        if ((part + '\n' + line).length > maxLen) {
          parts.push(part);
          part = line;
        } else {
          part = part ? part + '\n' + line : line;
        }
      }
      if (part) parts.push(part);

      for (let i = 0; i < parts.length; i++) {
        const name = parts.length > 1 ? `Changes (${i + 1}/${parts.length})` : 'Changes';
        fields.push({ name, value: parts[i] });
      }
    }
  }

  embed.addFields(...fields.slice(0, 25));
  return embed;
}

function withRole(baseId, role) {
  // Ensure final id is <= 100, keep prefix "modlog:page:"
  const suffix = `:${role}`;
  if (baseId.length + suffix.length <= 100) return baseId + suffix;
  return baseId.slice(0, 100 - suffix.length) + suffix;
}

export function encodeState(filters) {
  // Keep it compact, fit within 100 custom id length constraints
  const obj = {
    e: filters.type ?? "all",
    ex: filters.executorId || "",
    ta: filters.targetId || "",
    ch: filters.channelId || "",
    ro: filters.roleId || "",
    em: filters.emojiId || "",
    wh: filters.webhookId || "",
    in: filters.integrationId || "",
    si: filters.since ? new Date(filters.since).getTime() : "",
    un: filters.until ? new Date(filters.until).getTime() : "",
    re: filters.reasonContains || "",
    pg: filters.page || 1,
    ps: filters.pageSize || 10
  };
  const compact = Object.entries(obj).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  return `modlog:page:${compact}`.slice(0, 100); // ensure length safety
}

export function decodeState(customId) {
  const prefix = "modlog:page:";
  if (!customId.startsWith(prefix)) return null;
  const qs = customId.slice(prefix.length);
  const out = {};
  for (const part of qs.split("&")) {
    const [k, v] = part.split("=");
    out[k] = decodeURIComponent(v || "");
  }

  const sinceMs = out.si ? Number(out.si) : 0;
  const untilMs = out.un ? Number(out.un) : 0;

  return {
    type: out.e === "all" ? null : out.e,
    executorId: out.ex || null,
    targetId: out.ta || null,
    channelId: out.ch || null,
    roleId: out.ro || null,
    emojiId: out.em || null,
    webhookId: out.wh || null,
    integrationId: out.in || null,
    since: sinceMs ? new Date(sinceMs) : null,
    until: untilMs ? new Date(untilMs) : null,
    reasonContains: out.re || null,
    page: clampNum(Number(out.pg) || 1, 1, 1000),
    pageSize: clampNum(Number(out.ps) || 10, 1, 25)
  };
}

function clampNum(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function summarizeFilters(ctx, guild, f) {
  const parts = [];
  parts.push(`event=${f.type ?? "all"}`);
  if (f.executorId) parts.push(`executor=${resolveSimpleRef(guild, ctx.client, f.executorId)}`);
  if (f.targetId) parts.push(`target=${resolveSimpleRef(guild, ctx.client, f.targetId)}`);
  if (f.channelId) parts.push(`channel=${resolveChannelRef(guild, f.channelId)}`);
  if (f.roleId) parts.push(`role=${resolveRoleRef(guild, f.roleId)}`);
  if (f.emojiId) parts.push(`emoji=${resolveEmojiRef(ctx.client, f.emojiId)}`);
  if (f.webhookId) parts.push(`webhook=${f.webhookId}`);
  if (f.integrationId) parts.push(`integration=${f.integrationId}`);
  if (f.since) parts.push(`since=${new Date(f.since).toISOString()}`);
  if (f.until) parts.push(`until=${new Date(f.until).toISOString()}`);
  if (f.reasonContains) parts.push(`reason~=${truncate(f.reasonContains, 24)}`);
  return parts.join(" • ");
}

function resolveSimpleRef(guild, client, id) {
  try {
    const m = guild?.members?.cache?.get?.(id);
    if (m && m.user) return `${m.user.tag}`;
  } catch (err) { void err; }
  try {
    const u = client?.users?.cache?.get?.(id);
    if (u) return `${u.tag}`;
  } catch (err) { void err; }
  return id;
}

function resolveChannelRef(guild, id) {
  try {
    const ch = guild?.channels?.cache?.get?.(id);
    if (ch) return `#${ch.name}`;
  } catch (err) { void err; }
  return id;
}

function resolveRoleRef(guild, id) {
  try {
    const r = guild?.roles?.cache?.get?.(id);
    if (r) return `@${r.name}`;
  } catch (err) { void err; }
  return id;
}

function resolveEmojiRef(client, id) {
  try {
    const e = client?.emojis?.cache?.get?.(id);
    if (e) return `${e.name}`;
  } catch (err) { void err; }
  return id;
}

function truncate(s, n) {
  const str = String(s);
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

/**
 * Serialize for export
 */
export function toCSV(items) {
  const headers = ["id","action","executorId","targetId","createdAt","reason"];
  const rows = [headers.join(",")];
  for (const e of items) {
    const line = [
      safe(e.id),
      safe(e.action),
      safe(e.executorId),
      safe(e.targetId),
      safe(e.createdAt?.toISOString?.() || ""),
      safe(e.reason || "")
    ].join(",");
    rows.push(line);
  }
  return rows.join("\n");
}

export function toJSONL(items) {
  return items.map(e => JSON.stringify({
    id: e.id,
    action: e.action,
    executorId: e.executorId,
    targetId: e.targetId,
    createdAt: e.createdAt?.toISOString?.() || null,
    reason: e.reason || null
  })).join("\n");
}

function safe(v) {
  const s = String(v ?? "");
  // Basic CSV escaping: wrap and escape quotes
  if (/[,"\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
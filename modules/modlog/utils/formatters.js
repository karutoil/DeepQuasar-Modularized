import { EmbedBuilder, time, TimestampStyles, ButtonBuilder, ButtonStyle, ActionRowBuilder, codeBlock } from "discord.js";
import { EVENT_NAME_BY_CODE } from "./constants.js";

/**
 * Build embeds for a page of audit log entries plus pagination components.
 */
export function buildSearchEmbeds(ctx, interaction, items, meta, filters) {
  const { client } = ctx;
  const embeds = [];
  const description = [
    `Filters: ${summarizeFilters(filters)}`,
    `Page ${meta.page}/${meta.totalPages} • ${meta.total} result(s)`
  ].join("\n");

  const embed = new EmbedBuilder()
    .setTitle("Audit Log Search")
    .setDescription(description)
    .setColor(0x5865F2)
    .setTimestamp(new Date());

  for (const entry of items) {
    const name = formatEntryTitle(entry);
    const value = formatEntryBody(entry, client);
    embed.addFields({ name, value });
  }

  embeds.push(embed);

  const components = buildPaginationComponents(meta, filters);

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

function formatEntryBody(entry, client) {
  const exec = entry.executorId ? userRef(client, entry.executorId) : "Unknown";
  const target = entry.targetId ? ` → ${idRef(entry.targetId)}` : "";
  const reason = entry.reason ? `\nReason: ${sanitize(entry.reason)}` : "";
  const id = `ID: ${entry.id}`;
  return `${exec}${target}\n${id}${reason}`;
}

function userRef(client, id) {
  const u = client.users?.cache?.get?.(id);
  return u ? `${u.tag} (${id})` : idRef(id);
}

function idRef(id) {
  return `\`${id}\``;
}

function sanitize(s) {
  return String(s).slice(0, 1024);
}

export function buildPaginationComponents(meta, filters) {
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
  return [row];
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

function summarizeFilters(f) {
  const parts = [];
  parts.push(`event=${f.type ?? "all"}`);
  if (f.executorId) parts.push(`executor=${f.executorId}`);
  if (f.targetId) parts.push(`target=${f.targetId}`);
  if (f.channelId) parts.push(`channel=${f.channelId}`);
  if (f.roleId) parts.push(`role=${f.roleId}`);
  if (f.emojiId) parts.push(`emoji=${f.emojiId}`);
  if (f.webhookId) parts.push(`webhook=${f.webhookId}`);
  if (f.integrationId) parts.push(`integration=${f.integrationId}`);
  if (f.since) parts.push(`since=${new Date(f.since).toISOString()}`);
  if (f.until) parts.push(`until=${new Date(f.until).toISOString()}`);
  if (f.reasonContains) parts.push(`reason~=${truncate(f.reasonContains, 24)}`);
  return parts.join(" • ");
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
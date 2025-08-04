import { resolveEventAlias } from "./constants.js";

/**
 * Parse relative time expressions like "7d", "4h", "30m", "15s"
 */
export function parseRelativeTime(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  if (s === "now") return new Date();
  const m = s.match(/^(\d+)\s*(d|h|m|s)$/);
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  const val = Number(m[1]);
  const unit = m[2];
  let ms = 0;
  switch (unit) {
    case "d": ms = val * 24 * 60 * 60 * 1000; break;
    case "h": ms = val * 60 * 60 * 1000; break;
    case "m": ms = val * 60 * 1000; break;
    case "s": ms = val * 1000; break;
    default: return null;
  }
  return new Date(Date.now() - ms);
}

/**
 * Normalize slash command options into a filter DTO
 */
export function normalizeFilters(interaction, config) {
  const guild = interaction.guild;
  const eventOpt = interaction.options.getString("event");
  const { type } = resolveEventAlias(eventOpt);
  const executor = interaction.options.getUser("executor") || null;
  const target = interaction.options.getUser("target") || null;
  const channel = interaction.options.getChannel("channel") || null;
  const role = interaction.options.getRole("role") || null;
  const emoji = interaction.options.getString("emoji") || null;
  const webhook = interaction.options.getString("webhook") || null;
  const integration = interaction.options.getString("integration") || null;

  const sinceRaw = interaction.options.getString("since");
  const untilRaw = interaction.options.getString("until");
  const since = sinceRaw ? (parseRelativeTime(sinceRaw) || new Date(sinceRaw)) : null;
  const until = untilRaw ? (parseRelativeTime(untilRaw) || new Date(untilRaw)) : null;

  const reason = interaction.options.getString("reason") || null;

  const defaultPageSize = Number(config.get("MODLOG_DEFAULT_PAGE_SIZE", 10));
  const pageSizeReq = interaction.options.getInteger("page_size");
  const pageReq = interaction.options.getInteger("page");
  const pageSize = clamp(Math.floor(pageSizeReq || defaultPageSize), 1, 25);
  const page = clamp(Math.floor(pageReq || 1), 1, 1000);

  return {
    guildId: guild.id,
    type, // null means all
    executorId: executor?.id || null,
    targetId: target?.id || null,
    channelId: channel?.id || null,
    roleId: role?.id || null,
    emojiId: emoji || null,
    webhookId: webhook || null,
    integrationId: integration || null,
    since: since && !isNaN(since.getTime()) ? since : null,
    until: until && !isNaN(until.getTime()) ? until : null,
    reasonContains: reason,
    page,
    pageSize
  };
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function matchesTimeRange(entry, since, until) {
  const ts = entry?.createdTimestamp || entry?.createdAt?.getTime?.() || 0;
  if (since && ts < since.getTime()) return false;
  if (until && ts > until.getTime()) return false;
  return true;
}

export function matchesReason(entry, reasonContains) {
  if (!reasonContains) return true;
  const reason = entry?.reason || "";
  return reason.toLowerCase().includes(String(reasonContains).toLowerCase());
}

export function matchesUsers(entry, executorId, targetId) {
  if (executorId && entry.executorId !== executorId) return false;
  if (targetId && entry.targetId !== targetId) return false;
  return true;
}

/**
 * Match additional object references based on target or extra data fields
 */
export function matchesObjects(entry, { channelId, roleId, emojiId, webhookId, integrationId }) {
  // Check target ids when available
  const target = entry.target;
  const data = entry.changes?.[0]?.new || entry.extra || {};
  const targetIds = new Set();

  if (target?.id) targetIds.add(target.id);
  if (data?.id) targetIds.add(data.id);
  if (entry?.webhookId) targetIds.add(entry.webhookId);

  if (channelId && !hasId(target, "channel", channelId) && !idInSet(targetIds, channelId)) return false;
  if (roleId && !hasId(target, "role", roleId) && !idInSet(targetIds, roleId)) return false;
  if (emojiId && !hasId(target, "emoji", emojiId) && !idInSet(targetIds, emojiId)) return false;
  if (webhookId && (entry.webhookId !== webhookId) && !idInSet(targetIds, webhookId)) return false;
  if (integrationId && !idInSet(targetIds, integrationId)) return false;
  return true;
}

function hasId(target, kind, id) {
  if (!target) return false;
  if (target.id === id) return true;
  // Some targets have specific shapes: channel, role, emoji
  if (kind === "channel" && target.type !== undefined) return target.id === id;
  if (kind === "role" && target.permissions !== undefined) return target.id === id;
  if (kind === "emoji" && target.name !== undefined) return target.id === id;
  return false;
}

function idInSet(set, id) {
  return set && set.has ? set.has(id) : false;
}
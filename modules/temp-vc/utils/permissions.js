/**
 * Permission utilities for TempVC:
 * - Compute overwrites for lock/unlock and user limit reconciliation
 * - Merge role-based templates onto defaults with state-aware adjustments
 *
 * Note: Discord.js v14 overwrite format expects arrays of allowed/denied bitfields per overwrite.
 */
import { PermissionFlagsBits, OverwriteType } from "discord.js";

function bool(v) { return !!v; }

export function buildBaseOverwrites({ guild, ownerId, template }) {
  const overwrites = [];

  // Owner overwrite
  if (ownerId) {
    const allow = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak,
    ];
    if (bool(template?.owner?.ManageChannels)) allow.push(PermissionFlagsBits.ManageChannels);
    if (bool(template?.owner?.MoveMembers)) allow.push(PermissionFlagsBits.MoveMembers);
    if (bool(template?.owner?.MuteMembers)) allow.push(PermissionFlagsBits.MuteMembers);
    if (bool(template?.owner?.DeafenMembers)) allow.push(PermissionFlagsBits.DeafenMembers);
    if (bool(template?.owner?.PrioritySpeaker)) allow.push(PermissionFlagsBits.PrioritySpeaker);
    if (bool(template?.owner?.Stream)) allow.push(PermissionFlagsBits.Stream);

    overwrites.push({
      id: ownerId,
      type: OverwriteType.Member,
      allow,
      deny: [],
    });
  }

  // Everyone overwrite
  {
    const everyoneId = guild.roles.everyone.id;
    const allow = [];
    const deny = [];
    if (bool(template?.everyone?.ViewChannel)) allow.push(PermissionFlagsBits.ViewChannel);
    if (bool(template?.everyone?.Connect)) allow.push(PermissionFlagsBits.Connect);
    if (bool(template?.everyone?.Speak)) allow.push(PermissionFlagsBits.Speak);
    if (bool(template?.everyone?.Stream)) allow.push(PermissionFlagsBits.Stream);

    overwrites.push({
      id: everyoneId,
      type: OverwriteType.Role,
      allow,
      deny,
    });
  }

  // Bot overwrite
  {
    const botId = guild.members.me?.id || guild.client.user.id;
    const allow = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak,
      PermissionFlagsBits.Stream,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.MoveMembers,
      PermissionFlagsBits.MuteMembers,
      PermissionFlagsBits.DeafenMembers,
    ];
    overwrites.push({
      id: botId,
      type: OverwriteType.Member,
      allow,
      deny: [],
    });
  }

  return overwrites;
}

/**
 * Apply lock state by denying Connect to @everyone while preserving owner/bot access.
 * If default is already closed-by-default, this is a no-op.
 */
export function applyLockToOverwrites({ guild, overwrites }) {
  const everyoneId = guild.roles.everyone.id;
  const next = overwrites.map((ow) => ({ ...ow, allow: [...(ow.allow || [])], deny: [...(ow.deny || [])] }));
  const idx = next.findIndex((ow) => ow.id === everyoneId && ow.type === OverwriteType.Role);
  if (idx >= 0) {
    // Remove Connect from allow if present; optionally could add to deny[] if you want stricter locks
    const allow = new Set(next[idx].allow);
    allow.delete(PermissionFlagsBits.Connect);
    next[idx].allow = Array.from(allow);
  }
  return next;
}

/**
 * Merge role-based templates into base overwrites. Role templates are additive allows/denies.
 * Shape: roleTemplates: [{ roleId, overwrites: { Connect, Speak, Stream, ... } }]
 */
export function mergeRoleTemplates({ overwrites, roleTemplates = [] }) {
  if (!Array.isArray(roleTemplates) || roleTemplates.length === 0) return overwrites;
  const next = overwrites.map((ow) => ({ ...ow, allow: new Set(ow.allow || []), deny: new Set(ow.deny || []) }));

  for (const tpl of roleTemplates) {
    const allow = [];
    const deny = [];
    const map = tpl?.overwrites || {};
    for (const [k, v] of Object.entries(map)) {
      const bit = PermissionFlagsBits[k];
      if (!bit) continue;
      if (v === true) allow.push(bit);
      if (v === false) deny.push(bit);
    }
    next.push({
      id: tpl.roleId,
      type: OverwriteType.Role,
      allow: new Set(allow),
      deny: new Set(deny),
    });
  }

  // Convert Sets back to arrays and coalesce duplicates of same id/type (keep last)
  const keyed = new Map();
  for (const ow of next) {
    const key = `${ow.type}:${ow.id}`;
    keyed.set(key, ow);
  }
  const merged = Array.from(keyed.values()).map((ow) => ({
    id: ow.id,
    type: ow.type,
    allow: Array.isArray(ow.allow) ? ow.allow : Array.from(ow.allow || []),
    deny: Array.isArray(ow.deny) ? ow.deny : Array.from(ow.deny || []),
  }));
  return merged;
}

/**
 * Compute final overwrites considering template, role templates and lock state.
 */
export function computeFinalOverwrites({ guild, ownerId, template, roleTemplates, locked }) {
  let ows = buildBaseOverwrites({ guild, ownerId, template });
  ows = mergeRoleTemplates({ overwrites: ows, roleTemplates });
  if (locked) ows = applyLockToOverwrites({ guild, overwrites: ows });
  return ows;
}
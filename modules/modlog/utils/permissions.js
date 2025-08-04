import { PermissionsBitField } from "discord.js";
import { REQUIRED_PERMISSIONS } from "./constants.js";

/**
 * Ensures both the invoking member and the bot have ViewAuditLog
 * Returns { ok: boolean, message?: string }
 */
export function checkAuditPermissions(interaction) {
  const guild = interaction.guild;
  const member = interaction.member;
  const me = guild.members?.me;

  const need = REQUIRED_PERMISSIONS.viewAuditLog;

  const memberOk = new PermissionsBitField(member.permissions).has(need, true);
  if (!memberOk) {
    return { ok: false, message: "You need the 'View Audit Log' permission to use this command." };
  }

  const botOk = me?.permissions?.has?.(need, true);
  if (!botOk) {
    return { ok: false, message: "I need the 'View Audit Log' permission to perform this action." };
  }

  return { ok: true };
}
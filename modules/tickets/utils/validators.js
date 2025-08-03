/**
 * Validators and guards for Tickets module
 * - Permission checks
 * - Basic input validations
 * - Safe reply helper
 */

export function requireManageGuild(interaction) {
  if (!interaction?.memberPermissions?.has?.("ManageGuild")) {
    const err = new Error("PERM:MANAGE_GUILD");
    err.code = "PERM:MANAGE_GUILD";
    throw err;
  }
}

export function assertInGuild(interaction) {
  if (!interaction?.inGuild?.()) {
    const err = new Error("CTX:NOT_IN_GUILD");
    err.code = "CTX:NOT_IN_GUILD";
    throw err;
  }
}

export function ensureStringId(id, label = "id") {
  if (!id || typeof id !== "string") {
    const err = new Error(`INVALID:${label}`);
    err.code = `INVALID:${label}`;
    throw err;
  }
  return id;
}

/**
 * Wrapper to avoid "Unknown interaction" by choosing reply or followUp automatically.
 * Use for ephemeral admin responses.
 */
export function safeReply(interaction, payload) {
  return (interaction.replied || interaction.deferred)
    ? interaction.followUp(payload)
    : interaction.reply(payload);
}
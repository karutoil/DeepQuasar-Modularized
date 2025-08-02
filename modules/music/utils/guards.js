// Guard and reply helpers for music commands
// Centralizes common validation and reply/edit behavior, and DJ role checks.

import { PermissionFlagsBits } from "discord.js";

/**
 * Reply or edit depending on interaction state.
 * Ensures ephemeral defaults to true unless explicitly overridden.
 */
export async function replyOrEdit(interaction, payload, { ephemeral = true } = {}) {
  const data = { ...payload };
  if (typeof data.ephemeral === "undefined") data.ephemeral = ephemeral;
  if (interaction.deferred && !interaction.replied) {
    return interaction.editReply(data);
  }
  if (!interaction.replied) {
    return interaction.reply(data);
  }
  return interaction.followUp(data);
}

/**
 * Ensure the user is connected to a voice channel.
 * Returns { ok, voiceChannelId } and replies with an error if not ok.
 */
export async function ensureInVoice(ctx, interaction, { ephemeral = true } = {}) {
  try {
    const { embed } = ctx;
    const guild = interaction.guild;
    const userId = interaction.user?.id;
    let member = interaction.member;

    if ((!member || !member.voice) && guild && userId) {
      try { member = await guild.members.fetch(userId); } catch {}
    }
    const voiceChannelId = member?.voice?.channelId;
    if (!voiceChannelId) {
      await replyOrEdit(interaction, { embeds: [embed.error({ title: "You must be in a voice channel to use this command." })] }, { ephemeral });
      return { ok: false, voiceChannelId: null };
    }
    return { ok: true, voiceChannelId: String(voiceChannelId) };
  } catch (e) {
    try {
      await replyOrEdit(interaction, { content: "Voice check failed.", ephemeral: true });
    } catch {}
    return { ok: false, voiceChannelId: null };
  }
}

/**
 * Ensure Moonlink manager has at least one connected node.
 * Uses moonlink.waitForReady if available.
 */
export async function ensurePlayerReady(ctx, moonlink, interaction, { timeoutMs = 15000, ephemeral = true } = {}) {
  const { embed, logger } = ctx;
  try {
    const connected = Array.isArray(moonlink?.nodes) ? moonlink.nodes.filter(n => n?.connected).length : 0;
    let ready = connected > 0;
    if (!ready && typeof moonlink?.waitForReady === "function") {
      ready = await moonlink.waitForReady(timeoutMs);
    }
    if (!ready) {
      await replyOrEdit(interaction, {
        embeds: [embed.error({ title: "Audio backend not ready", description: "The music service is starting. Try again shortly." })]
      }, { ephemeral });
      return false;
    }
    return true;
  } catch (e) {
    logger?.warn?.("[Music] ensurePlayerReady error", { error: e?.message });
    try {
      await replyOrEdit(interaction, { embeds: [embed.error({ title: "Music service unavailable." })] }, { ephemeral });
    } catch {}
    return false;
  }
}

/**
 * Ensure the invoker is a DJ or the requester or has ManageGuild to perform sensitive actions.
 * If a DJ role is configured in MusicSettings, require it unless the user has ManageGuild.
 */
export async function ensureDjOrSelf(ctx, interaction, musicSettings, { requesterId = null, ephemeral = true } = {}) {
  const { embed } = ctx;
  try {
    const guildId = interaction.guildId;
    const member = interaction.member;
    const meIsManager = interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild) ||
      member?.permissions?.has?.(PermissionFlagsBits.ManageGuild);

    if (meIsManager) return true;

    const settings = await musicSettings.get(guildId);
    const djRoleId = settings.djRoleId;

    // If requesterId matches invoker, allow
    if (requesterId && requesterId === interaction.user?.id) return true;

    if (djRoleId) {
      const roles = member?.roles?.valueOf?.() || member?.roles;
      const hasRole = roles?.cache?.has?.(djRoleId) || Array.isArray(roles) && roles.includes(djRoleId);
      if (hasRole) return true;

      await replyOrEdit(interaction, {
        embeds: [embed.warn({
          title: "DJ role required",
          description: "You need the configured DJ role or Manage Server permission to perform this action."
        })]
      }, { ephemeral });
      return false;
    }

    // If no DJ role configured, permit by default unless requester-specific enforcement is desired.
    return true;
  } catch {
    // On failure, be permissive to avoid false negatives blocking usage
    return true;
  }
}
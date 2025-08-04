import { AuditLogEvent, PermissionFlagsBits } from "discord.js";

// Map human-friendly aliases to AuditLogEvent enums. Include "all" passthrough.
export const EVENT_ALIASES = (() => {
  const map = new Map();

  // Core user/guild actions
  map.set("all", null);
  map.set("member_kick", AuditLogEvent.MemberKick);
  map.set("kick", AuditLogEvent.MemberKick);
  map.set("member_prune", AuditLogEvent.MemberPrune);
  map.set("prune", AuditLogEvent.MemberPrune);
  map.set("member_ban_add", AuditLogEvent.MemberBanAdd);
  map.set("ban", AuditLogEvent.MemberBanAdd);
  map.set("member_ban_remove", AuditLogEvent.MemberBanRemove);
  map.set("unban", AuditLogEvent.MemberBanRemove);
  map.set("member_update", AuditLogEvent.MemberUpdate);
  map.set("member_role_update", AuditLogEvent.MemberRoleUpdate);
  map.set("member_move", AuditLogEvent.MemberMove);
  map.set("member_disconnect", AuditLogEvent.MemberDisconnect);
  map.set("bot_add", AuditLogEvent.BotAdd);

  // Channel
  map.set("channel_create", AuditLogEvent.ChannelCreate);
  map.set("channel_delete", AuditLogEvent.ChannelDelete);
  map.set("channel_update", AuditLogEvent.ChannelUpdate);
  map.set("overwrite_create", AuditLogEvent.ChannelOverwriteCreate);
  map.set("overwrite_update", AuditLogEvent.ChannelOverwriteUpdate);
  map.set("overwrite_delete", AuditLogEvent.ChannelOverwriteDelete);
  map.set("thread_create", AuditLogEvent.ThreadCreate);
  map.set("thread_delete", AuditLogEvent.ThreadDelete);
  map.set("thread_update", AuditLogEvent.ThreadUpdate);

  // Role
  map.set("role_create", AuditLogEvent.RoleCreate);
  map.set("role_delete", AuditLogEvent.RoleDelete);
  map.set("role_update", AuditLogEvent.RoleUpdate);

  // Invite
  map.set("invite_create", AuditLogEvent.InviteCreate);
  map.set("invite_delete", AuditLogEvent.InviteDelete);
  map.set("invite_update", AuditLogEvent.InviteUpdate);

  // Webhook
  map.set("webhook_create", AuditLogEvent.WebhookCreate);
  map.set("webhook_delete", AuditLogEvent.WebhookDelete);
  map.set("webhook_update", AuditLogEvent.WebhookUpdate);

  // Emoji/Sticker
  map.set("emoji_create", AuditLogEvent.EmojiCreate);
  map.set("emoji_delete", AuditLogEvent.EmojiDelete);
  map.set("emoji_update", AuditLogEvent.EmojiUpdate);
  map.set("sticker_create", AuditLogEvent.StickerCreate);
  map.set("sticker_delete", AuditLogEvent.StickerDelete);
  map.set("sticker_update", AuditLogEvent.StickerUpdate);

  // Integration
  map.set("integration_create", AuditLogEvent.IntegrationCreate);
  map.set("integration_delete", AuditLogEvent.IntegrationDelete);
  map.set("integration_update", AuditLogEvent.IntegrationUpdate);
  map.set("stage_instance_create", AuditLogEvent.StageInstanceCreate);
  map.set("stage_instance_delete", AuditLogEvent.StageInstanceDelete);
  map.set("stage_instance_update", AuditLogEvent.StageInstanceUpdate);

  // Guild
  map.set("guild_update", AuditLogEvent.GuildUpdate);

  // AutoMod (v14)
  map.set("automod_rule_create", AuditLogEvent.AutoModerationRuleCreate);
  map.set("automod_rule_delete", AuditLogEvent.AutoModerationRuleDelete);
  map.set("automod_rule_update", AuditLogEvent.AutoModerationRuleUpdate);
  map.set("automod_block_message", AuditLogEvent.AutoModerationBlockMessage);
  map.set("automod_flag_message", AuditLogEvent.AutoModerationFlagToChannel);
  map.set("automod_timeout", AuditLogEvent.AutoModerationUserCommunicationDisabled);

  // Message
  map.set("message_delete", AuditLogEvent.MessageDelete);
  map.set("message_bulk_delete", AuditLogEvent.MessageBulkDelete);
  map.set("message_pin", AuditLogEvent.MessagePin);
  map.set("message_unpin", AuditLogEvent.MessageUnpin);

  // Scheduled events
  map.set("guild_scheduled_event_create", AuditLogEvent.GuildScheduledEventCreate);
  map.set("guild_scheduled_event_delete", AuditLogEvent.GuildScheduledEventDelete);
  map.set("guild_scheduled_event_update", AuditLogEvent.GuildScheduledEventUpdate);

  // App command
  map.set("app_command_permission_update", AuditLogEvent.ApplicationCommandPermissionUpdate);

  return map;
})();

/**
 * Reverse map numeric AuditLogEvent -> human-readable name (e.g., "member_ban_add")
 */
export const EVENT_NAME_BY_CODE = (() => {
  const out = new Map();
  for (const [alias, code] of EVENT_ALIASES.entries()) {
    if (code == null) continue;
    if (!out.has(code)) out.set(code, alias);
  }
  // Provide some friendly fallbacks where aliases differ from d.js enum names
  // (Already covered by aliases; this ensures a value for every known code)
  return out;
})();

export function resolveEventAlias(input) {
  if (!input) return { type: null, alias: "all" };
  const key = String(input).toLowerCase().replace(/\s+/g, "_");
  if (EVENT_ALIASES.has(key)) {
    return { type: EVENT_ALIASES.get(key), alias: key };
  }
  // Try matching exact enum key if provided
  const enumKey = AuditLogEvent[input] !== undefined ? input : null;
  if (enumKey) return { type: AuditLogEvent[input], alias: input.toLowerCase() };
  return { type: null, alias: "all" };
}

export function suggestAuditEvent(query) {
  const q = String(query || "").toLowerCase();
  const out = [];
  for (const [alias] of EVENT_ALIASES) {
    if (!q || alias.includes(q)) {
      out.push({ name: alias, value: alias });
    }
    if (out.length >= 50) break;
  }
  // Always include "all"
  if (!out.find(c => c.value === "all")) out.unshift({ name: "all", value: "all" });
  return out;
}

export const REQUIRED_PERMISSIONS = {
  viewAuditLog: PermissionFlagsBits.ViewAuditLog
};
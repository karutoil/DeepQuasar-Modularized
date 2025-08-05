/**
 * I18n helpers for TempVC.
 * Uses core/i18n.js if available; falls back to English literals.
 */
export function t(ctx, key, vars = {}, lang = "en") {
  try {
    const coreI18n = ctx?.i18n;
    if (coreI18n?.t) return coreI18n.t(key, vars, lang);
  } catch {}
  // Fallback literals
  const strings = fallbackStrings[lang] || fallbackStrings.en;
  const template = strings[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

export const fallbackStrings = {
  en: {
    "tempvc.setup.title": "Temporary Voice Channels — Setup",
    "tempvc.setup.enabled": "Enabled: {value}",
    "tempvc.setup.triggers": "Triggers: {count} channel(s)",
    "tempvc.setup.baseCategory": "Base Category: {value}",
    "tempvc.setup.autoShard": "Auto Shard: {auto} | Max Shards: {max}",
    "tempvc.setup.naming": "Naming: {pattern}",
    "tempvc.setup.timeouts": "Idle: {idle}s | Grace: {grace}s | Cooldown: {cooldown}ms",
    "tempvc.setup.limits": "Max Guild: {guild} | Max User: {user}",
    "tempvc.setup.logging": "Logging: {log} | Lang: {lang}",
    "tempvc.saved": "TempVC: Saved",
    "tempvc.saved.desc": "Your settings have been saved.",
    "tempvc.need_manage_guild": "You need Manage Server to use this.",
    "tempvc.failed_open_setup": "Failed to open setup.",
    "tempvc.not_in_voice": "You are not in a voice channel.",
    "tempvc.not_managed": "This voice channel is not managed as a Temporary VC.",
    "tempvc.only_owner_or_admin": "Only the owner (or an admin) can perform this action.",
    "tempvc.renamed": "Renamed to: {name}",
    "tempvc.locked": "Channel locked.",
    "tempvc.unlocked": "Channel unlocked.",
    "tempvc.limited": "User limit set to {count}.",
    "tempvc.removed_user": "Removed {tag} from the channel.",
    "tempvc.banned_user": "Banned {tag} from the channel.",
    "tempvc.permitted_user": "Permitted {tag} to access the channel.",
    "tempvc.denied_user": "Denied {tag} from the channel.",
    "tempvc.claimed": "Ownership claimed.",
    "tempvc.cannot_claim": "Cannot claim.",
    "tempvc.info.owner": "Owner: {owner}",
    "tempvc.info.created": "Created: {created}",
    "tempvc.info.lastActive": "Last Active: {last}",
    "tempvc.info.locked": "Locked: {locked}",
    "tempvc.info.limit": "User Limit: {limit}",
    "tempvc.module.scan": "Integrity scan triggered.",
    "tempvc.module.cleanup": "Cleanup executed (scheduled deletions).",
    "tempvc.module.recover": "Recovery routines applied.",
    "tempvc.module.status_header": "Status",
    "tempvc.error": "Error handling command.",
    "tempvc.creation_blocked": "Creation blocked: {reason}",
  },
};
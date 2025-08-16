import { validateConfigPatch } from '../utils/validators.js';

export default async function messageCreate(message, core, levelService) {
  try {
    if (!message.guildId) return;
    if (message.author?.bot) return;
    const cfg = await levelService.loadConfig(message.guildId);
    // exclusions
    if ((cfg.exclusions?.channels || []).includes(message.channelId)) return;
    if ((cfg.exclusions?.users || []).includes(message.author.id)) return;
    const memberRoles = message.member?.roles?.cache?.map?.((r) => r.id) || [];
    if ((cfg.exclusions?.roles || []).some((r) => memberRoles.includes(r))) return;
    // short messages
    const minLen = cfg.minMessageLength || 5;
    if ((message.content || '').trim().length < minLen) return;
    // repeated identical messages (very simple check using content and lastXP)
    const member = await levelService.core.mongo ? await levelService.core.mongo.getCollection('leveling_members').then(c=>c.findOne({ guildId: message.guildId, userId: message.author.id })) : null;
    if (member && member.lastXPAt) {
      const lastContent = member._lastContent || null;
      if (lastContent && lastContent === message.content) return;
    }

    // cooldown check
    if (member && member.lastXPAt) {
      const cooldownSec = cfg.cooldownSeconds || 60;
      const delta = (Date.now() - new Date(member.lastXPAt).getTime()) / 1000;
      if (delta < cooldownSec) return;
    }

    // award xp
    const res = await levelService.awardXP({ guildId: message.guildId, userId: message.author.id, message });
    if (res.leveledUp) {
      // announce in channel if toggled (for now send a message)
      if (cfg.toggles?.announceLevelUp) {
        await message.channel.send({ content: `${message.author} leveled up to ${res.newLevel}!` });
      }
    }
  } catch (err) {
    core.logger.error('[leveling] messageCreate failed', { err: err?.message, stack: err?.stack });
  }
}

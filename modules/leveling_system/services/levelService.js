import { createMongo } from '../../../core/mongo.js';
import { EmbedBuilder } from 'discord.js';

const COLLECTION = 'leveling_system';

function getMongo(ctx) {
  const coreMongo = ctx?.core?.mongo || ctx?.mongo;
  if (coreMongo && typeof coreMongo.getDb === 'function') return coreMongo;
  const m = createMongo(ctx.config, ctx.logger);
  try { ctx.mongo = m; } catch (err) { void err; }
  return m;
}

async function getCollection(ctx) {
  const m = getMongo(ctx);
  const coll = await m.getCollection(COLLECTION);
  return coll;
}

export async function ensureIndexes(ctx) {
  try {
    const m = getMongo(ctx);
    const db = await m.getDb();
    if (!db) {
      ctx.logger?.warn?.('[Leveling] Mongo not connected for ensureIndexes');
      return;
    }
    await db.collection(COLLECTION).createIndex({ guildId: 1 });
    await db.collection(COLLECTION).createIndex({ 'users.id': 1 });
  } catch (err) {
    ctx.logger?.warn?.('[Leveling] ensureIndexes failed', { error: err?.message });
  }
}

// Default config getters
export async function getGuildSettings(ctx, guildId) {
  const coll = await getCollection(ctx);
  if (!coll) return {};
  const doc = await coll.findOne({ guildId }) || {};
  return doc.settings || {};
}

export async function upsertGuildSettings(ctx, guildId, settings) {
  const coll = await getCollection(ctx);
  if (!coll) return;
  await coll.updateOne({ guildId }, { $set: { guildId, settings } }, { upsert: true });
}

export function xpForLevel(level, formula) {
  // formula is a string JS expression using `level` variable
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('level', `return (${formula});`);
    const val = Number(fn(level));
    if (!Number.isFinite(val) || val < 0) return null;
    return Math.floor(val);
  } catch (e) {
    return null;
  }
}

export async function handleMessage(ctx, message) {
  const guildId = message.guildId;
  const userId = message.author.id;
  const coll = await getCollection(ctx);
  if (!coll) return;

  const doc = await coll.findOne({ guildId }) || { guildId, settings: {}, users: {} };
  const settings = doc.settings || {};
  if (settings.enabled === false) return; // disabled per guild

  const baseXP = Number(settings.xpPerMessage ?? ctx.config.get('LEVELING_XP_PER_MESSAGE') ?? 0);
  const cooldown = Number(settings.messageCooldown ?? ctx.config.get('LEVELING_MESSAGE_COOLDOWN') ?? 60);

  const now = Date.now();
  const user = doc.users?.[userId] || { id: userId, xp: 0, level: 0, lastMessageAt: 0 };
  if (now - (user.lastMessageAt || 0) < cooldown * 1000) return; // on cooldown

  user.lastMessageAt = now;
  user.xp = (user.xp || 0) + baseXP;

  // Compute level up
  const formula = settings.xpFormula ?? ctx.config.get('LEVELING_XP_FORMULA') ?? 'level * 100 + 500';
  let leveled = false;
    // Cap iterations to avoid infinite loops; typical leveling won't need many iterations
    const prestigeCap = Number(settings.prestigeCap ?? ctx.config.get('LEVELING_PRESTIGE_CAP') ?? 100);
    for (let i = 0; i < 100; i++) {
      const next = xpForLevel((user.level || 0) + 1, formula);
      if (next == null) break;
      if ((user.xp || 0) >= next) {
        // Prestige handling: if enabled and next level would exceed cap, perform prestige
        if (settings.prestigeEnabled && ((user.level || 0) + 1) > prestigeCap) {
          user.prestige = (user.prestige || 0) + 1;
          // reset level/xp on prestige
          user.level = 0;
          user.xp = 0;
          leveled = true; // treat as a progression event
          break; // stop further leveling this tick
        }
        user.level = (user.level || 0) + 1;
        leveled = true;
      } else break;
    }

  // Save
  await coll.updateOne({ guildId }, { $set: { [`users.${userId}`]: user, guildId } }, { upsert: true });

  if (leveled) {
    try {
      // Announce in configured channel if set
      const guild = message.guild;
      const guildSettings = settings;
      const announceChannelId = guildSettings.announceChannelId;
      const roleMap = guildSettings.levelRoles || {};
      const newRoleId = roleMap[user.level];
      // Announce prestige separately if it occurred
      if (user.prestige && user.prestige > 0 && (user.level === 0)) {
        // user just prestiged
        if (announceChannelId) {
          const ch = guild.channels.cache.get(announceChannelId);
          if (ch?.isTextBased?.()) {
            const embed = new EmbedBuilder()
              .setTitle('Prestige!')
              .setDescription(`${message.author} prestiged to **${user.prestige}**!`) 
              .setColor(0xffd700);
            ch.send({ embeds: [embed] }).catch(() => null);
          }
        }
      }
      if (announceChannelId) {
        const ch = guild.channels.cache.get(announceChannelId);
        if (ch?.isTextBased?.()) {
          const embed = new EmbedBuilder()
            .setTitle('Level Up!')
            .setDescription(`${message.author} leveled up to **${user.level}**!`)
            .setColor(0x00ff00);
          ch.send({ embeds: [embed] }).catch(() => null);
        }
      }
      if (newRoleId) {
        const member = await message.guild.members.fetch(userId).catch(() => null);
        if (member && !member.roles.cache.has(newRoleId)) {
          const me = message.guild.members.me || message.guild.members.cache.get(ctx.client.user.id);
          if (me && me.permissions.has?.('ManageRoles')) {
            await member.roles.add(newRoleId, 'Level role assignment').catch(() => null);
          }
        }
      }
    } catch (e) {
      ctx.logger?.warn?.('[Leveling] announce/role assign failed', { error: e?.message });
    }
  }
}

export async function startVoiceTicker(ctx) {
  // Create an object with stop() to match lifecycle expectations
  const intervalMs = 1000 * Number(ctx.config.get('LEVELING_VOICE_INTERVAL') ?? 60);
  const tick = async () => {
    try {
      const guilds = ctx.client.guilds.cache.values ? Array.from(ctx.client.guilds.cache.values()) : [];
      for (const g of guilds) {
        await tickGuild(ctx, g).catch(() => null);
      }
    } catch (e) { void e; }
  };
  const id = setInterval(tick, intervalMs);
  return { stop: () => { clearInterval(id); } };
}

async function tickGuild(ctx, guild) {
  const coll = await getCollection(ctx);
  if (!coll) return;
  const doc = await coll.findOne({ guildId: guild.id }) || { settings: {} };
  const settings = doc.settings || {};
  if (settings.enabled === false) return;

  const voiceXP = Number(settings.voiceXpPerInterval ?? ctx.config.get('LEVELING_VOICE_XP') ?? 0);
  const voiceInterval = Number(settings.voiceIntervalSeconds ?? ctx.config.get('LEVELING_VOICE_INTERVAL') ?? 60);
  if (!voiceXP || !voiceInterval) return;

  // For each voice channel that is enabled (if a per-channel toggle exists), award XP to members
  const channels = Array.from(guild.channels.cache.values()).filter(c => c.isVoiceBased && !c.members.size ? false : true);
  for (const ch of channels) {
    // If per-channel toggle exists, check it
    const perChannel = (settings.voiceChannels || {})[ch.id];
    if (perChannel === false) continue; // disabled explicitly
    const members = Array.from(ch.members.values()).filter(m => !m.user?.bot);
    for (const m of members) {
      await awardVoiceXp(ctx, guild.id, m.id, voiceXP);
    }
  }
}

async function awardVoiceXp(ctx, guildId, userId, amount) {
  if (!amount || amount <= 0) return;
  const coll = await getCollection(ctx);
  if (!coll) return;
  const doc = await coll.findOne({ guildId }) || { guildId, settings: {}, users: {} };
  const user = doc.users?.[userId] || { id: userId, xp: 0, level: 0 };
  user.xp = (user.xp || 0) + Number(amount);

  // Compute level up
  const formula = doc.settings?.xpFormula ?? ctx.config.get('LEVELING_XP_FORMULA') ?? 'level * 100 + 500';
  // Try leveling up as long as user has enough XP; cap iterations to avoid infinite loops
    // Try leveling up as long as user has enough XP; cap iterations to avoid infinite loops
    for (let i = 0; i < 100; i++) {
      const next = xpForLevel((user.level || 0) + 1, formula);
      if (next == null) break;
      if ((user.xp || 0) >= next) {
        // Prestige handling for voice XP
        const voicePrestigeCap = Number(doc.settings?.prestigeCap ?? ctx.config.get('LEVELING_PRESTIGE_CAP') ?? 100);
        if (doc.settings?.prestigeEnabled && ((user.level || 0) + 1) > voicePrestigeCap) {
          user.prestige = (user.prestige || 0) + 1;
          user.level = 0;
          user.xp = 0;
          break;
        }
        user.level = (user.level || 0) + 1;
        // apply roles/announce similar to message handler
        try {
          const guild = ctx.client.guilds.cache.get(guildId);
          if (guild) {
            const announceChannelId = doc.settings?.announceChannelId;
            const roleMap = doc.settings?.levelRoles || {};
            const newRoleId = roleMap[user.level];
            if (announceChannelId) {
              const ch = guild.channels.cache.get(announceChannelId);
              if (ch?.isTextBased?.()) {
                const embed = new EmbedBuilder()
                  .setTitle('Level Up!')
                  .setDescription(`<@${userId}> leveled up to **${user.level}**!`)
                  .setColor(0x00ff00);
                ch.send({ embeds: [embed] }).catch(() => null);
              }
            }
            if (newRoleId) {
              const member = await guild.members.fetch(userId).catch(() => null);
              if (member && !member.roles.cache.has(newRoleId)) {
                const me = guild.members.me || guild.members.cache.get(ctx.client.user.id);
                if (me && me.permissions.has?.('ManageRoles')) {
                  await member.roles.add(newRoleId, 'Level role assignment').catch(() => null);
                }
              }
            }
          }
        } catch (e) { void e; }
      } else break;
    }

  await coll.updateOne({ guildId }, { $set: { [`users.${userId}`]: user, guildId } }, { upsert: true });
}

export async function handleVoiceState(_ctx, _oldState, _newState) {
  // No-op: voice XP is handled by the periodic ticker
  return;
}

export async function getUserProfile(ctx, guildId, userId) {
  const coll = await getCollection(ctx);
  if (!coll) return null;
  const doc = await coll.findOne({ guildId }) || { users: {} };
  const user = doc.users?.[userId] || null;
  if (!user) return null;
  const formula = doc.settings?.xpFormula ?? ctx.config.get('LEVELING_XP_FORMULA') ?? 'level * 100 + 500';
  const nextXp = xpForLevel((user.level || 0) + 1, formula) || 0;
  return {
    id: userId,
  level: user.level || 0,
  xp: user.xp || 0,
  next: nextXp,
  prestige: user.prestige || 0,
  };
}

export async function getLeaderboard(ctx, guildId, { limit = 10 } = {}) {
  const coll = await getCollection(ctx);
  if (!coll) return [];
  const doc = await coll.findOne({ guildId }) || { users: {} };
  const users = doc.users || {};
  const arr = Object.values(users).map(u => ({ id: u.id, level: u.level || 0, xp: u.xp || 0, prestige: u.prestige || 0 }));
  arr.sort((a, b) => {
    if (b.level !== a.level) return b.level - a.level;
    return b.xp - a.xp;
  });
  return arr.slice(0, limit);
}

export async function addXpToUser(ctx, guildId, userId, amount) {
  const coll = await getCollection(ctx);
  if (!coll) return null;
  const doc = await coll.findOne({ guildId }) || { guildId, users: {} };
  const user = doc.users?.[userId] || { id: userId, xp: 0, level: 0 };
  user.xp = (user.xp || 0) + Number(amount || 0);
  await coll.updateOne({ guildId }, { $set: { [`users.${userId}`]: user, guildId } }, { upsert: true });
  return user;
}

export async function setUserLevel(ctx, guildId, userId, level) {
  const coll = await getCollection(ctx);
  if (!coll) return null;
  const doc = await coll.findOne({ guildId }) || { guildId, users: {} };
  const user = doc.users?.[userId] || { id: userId, xp: 0, level: 0 };
  user.level = Number(level || 0);
  await coll.updateOne({ guildId }, { $set: { [`users.${userId}`]: user, guildId } }, { upsert: true });
  return user;
}

export async function removeXpFromUser(ctx, guildId, userId, amount) {
  const coll = await getCollection(ctx);
  if (!coll) return null;
  const doc = await coll.findOne({ guildId }) || { guildId, users: {} };
  const user = doc.users?.[userId] || { id: userId, xp: 0, level: 0 };
  user.xp = Math.max(0, (user.xp || 0) - Number(amount || 0));
  await coll.updateOne({ guildId }, { $set: { [`users.${userId}`]: user, guildId } }, { upsert: true });
  return user;
}

export async function resetUser(ctx, guildId, userId) {
  const coll = await getCollection(ctx);
  if (!coll) return null;
  await coll.updateOne({ guildId }, { $unset: { [`users.${userId}`]: '' }, $set: { guildId } }, { upsert: true });
  return true;
}

// Return the raw guild document for export/inspection
export async function exportGuildData(ctx, guildId) {
  const coll = await getCollection(ctx);
  if (!coll) return null;
  const doc = await coll.findOne({ guildId });
  return doc || { guildId, settings: {}, users: {} };
}

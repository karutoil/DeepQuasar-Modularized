import { upsertGuildConfig, loadGuildConfig, findOrCreateMember, atomicAddXP, getTopMembers, getMemberRank, logAudit } from './store.js';
import { evaluateFormula } from '../utils/validators.js';
import { buildRankCard } from '../utils/rankCard.js';

/**
 * LevelService
 * - awardXP
 * - getLeaderboard
 * - xp/level calculation helpers
 */
export class LevelService {
  constructor(core) {
    this.core = core;
    this.logger = core.logger;
    this.bus = core.bus;
    this.configCache = new Map();
    this.rankCardQueue = new Map(); // simple concurrency guard
  }

  async loadConfig(guildId) {
    const cached = this.configCache.get(guildId);
    if (cached) return cached;
    const cfg = await loadGuildConfig(this.core, guildId);
    if (!cfg) {
      const defaults = {
        guildId,
        xpPerMessage: Number(this.core.config.get('LEVELING_DEFAULT_XP_PER_MESSAGE') || 15),
        cooldownSeconds: Number(this.core.config.get('LEVELING_DEFAULT_COOLDOWN_SECONDS') || 60),
        xpCapPerWindow: Number(this.core.config.get('LEVELING_DEFAULT_XP_CAP_PER_WINDOW') || 300),
        minMessageLength: Number(this.core.config.get('LEVELING_DEFAULT_MIN_MESSAGE_LENGTH') || 5),
        formula: {
          type: this.core.config.get('LEVELING_DEFAULT_FORMULA_TYPE') || 'linear',
          baseXP: Number(this.core.config.get('LEVELING_DEFAULT_BASE_XP') || 100),
          growthFactor: Number(this.core.config.get('LEVELING_DEFAULT_GROWTH_FACTOR') || 1.2),
        },
        roleRewards: [],
        exclusions: { channels: [], roles: [], users: [] },
        toggles: { rankCard: false, prestige: false },
        version: 1,
      };
      this.configCache.set(guildId, defaults);
      return defaults;
    }
    this.configCache.set(guildId, cfg);
    return cfg;
  }

  async saveConfig(guildId, patch, actor) {
    const updated = await upsertGuildConfig(this.core, guildId, patch, actor);
    this.configCache.set(guildId, updated);
    return updated;
  }

  xpForLevel(level, formula) {
    if (!formula) formula = { type: 'linear', baseXP: 100, growthFactor: 1.2 };
    const { type, baseXP = 100, growthFactor = 1.2, expression } = formula;
    if (type === 'linear') return baseXP * level;
    if (type === 'exponential') return Math.floor(baseXP * Math.pow(growthFactor, level - 1));
    // custom: evaluate in safe evaluator
    return evaluateFormula({ level, baseXP, growthFactor, expression });
  }

  // cumulative XP required for target level (sum of xpForLevel for levels 1..level)
  cumulativeXPForLevel(level, formula) {
    let total = 0;
    for (let l = 1; l <= level; l++) total += this.xpForLevel(l, formula);
    return total;
  }

  levelForXP(xp, formula) {
    let level = 0;
    let acc = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const next = this.xpForLevel(level + 1, formula);
      if (acc + next > xp) break;
      acc += next;
      level++;
      if (level > 10000) break; // safety
    }
    const remainder = xp - acc;
    return { level, remainder, nextLevelXP: this.xpForLevel(level + 1, formula) };
  }

  async awardXP({ guildId, userId, message, reason = 'message' }) {
    // core checks done in handler; this focuses on atomic update and level calc
    const cfg = await this.loadConfig(guildId);
    const memberBefore = await findOrCreateMember(this.core, guildId, userId);
    const oldXP = memberBefore.xp || 0;
    const { level: oldLevel } = this.levelForXP(oldXP, cfg.formula);

    // compute xp delta (simple base for now)
    let delta = cfg.xpPerMessage || 15;
    // attachments
    if (message?.attachments?.size > 0) delta += Math.min(20, message.attachments.size * 5);
    // mentions
    if (message?.mentions?.users?.size) delta += Math.min(10, message.mentions.users.size * 2);
    // length weighting
    const len = message?.content?.length || 0;
    delta += Math.floor(Math.min(20, len / 50));

    // cap
    if (cfg.xpCapPerWindow) delta = Math.min(delta, cfg.xpCapPerWindow);

    const now = new Date();
    const updated = await atomicAddXP(this.core, guildId, userId, delta, now);
    const newXP = updated.xp || 0;
    const { level: newLevel } = this.levelForXP(newXP, cfg.formula);

    // emit xpEarned
    try { this.bus?.emit?.('xpEarned', { guildId, userId, delta, newXP, oldXP, reason }); } catch (e) { this.logger?.error('bus emit xpEarned error', { e: e?.message }); }

    const result = { addedXP: delta, newXP, oldLevel, newLevel, leveledUp: newLevel > oldLevel };

    if (result.leveledUp) {
      this.logger.info('[leveling] levelup', { guildId, userId, oldLevel, newLevel });
      try { this.bus?.emit?.('levelup', { guildId, userId, oldLevel, newLevel }); } catch (e) { this.logger?.error('bus emit levelup error', { e: e?.message }); }
      // handle role rewards
      for (const rr of (cfg.roleRewards || [])) {
        if (rr.level > oldLevel && rr.level <= newLevel) {
          // assign role
          try {
            const guild = await this.core.client.guilds.fetch(guildId).catch(() => null);
            if (guild) {
              const member = await guild.members.fetch(userId).catch(() => null);
              if (member) {
                await member.roles.add(rr.roleId, `Level reward: reached level ${rr.level}`);
                if (rr.temporaryDays) {
                  // schedule removal later (simplified: store in audit for worker)
                  await logAudit(this.core, guildId, 'system', 'temporary_role_assigned', { userId, roleId: rr.roleId, expiresAt: new Date(Date.now() + rr.temporaryDays * 86400000) });
                }
              }
            }
          } catch (err) {
            this.logger.error('role assignment failed', { err: err?.message, guildId, userId, roleId: rr.roleId });
          }
        }
      }
    }

    return result;
  }

  async getLeaderboard({ guildId, page = 0, limit = 10, global = false }) {
    const entries = await getTopMembers(this.core, global ? null : guildId, page, limit);
    const total = entries.length;
    const mapped = [];
    for (const e of entries) {
      const rank = await getMemberRank(this.core, e.guildId, e.userId);
      mapped.push({ userId: e.userId, xp: e.xp, level: e.level || this.levelForXP(e.xp, (await this.loadConfig(e.guildId)).formula).level, rank });
    }
    return { entries: mapped, total };
  }

  async getProfile({ guildId, userId }) {
    const member = await findOrCreateMember(this.core, guildId, userId);
    const cfg = await this.loadConfig(guildId);
    const lv = this.levelForXP(member.xp || 0, cfg.formula);
    const globalRank = await getMemberRank(this.core, null, userId);
    const localRank = await getMemberRank(this.core, guildId, userId);
    return { xp: member.xp || 0, level: lv.level, remainder: lv.remainder, nextLevelXP: lv.nextLevelXP, globalRank, localRank };
  }

  async renderRankCard({ guildId, userId, template }) {
    if (!this.core.config.getBool('LEVELING_CANVAS_ENABLED', false)) return null;
    // simple concurrency guard per user
    if (this.rankCardQueue.has(userId)) return null;
    this.rankCardQueue.set(userId, true);
    try {
      const profile = await this.getProfile({ guildId, userId });
      const buffer = await buildRankCard({ profile, userId, template, core: this.core });
      return buffer;
    } finally {
      this.rankCardQueue.delete(userId);
    }
  }
}

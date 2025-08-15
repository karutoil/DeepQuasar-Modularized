import { getGuildSettings } from "../services/settings.js";

/**
 * Registers guildMemberAdd handler to apply autorole according to per-guild settings.
 * Returns a disposer function to unregister.
 */
export function registerMemberJoinHandler(ctx) {
  const { client, logger } = ctx;
  const timers = ctx.autorole?.timers || new Map();

  const keyFor = (g, u) => `${g}:${u}`;

  async function scheduleApply(member, settings) {
    const guildId = member.guild.id;
    const userId = member.id;
    const key = keyFor(guildId, userId);

    // Clear any existing timer just in case
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);

    const timeoutId = setTimeout(async () => {
      timers.delete(key);
      try {
        await applyRoleIfEligible(member, settings, ctx);
      } catch (e) {
        logger.warn("[Autorole] Delayed apply failed", { guildId, userId, error: e?.message || e });
      }
    }, Math.max(0, (settings.delaySeconds || 0) * 1000));

    timers.set(key, timeoutId);
  }

  async function applyRoleIfEligible(member, settings, ctx) {
    const { logger } = ctx;
    const guildId = member.guild.id;

    if (!settings?.enabled) return;
    if (!settings?.roleId) return;

    // Ignore bots?
    if (settings.ignoreBots && member.user?.bot) {
      logger.debug?.("[Autorole] Skipping bot member", { guildId, userId: member.id });
      return;
    }

    // If already has the role, skip
    if (member.roles.cache.has(settings.roleId)) {
      logger.debug?.("[Autorole] Member already has role", { guildId, userId: member.id, roleId: settings.roleId });
      return;
    }

    // Account age gating
    if (settings.minAccountAgeDays != null && Number.isFinite(settings.minAccountAgeDays)) {
      const createdAt = member.user?.createdAt ? member.user.createdAt.getTime() : 0;
      const minAgeMs = settings.minAccountAgeDays * 24 * 60 * 60 * 1000;
      if (!createdAt || Date.now() - createdAt < minAgeMs) {
        logger.debug?.("[Autorole] Account too new for autorole", {
          guildId, userId: member.id, minDays: settings.minAccountAgeDays
        });
        return;
      }
    }

    // Check assignable at runtime
    const role = member.guild.roles.cache.get(settings.roleId);
    if (!role) {
      logger.warn("[Autorole] Configured role not found at runtime", { guildId, roleId: settings.roleId });
      return;
    }
    const me = member.guild.members.me || member.guild.members.cache.get(member.client.user.id);
    if (!me || role.managed || role.position >= me.roles.highest.position) {
      logger.warn("[Autorole] Role not assignable at runtime", {
        guildId, roleId: role.id, rolePos: role.position, myPos: me?.roles?.highest?.position
      });
      return;
    }
    if (!me.permissions.has?.("ManageRoles")) {
      logger.warn("[Autorole] Missing ManageRoles permission at runtime", { guildId });
      return;
    }

    // Apply
    try {
      await member.roles.add(role, "Autorole module");
      logger.debug?.("[Autorole] Role applied", { guildId, userId: member.id, roleId: role.id });
    } catch (e) {
      logger.warn("[Autorole] Failed to add role", { guildId, userId: member.id, roleId: role.id, error: e?.message || e });
    }
  }

  async function onGuildMemberAdd(member) {
    try {
      const guildId = member.guild?.id;
      if (!guildId) return;

      const settings = await getGuildSettings(ctx, guildId);
      if (!settings?.enabled || !settings.roleId) return;

      const delay = Number(settings.delaySeconds || 0);
      if (delay > 0) {
        await scheduleApply(member, settings);
      } else {
        await applyRoleIfEligible(member, settings, ctx);
      }
    } catch (e) {
      logger.warn("[Autorole] guildMemberAdd handler error", { error: e?.message || e });
    }
  }

  function onGuildMemberRemove(member) {
    // Cancel any scheduled timer when member leaves
    try {
      const guildId = member.guild?.id;
      if (!guildId) return;
      const key = keyFor(guildId, member.id);
      const timeoutId = timers.get(key);
      if (timeoutId) {
        clearTimeout(timeoutId);
        timers.delete(key);
        logger.debug?.("[Autorole] Cancelled scheduled apply due to member leave", { guildId, userId: member.id });
      }
    } catch (e) {
      logger.warn("[Autorole] guildMemberRemove handler error", { error: e?.message || e });
    }
  }

  client.on("guildMemberAdd", onGuildMemberAdd);
  client.on("guildMemberRemove", onGuildMemberRemove);

  return () => {
    try { client.off("guildMemberAdd", onGuildMemberAdd); } catch (err) { void err; }
    try { client.off("guildMemberRemove", onGuildMemberRemove); } catch (err) { void err; }
  };
}
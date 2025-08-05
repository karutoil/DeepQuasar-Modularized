/**
 * Channel service: creation, overwrite templates, category sharding, and cleanup.
 * Implements creation flow for trigger-join and helper reconciliation.
 */
import { ChannelType, OverwriteType, PermissionFlagsBits } from "discord.js";
import { repo } from "./repository.js";
import { settingsService } from "./settingsService.js";
import { metricsService } from "./metricsService.js";
import { loggingService } from "./loggingService.js";
import { computeFinalOverwrites } from "../utils/permissions.js";

function permBooleanToAllowDeny(value) {
  return !!value;
}

function buildOverwritesLegacy(guild, ownerId, template) {
  // Deprecated by utils/permissions.js but kept for fallback; now unused in reconcile.
  const overwrites = [];

  // Owner
  if (ownerId) {
    const allow = [];
    if (template.owner?.ManageChannels) allow.push(PermissionFlagsBits.ManageChannels);
    if (template.owner?.MoveMembers) allow.push(PermissionFlagsBits.MoveMembers);
    if (template.owner?.MuteMembers) allow.push(PermissionFlagsBits.MuteMembers);
    if (template.owner?.DeafenMembers) allow.push(PermissionFlagsBits.DeafenMembers);
    if (template.owner?.PrioritySpeaker) allow.push(PermissionFlagsBits.PrioritySpeaker);
    if (template.owner?.Stream) allow.push(PermissionFlagsBits.Stream);
    allow.push(PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak);
    overwrites.push({ id: ownerId, type: OverwriteType.Member, allow, deny: [] });
  }

  // Everyone
  const everyoneId = guild.roles.everyone.id;
  if (template.everyone) {
    const allow = [];
    const deny = [];
    if (permBooleanToAllowDeny(template.everyone.ViewChannel)) allow.push(PermissionFlagsBits.ViewChannel);
    if (permBooleanToAllowDeny(template.everyone.Connect)) allow.push(PermissionFlagsBits.Connect);
    if (permBooleanToAllowDeny(template.everyone.Speak)) allow.push(PermissionFlagsBits.Speak);
    if (permBooleanToAllowDeny(template.everyone.Stream)) allow.push(PermissionFlagsBits.Stream);
    overwrites.push({ id: everyoneId, type: OverwriteType.Role, allow, deny });
  }

  // Bot (self)
  const allowBot = [
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
    id: guild.members.me?.id || guild.client.user.id,
    type: OverwriteType.Member,
    allow: allowBot,
    deny: [],
  });

  return overwrites;
}

async function ensureShardCategory(ctx, guild, baseCategoryId, index, naming = "Temp VC") {
  const letter = String.fromCharCode("A".charCodeAt(0) + index);
  const name = `${naming} ${letter}`;
  const existing = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === name
  );
  if (existing) return existing;

  const created = await guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    reason: "TempVC: auto-shard category creation",
  });
  return created;
}

async function pickShardCategory(ctx, guild, settings) {
  const maxShards = Math.max(1, settings.maxShards || 1);
  const base = settings.baseCategoryId ? guild.channels.cache.get(settings.baseCategoryId) : null;

  for (let i = 0; i < maxShards; i++) {
    let category = null;
    if (i === 0 && base && base.type === ChannelType.GuildCategory) {
      category = base;
    } else {
      if (!settings.autoShardCategories) {
        if (!base) return null;
        category = base;
      } else {
        category = await ensureShardCategory(ctx, guild, settings.baseCategoryId, i, "Temp VC");
      }
    }

    const children = guild.channels.cache.filter(
      (c) => c.parentId === category.id && c.type === ChannelType.GuildVoice
    );
    if (children.size < 50) {
      return category;
    }
  }
  return null;
}

function deriveShardIndexFromCategoryName(categoryName) {
  // Expect "Temp VC A", "Temp VC B", ... -> return A=0, B=1, etc. Fallback 0.
  const parts = String(categoryName || "").trim().split(" ");
  const last = parts[parts.length - 1] || "";
  if (last.length === 1) {
    const code = last.charCodeAt(0) - "A".charCodeAt(0);
    if (code >= 0 && code < 26) return code;
  }
  return 0;
}

function formatName(namingPattern, member, counter = null) {
  const username = member?.displayName || member?.user?.username || "User";
  let name = namingPattern.replaceAll("{username}", username);
  if (name.includes("{counter}")) {
    name = name.replaceAll("{counter}", String(counter ?? 1));
  }
  return name;
}

export function channelService(ctx) {
  const { client, logger } = ctx;
  const { collections } = repo(ctx);
  const settings = settingsService(ctx);
  const metrics = metricsService(ctx);
  const logs = loggingService(ctx);

  return {
    async createTempVC(guildId, memberId) {
      const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(memberId);
      const conf = await settings.get(guildId);
      if (!conf.enabled) throw new Error("TempVC disabled");

      if (conf.maxVCsPerGuild > 0) {
        const chCol = await collections.channels();
        const activeGuildCount = await chCol.countDocuments({ guildId, deletedAt: { $in: [null, undefined] } });
        if (activeGuildCount >= conf.maxVCsPerGuild) throw new Error("Guild limit reached");
      }
      if (conf.maxVCsPerUser > 0) {
        const chCol = await collections.channels();
        const activeUserCount = await chCol.countDocuments({ guildId, ownerId: memberId, deletedAt: { $in: [null, undefined] } });
        if (activeUserCount >= conf.maxVCsPerUser) throw new Error("User limit reached");
      }

      const category = await pickShardCategory(ctx, guild, conf);
      if (!category) throw new Error("No category capacity available");

      const chCol = await collections.channels();
      const counter = (await chCol.countDocuments({ guildId })) + 1;
      const channelName = formatName(conf.namingPattern, member, counter);

      // Build initial overwrites (default-open) via utils
      const overwrites = computeFinalOverwrites({
        guild,
        ownerId: memberId,
        template: conf.defaultPermissionsTemplate || {},
        roleTemplates: conf.rolePermissionTemplates || [],
        locked: false,
      });

      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildVoice,
        parent: category.id,
        reason: "TempVC: creation",
        userLimit: null,
        permissionOverwrites: overwrites,
      });

      const now = new Date();
      const doc = {
        _id: channel.id,
        guildId,
        ownerId: memberId,
        categoryId: category.id,
        shardIndex: deriveShardIndexFromCategoryName(category.name),
        createdAt: now,
        lastActiveAt: now,
        namingPatternApplied: conf.namingPattern,
        counter,
        state: {
          locked: false,
          userLimit: null,
          bannedUserIds: [],
          permittedUserIds: [],
        },
        presence: {
          memberIds: [],
          ownerCandidateIds: [],
          lastSnapshotAt: now,
        },
        permsVersion: conf?.defaultPermissionsTemplate?.version || 1,
        renameHistory: [{ at: now, name: channelName, actorId: memberId }],
        recoveryFlags: {},
        scheduledDeletionAt: null,
        deletedAt: null,
        version: 1,
      };

      const chCol2 = await collections.channels();
      await chCol2.insertOne(doc);
      await metrics.onVCCreated(guildId);
      // NOTE: Do not call logs.created here to avoid duplicate audit entries.
      // voiceEvents.maybeCreateTempVC() already logs creation after move/snapshot.
      // Keeping logging in a single place prevents double sends.
 
      return channel;
    },

    /**
     * Reconcile permission overwrites for a channel using current template/state.
     * Honors default and role templates and lock state; optionally applies member-level
     * permits/denies for Connect based on state.permittedUserIds/bannedUserIds.
     */
    async reconcilePermissions(guildId, channelId) {
      try {
        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
        const channel = await guild.channels.fetch(channelId);
        const conf = await settings.get(guildId);
        const chCol3 = await collections.channels();
        const doc = await chCol3.findOne({ _id: channelId });
        if (!channel || !doc) return;

        // Base overwrites via utils
        let overwrites = computeFinalOverwrites({
          guild,
          ownerId: doc.ownerId,
          template: conf.defaultPermissionsTemplate || {},
          roleTemplates: conf.rolePermissionTemplates || [],
          locked: !!doc?.state?.locked,
        });

        // Apply explicit member-level permits/denies for Connect (optional polish)
        // Permit list: ensure Connect allow
        for (const uid of doc?.state?.permittedUserIds || []) {
          overwrites.push({
            id: uid,
            type: OverwriteType.Member,
            allow: [PermissionFlagsBits.Connect],
            deny: [],
          });
        }
        // Ban list: ensure Connect deny (and Speak)
        for (const uid of doc?.state?.bannedUserIds || []) {
          overwrites.push({
            id: uid,
            type: OverwriteType.Member,
            allow: [],
            deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
          });
        }

        // Coalesce duplicate overwrites by id/type
        const keyed = new Map();
        for (const ow of overwrites) {
          const key = `${ow.type}:${ow.id}`;
          if (!keyed.has(key)) keyed.set(key, { id: ow.id, type: ow.type, allow: new Set(), deny: new Set() });
          const rec = keyed.get(key);
          for (const a of ow.allow || []) rec.allow.add(a);
          for (const d of ow.deny || []) rec.deny.add(d);
        }
        overwrites = Array.from(keyed.values()).map((r) => ({
          id: r.id,
          type: r.type,
          allow: Array.from(r.allow),
          deny: Array.from(r.deny),
        }));

        await channel.permissionOverwrites.set(overwrites, "TempVC: reconcile perms");
      } catch (e) {
        logger.warn("[TempVC] reconcilePermissions error", { channelId, error: e?.message });
      }
    },

    async deleteTempVC(channelId, reason = "TempVC: delete") {
      const chCol4 = await collections.channels();
      const doc = await chCol4.findOne({ _id: channelId });
      if (!doc) return;
      try {
        const ch = await ctx.client.channels.fetch(channelId).catch(() => null);
        if (ch && ch.deletable) await ch.delete(reason).catch(() => null);
      } finally {
        const chCol5 = await collections.channels();
        await chCol5.updateOne({ _id: channelId }, { $set: { deletedAt: new Date() } });
        await metrics.onVCDeleted(doc.guildId);
        try { await loggingService(ctx).deleted(doc.guildId, channelId, reason); } catch {}
      }
    },
  };
}
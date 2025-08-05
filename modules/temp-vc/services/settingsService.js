/**
 * Settings service for Temporary Voice Channels (per-guild).
 * Persists to Mongo via repository collections and exposes validated CRUD with defaults.
 */
import { repo } from "./repository.js";

const DEFAULTS = (env) => ({
  enabled: true,
  triggerChannelIds: [],
  baseCategoryId: null,
  autoShardCategories: env?.TEMP_VC_AUTO_SHARD_CATEGORIES === "false" ? false : true,
  maxShards: Number(env?.TEMP_VC_MAX_SHARDS ?? 10),
  namingPattern: env?.TEMP_VC_DEFAULT_NAMING_PATTERN || "{username}'s Channel",
  idleTimeoutSec: Number(env?.TEMP_VC_DEFAULT_IDLE_TIMEOUT_SEC ?? 600),
  gracePeriodSec: Number(env?.TEMP_VC_DEFAULT_GRACE_PERIOD_SEC ?? 60),
  deleteAfterOwnerLeaves: (env?.TEMP_VC_DEFAULT_DELETE_AFTER_OWNER_LEAVES || "false") === "true",
  maxVCsPerGuild: Number(env?.TEMP_VC_MAX_ACTIVE_PER_GUILD ?? 0),
  maxVCsPerUser: Number(env?.TEMP_VC_MAX_ACTIVE_PER_USER ?? 0),
  cooldownMs: Number(env?.TEMP_VC_DEFAULT_COOLDOWN_MS ?? 15000),
  scheduledDeletionHours: Number(env?.TEMP_VC_DEFAULT_SCHEDULED_DELETION_HOURS ?? 0) || 0,
  creatorRoleIds: [],
  adminBypassRoleIds: [],
  defaultPermissionsTemplate: {
    version: 1,
    owner: { ManageChannels: true, MoveMembers: true, MuteMembers: true, DeafenMembers: true, PrioritySpeaker: true, Stream: true },
    everyone: { ViewChannel: true, Connect: true, Speak: true, Stream: true },
    bot: { ManageChannels: true, ManageRoles: true, MoveMembers: true, MuteMembers: true, DeafenMembers: true, ViewChannel: true, Connect: true, Speak: true, Stream: true },
  },
  rolePermissionTemplates: [],
  modlogChannelId: null,
  eventLoggingEnabled: (env?.TEMP_VC_EVENT_LOGGING_DEFAULT || "true") === "true",
  language: env?.TEMP_VC_DEFAULT_LANGUAGE || "en",
  ownerTransferEnabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
});

export async function ensureIndexes(ctx) {
  // Delegated to repository.ensureIndexes
  return;
}

export function settingsService(ctx) {
  const { logger, config, mongo } = ctx;
  const { collections } = repo(ctx);
  // Ensure we get a real MongoDB Collection, not our helper wrapper
  async function getCol() {
    const db = await mongo.getDb();
    if (!db) throw new Error("[TempVC] Mongo not configured");
    return db.collection("tempvc_settings");
  }

  function withDefaults(doc) {
    const d = DEFAULTS(config?.env || process.env);
    // Avoid mixing timestamps into merge; force only logical fields from doc
    const {
      _id: _omitId,
      createdAt: _omitCreated,
      updatedAt: _omitUpdated,
      enabled = d.enabled,
      triggerChannelIds = d.triggerChannelIds,
      baseCategoryId = d.baseCategoryId,
      autoShardCategories = d.autoShardCategories,
      maxShards = d.maxShards,
      namingPattern = d.namingPattern,
      idleTimeoutSec = d.idleTimeoutSec,
      gracePeriodSec = d.gracePeriodSec,
      deleteAfterOwnerLeaves = d.deleteAfterOwnerLeaves,
      maxVCsPerGuild = d.maxVCsPerGuild,
      maxVCsPerUser = d.maxVCsPerUser,
      cooldownMs = d.cooldownMs,
      scheduledDeletionHours = d.scheduledDeletionHours,
      creatorRoleIds = d.creatorRoleIds,
      adminBypassRoleIds = d.adminBypassRoleIds,
      defaultPermissionsTemplate = d.defaultPermissionsTemplate,
      rolePermissionTemplates = d.rolePermissionTemplates,
      modlogChannelId = d.modlogChannelId,
      eventLoggingEnabled = d.eventLoggingEnabled,
      language = d.language,
      ownerTransferEnabled = d.ownerTransferEnabled,
    } = (doc || {});
    return {
      enabled,
      triggerChannelIds: Array.isArray(triggerChannelIds) ? triggerChannelIds : [],
      baseCategoryId: baseCategoryId || null,
      autoShardCategories: !!autoShardCategories,
      maxShards: Number.isFinite(maxShards) && maxShards > 0 ? maxShards : d.maxShards,
      namingPattern: String(namingPattern || d.namingPattern),
      idleTimeoutSec: Math.max(0, Number.isFinite(idleTimeoutSec) ? idleTimeoutSec : d.idleTimeoutSec),
      gracePeriodSec: Math.max(0, Number.isFinite(gracePeriodSec) ? gracePeriodSec : d.gracePeriodSec),
      deleteAfterOwnerLeaves: !!deleteAfterOwnerLeaves,
      maxVCsPerGuild: Math.max(0, Number.isFinite(maxVCsPerGuild) ? maxVCsPerGuild : d.maxVCsPerGuild),
      maxVCsPerUser: Math.max(0, Number.isFinite(maxVCsPerUser) ? maxVCsPerUser : d.maxVCsPerUser),
      cooldownMs: Math.max(0, Number.isFinite(cooldownMs) ? cooldownMs : d.cooldownMs),
      scheduledDeletionHours: Math.max(0, Number.isFinite(scheduledDeletionHours) ? scheduledDeletionHours : d.scheduledDeletionHours),
      creatorRoleIds: Array.isArray(creatorRoleIds) ? Array.from(new Set(creatorRoleIds)) : [],
      adminBypassRoleIds: Array.isArray(adminBypassRoleIds) ? Array.from(new Set(adminBypassRoleIds)) : [],
      defaultPermissionsTemplate: typeof defaultPermissionsTemplate === "object" && defaultPermissionsTemplate ? defaultPermissionsTemplate : d.defaultPermissionsTemplate,
      rolePermissionTemplates: Array.isArray(rolePermissionTemplates) ? rolePermissionTemplates : [],
      modlogChannelId: modlogChannelId || null,
      eventLoggingEnabled: !!eventLoggingEnabled,
      language: String(language || d.language).slice(0, 10),
      ownerTransferEnabled: !!ownerTransferEnabled,
    };
  }

  function validate(input) {
    const errors = [];
    if (!Array.isArray(input.triggerChannelIds)) errors.push("triggerChannelIds must be an array");
    if (typeof input.maxShards !== "number" || input.maxShards <= 0) errors.push("maxShards must be > 0");
    if (typeof input.namingPattern !== "string" || !input.namingPattern.length) errors.push("namingPattern required");
    if (typeof input.idleTimeoutSec !== "number" || input.idleTimeoutSec < 0) errors.push("idleTimeoutSec must be >= 0");
    if (typeof input.gracePeriodSec !== "number" || input.gracePeriodSec < 0) errors.push("gracePeriodSec must be >= 0");
    if (typeof input.maxVCsPerGuild !== "number" || input.maxVCsPerGuild < 0) errors.push("maxVCsPerGuild must be >= 0");
    if (typeof input.maxVCsPerUser !== "number" || input.maxVCsPerUser < 0) errors.push("maxVCsPerUser must be >= 0");
    if (typeof input.cooldownMs !== "number" || input.cooldownMs < 0) errors.push("cooldownMs must be >= 0");
    if (typeof input.scheduledDeletionHours !== "number" || input.scheduledDeletionHours < 0) errors.push("scheduledDeletionHours must be >= 0");
    if (errors.length) {
      const err = new Error("[TempVC] Invalid settings: " + errors.join("; "));
      err.code = "VALIDATION_ERROR";
      throw err;
    }
  }

  return {
    async get(guildId) {
      const col = await getCol();
      // Never project createdAt/updatedAt into logic merge to avoid accidental echo back into $set
      const doc = await col.findOne({ _id: guildId }, { projection: { createdAt: 1, updatedAt: 1, _id: 1, triggerChannelIds: 1, baseCategoryId: 1, autoShardCategories: 1, maxShards: 1, namingPattern: 1, idleTimeoutSec: 1, gracePeriodSec: 1, deleteAfterOwnerLeaves: 1, maxVCsPerGuild: 1, maxVCsPerUser: 1, cooldownMs: 1, scheduledDeletionHours: 1, creatorRoleIds: 1, adminBypassRoleIds: 1, defaultPermissionsTemplate: 1, rolePermissionTemplates: 1, modlogChannelId: 1, eventLoggingEnabled: 1, language: 1, ownerTransferEnabled: 1 } });
      return withDefaults(doc || {});
    },

    async upsert(guildId, patch) {
      const col = await getCol();

      // ABSOLUTE GUARANTEE: strip timestamps from incoming patch to prevent conflicts
      const { createdAt: _pc, updatedAt: _pu, ...safePatch } = (patch || {});

      // Build $set payload strictly from allowed logical keys only
      const allowedKeys = new Set([
        "enabled",
        "triggerChannelIds",
        "baseCategoryId",
        "autoShardCategories",
        "maxShards",
        "namingPattern",
        "idleTimeoutSec",
        "gracePeriodSec",
        "deleteAfterOwnerLeaves",
        "maxVCsPerGuild",
        "maxVCsPerUser",
        "cooldownMs",
        "scheduledDeletionHours",
        "creatorRoleIds",
        "adminBypassRoleIds",
        "defaultPermissionsTemplate",
        "rolePermissionTemplates",
        "modlogChannelId",
        "eventLoggingEnabled",
        "language",
        "ownerTransferEnabled"
      ]);

      const setPayload = {};
      // Merge existing doc with patch logically first to prevent resetting unspecified fields
      const existingDoc = await col.findOne({ _id: guildId }) || {};
      const logicalMerged = withDefaults({ ...existingDoc, ...safePatch });

      for (const [k, v] of Object.entries(logicalMerged)) {
        if (allowedKeys.has(k)) setPayload[k] = v;
      }
      // Always include updatedAt
      setPayload.updatedAt = new Date();

      // Validate the logical merged settings (without timestamps)
      const existing = await col.findOne({ _id: guildId }, { projection: { _id: 1 } }) || {};
      const { createdAt: _vc, updatedAt: _vu, ...mergedLogical } = logicalMerged;
      validate(mergedLogical);

      const update = { $set: setPayload };
      if (!existing._id) {
        update.$setOnInsert = { createdAt: new Date() };
      }

      await col.updateOne({ _id: guildId }, update, { upsert: true });
      logger?.info?.("[TempVC] Settings upserted", { guildId });

      // Return merged logical view to callers to avoid consumers seeing partials
      const afterDb = await col.findOne({ _id: guildId }) || {};
      return withDefaults(afterDb);
    },

    async setEnabled(guildId, enabled) {
      return this.upsert(guildId, { enabled: !!enabled });
    },

    async setTriggers(guildId, triggerChannelIds) {
      if (!Array.isArray(triggerChannelIds)) throw new Error("triggerChannelIds must be an array");
      return this.upsert(guildId, { triggerChannelIds });
    },

    async setBaseCategory(guildId, baseCategoryId) {
      return this.upsert(guildId, { baseCategoryId: baseCategoryId || null });
    },

    async setPermissionsTemplate(guildId, template) {
      const existing = await this.get(guildId);
      const version = (existing?.defaultPermissionsTemplate?.version || 0) + 1;
      return this.upsert(guildId, { defaultPermissionsTemplate: { ...template, version } });
    },
  };
}
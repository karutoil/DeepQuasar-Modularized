/**
 * Admin interactive menus for TempVC configuration.
 * Wires button/select handlers via core/interactions with namespaced customIds.
 * Actual persistence is delegated to services/settingsService.
 */
import { settingsService } from "../services/settingsService.js";
import { components } from "../utils/components.js";
import { ids } from "../utils/ids.js";
import { PermissionFlagsBits } from "discord.js";

export async function registerAdminMenus(ctx) {
  const { interactions, logger, lifecycle } = ctx;
  const moduleName = "temp-vc";
  const settings = settingsService(ctx);

  const disposeFns = [];

  function requireManageGuild(interaction) {
    if (!interaction?.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)) {
      return false;
    }
    return true;
  }

  // Safe ack/edit helpers to avoid "Received one or more errors"
  async function safeDeferUpdate(interaction, loggerScope) {
    try {
      // Prevent double ack: only defer if not already replied/deferred
      if (!interaction.deferred && !interaction.replied) {
        // WithMessageComponentInteraction has deferUpdate, others may not
        if (typeof interaction.deferUpdate === "function") {
          await interaction.deferUpdate();
          ctx.logger?.debug?.("[TempVC] deferUpdate ok", { scope: loggerScope });
          return true;
        }
      }
    } catch (e) {
      ctx.logger?.debug?.("[TempVC] deferUpdate failed", { scope: loggerScope, error: e?.message });
    }
    return false;
  }

  async function safeEditOriginalReply(interaction, view, loggerScope) {
    // Try editing the original reply (interaction response)
    try {
      if (typeof interaction.editReply === "function") {
        await interaction.editReply(view);
        ctx.logger?.debug?.("[TempVC] editReply ok", { scope: loggerScope });
        return true;
      }
    } catch (e) {
      ctx.logger?.debug?.("[TempVC] editReply failed", { scope: loggerScope, error: e?.message });
    }
    // Try editing the message directly (if present)
    try {
      await interaction.message?.edit?.(view);
      ctx.logger?.debug?.("[TempVC] message.edit ok", { scope: loggerScope });
      return true;
    } catch (e) {
      ctx.logger?.debug?.("[TempVC] message.edit failed", { scope: loggerScope, error: e?.message });
    }
    // As a final fallback, send a new ephemeral message (won't replace the original view)
    try {
      await interaction.followUp?.({ ...view, ephemeral: true });
      ctx.logger?.debug?.("[TempVC] followUp ok", { scope: loggerScope });
      return true;
    } catch (e) {
      ctx.logger?.debug?.("[TempVC] followUp failed", { scope: loggerScope, error: e?.message });
    }
    return false;
  }

  async function rerender(interaction, page = "general") {
    const updated = await settings.get(interaction.guildId);
    const view = components.adminSetupView(updated, interaction.guild, ctx, page);
    // Prefer editReply after deferring; fall back to update
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(view);
      } else {
        await interaction.update(view);
      }
    } catch (e) {
      // As a last resort, try followUp ephemeral
      try { await interaction.followUp?.({ content: "Failed to update view.", ephemeral: true }); } catch {}
      throw e;
    }
  }

  // Page navigation buttons — always defer first, then edit; add debug logs
  for (const [pageName, cid] of Object.entries({
    general: ids.admin.page.general,
    timeouts: ids.admin.page.timeouts,
    limits: ids.admin.page.limits,
    logging: ids.admin.page.logging,
    templates: ids.admin.page.templates,
  })) {
    disposeFns.push(
      // Use prefix: false for page nav (exact ids already work)
      interactions.registerButton(moduleName, cid, async (interaction) => {
        try {
          if (!interaction.inGuild()) return;
          if (!requireManageGuild(interaction)) {
            return await interaction.reply({ content: "Manage Server required.", ephemeral: true });
          }
          try {
            logger.debug?.("[TempVC] PageNav deferUpdate start", { page: pageName });
            await interaction.deferUpdate();
            logger.debug?.("[TempVC] PageNav deferUpdate ok", { page: pageName });
          } catch (e) {
            logger.debug?.("[TempVC] PageNav deferUpdate failed", { page: pageName, error: e?.message });
          }
          try {
            logger.debug?.("[TempVC] PageNav rerender start", { page: pageName });
            await rerender(interaction, pageName);
            logger.debug?.("[TempVC] PageNav rerender ok", { page: pageName });
          } catch (e) {
            logger.debug?.("[TempVC] PageNav rerender failed", { page: pageName, error: e?.message });
            throw e;
          }
        } catch (e) {
          logger.error("[TempVC] page nav error", {
            page: pageName,
            error: e?.message,
            name: e?.name,
            code: e?.code,
            stack: e?.stack,
            raw: (typeof e === "object" ? JSON.stringify({
              name: e?.name, message: e?.message, code: e?.code, stack: e?.stack
            }, null, 2) : String(e))
          });
          try { await interaction.followUp?.({ content: "Failed to open page.", ephemeral: true }); } catch {}
        }
      }, { prefix: false })
    );
  }

  // Toggles
  const toggleMap = new Map([
    [ids.admin.toggle.enabled,                async (conf) => ({ enabled: !conf.enabled })],
    [ids.admin.toggle.autoShard,              async (conf) => ({ autoShardCategories: !conf.autoShardCategories })],
    [ids.admin.toggle.deleteAfterOwnerLeaves, async (conf) => ({ deleteAfterOwnerLeaves: !conf.deleteAfterOwnerLeaves })],
    [ids.admin.toggle.eventLoggingEnabled,    async (conf) => ({ eventLoggingEnabled: !conf.eventLoggingEnabled })],
    [ids.admin.toggle.ownerTransferEnabled,   async (conf) => ({ ownerTransferEnabled: !conf.ownerTransferEnabled })],
  ]);

  for (const [cid, computePatch] of toggleMap.entries()) {
    disposeFns.push(
      interactions.registerButton(moduleName, cid, async (interaction) => {
        try {
          if (!interaction.inGuild()) return;
          if (!requireManageGuild(interaction)) {
            return await interaction.reply({ content: "Manage Server required.", ephemeral: true });
          }
          const page = resolveCurrentPageFromMessage(interaction) || "general";
          const conf = await settings.get(interaction.guildId);
          const patch = await computePatch(conf);
          await settings.upsert(interaction.guildId, patch);
          // Always ACK first to avoid double-ack issues, then update
          try {
            logger.debug?.("[TempVC] Toggle deferUpdate start", { cid });
            await interaction.deferUpdate();
            logger.debug?.("[TempVC] Toggle deferUpdate ok", { cid });
          } catch (e) {
            logger.debug?.("[TempVC] Toggle deferUpdate failed", { cid, error: e?.message });
          }
          await rerender(interaction, page);
        } catch (e) {
          logger.error("[TempVC] toggle error", {
            error: e?.message,
            name: e?.name,
            code: e?.code,
            stack: e?.stack
          });
          try { await interaction.followUp?.({ content: "Failed to update setting.", ephemeral: true }); } catch {}
        }
      })
    );
  }

  // Channel selects
  disposeFns.push(
    interactions.registerSelect(moduleName, ids.admin.select.triggers, async (interaction) => {
      try {
        if (!interaction.inGuild()) return;
        if (!requireManageGuild(interaction)) {
          return await interaction.reply({ content: "Manage Server required.", ephemeral: true });
        }
        const page = resolveCurrentPageFromMessage(interaction) || "general";
        const selected = interaction.values || [];
        await settings.setTriggers(interaction.guildId, selected);
        try { await interaction.deferUpdate(); } catch {}
        await rerender(interaction, page);
      } catch (e) {
        logger.error("[TempVC] selectTriggers error", { error: e?.message, name: e?.name, code: e?.code, stack: e?.stack });
        try { await interaction.followUp?.({ content: "Failed to save triggers.", ephemeral: true }); } catch {}
      }
    })
  );

  disposeFns.push(
    interactions.registerSelect(moduleName, ids.admin.select.baseCategory, async (interaction) => {
      try {
        if (!interaction.inGuild()) return;
        if (!requireManageGuild(interaction)) {
          return await interaction.reply({ content: "Manage Server required.", ephemeral: true });
        }
        const page = resolveCurrentPageFromMessage(interaction) || "general";
        const categoryId = interaction.values?.[0] || null;
        await settings.setBaseCategory(interaction.guildId, categoryId);
        try { await interaction.deferUpdate(); } catch {}
        await rerender(interaction, page);
      } catch (e) {
        logger.error("[TempVC] selectBaseCategory error", { error: e?.message, name: e?.name, code: e?.code, stack: e?.stack });
        try { await interaction.followUp?.({ content: "Failed to save base category.", ephemeral: true }); } catch {}
      }
    })
  );

  disposeFns.push(
    interactions.registerSelect(moduleName, ids.admin.select.modlog, async (interaction) => {
      try {
        if (!interaction.inGuild()) return;
        if (!requireManageGuild(interaction)) {
          return await interaction.reply({ content: "Manage Server required.", ephemeral: true });
        }
        const page = resolveCurrentPageFromMessage(interaction) || "logging";
        const modlogId = interaction.values?.[0] || null;
        await settings.upsert(interaction.guildId, { modlogChannelId: modlogId });
        try {
          logger.debug?.("[TempVC] Select:modlog deferUpdate start");
          await interaction.deferUpdate();
          logger.debug?.("[TempVC] Select:modlog deferUpdate ok");
        } catch (e) {
          logger.debug?.("[TempVC] Select:modlog deferUpdate failed", { error: e?.message });
        }
        await rerender(interaction, page);
      } catch (e) {
        logger.error("[TempVC] selectModlog error", {
          error: e?.message,
          name: e?.name,
          code: e?.code,
          stack: e?.stack
        });
        try { await interaction.followUp?.({ content: "Failed to save modlog channel.", ephemeral: true }); } catch {}
      }
    })
  );

  // Role selects (multi)
  disposeFns.push(
    interactions.registerSelect(moduleName, ids.admin.select.roleCreators, async (interaction) => {
      try {
        if (!interaction.inGuild()) return;
        if (!requireManageGuild(interaction)) {
          return await interaction.reply({ content: "Manage Server required.", ephemeral: true });
        }
        const page = resolveCurrentPageFromMessage(interaction) || "limits";
        const roles = interaction.values || [];
        await settings.upsert(interaction.guildId, { creatorRoleIds: roles });
        try {
          logger.debug?.("[TempVC] Select:roleCreators deferUpdate start");
          await interaction.deferUpdate();
          logger.debug?.("[TempVC] Select:roleCreators deferUpdate ok");
        } catch (e) {
          logger.debug?.("[TempVC] Select:roleCreators deferUpdate failed", { error: e?.message });
        }
        await rerender(interaction, page);
      } catch (e) {
        logger.error("[TempVC] select roleCreators error", {
          error: e?.message,
          name: e?.name,
          code: e?.code,
          stack: e?.stack
        });
        try { await interaction.reply({ content: "Failed to save roles.", ephemeral: true }); } catch {}
      }
    })
  );

  disposeFns.push(
    interactions.registerSelect(moduleName, ids.admin.select.roleAdminBypass, async (interaction) => {
      try {
        if (!interaction.inGuild()) return;
        if (!requireManageGuild(interaction)) {
          return await interaction.reply({ content: "Manage Server required.", ephemeral: true });
        }
        const page = resolveCurrentPageFromMessage(interaction) || "limits";
        const roles = interaction.values || [];
        await settings.upsert(interaction.guildId, { adminBypassRoleIds: roles });
        try {
          logger.debug?.("[TempVC] Select:roleAdminBypass deferUpdate start");
          await interaction.deferUpdate();
          logger.debug?.("[TempVC] Select:roleAdminBypass deferUpdate ok");
        } catch (e) {
          logger.debug?.("[TempVC] Select:roleAdminBypass deferUpdate failed", { error: e?.message });
        }
        await rerender(interaction, page);
      } catch (e) {
        logger.error("[TempVC] select roleAdminBypass error", {
          error: e?.message,
          name: e?.name,
          code: e?.code,
          stack: e?.stack
        });
        try { await interaction.reply({ content: "Failed to save roles.", ephemeral: true }); } catch {}
      }
    })
  );

  // Modal submissions (string/number + JSON)
  // Ensure prefix mode so any id starting with modalPrefix is routed here
  disposeFns.push(
    interactions.registerModal(moduleName, ids.admin.modalPrefix, async (interaction) => {
      const diag = {
        gid: interaction.guildId,
        uid: interaction.user?.id,
        cid: interaction.channelId,
        customId: interaction.customId,
        replied: interaction.replied,
        deferred: interaction.deferred,
        t: Date.now()
      };
      try {
        if (!interaction.inGuild()) return;
        if (!requireManageGuild(interaction)) {
          logger.warn("[TempVC] modal blocked: missing ManageGuild", diag);
          // For modal submits, reply() must be used once; keep ephemeral
          return await interaction.reply({ content: "Manage Server required.", ephemeral: true });
        }
        const page = resolveCurrentPageFromMessage(interaction) || "general";
        const rawField = String(interaction.customId || "").substring(ids.admin.modalPrefix.length);
        // Extract source message id if encoded as suffix ":MSG_<id>" in customId
        let sourceMessageId = null;
        try {
          const m = String(interaction.customId || "").match(/:MSG_(\d+)/);
          sourceMessageId = m?.[1] || null;
        } catch {}
        // Normalize field by removing any trailing token explicitly (anything after ':MSG_')
        const tokenIdx = rawField.indexOf(":MSG_");
        const pureField = tokenIdx > -1 ? rawField.substring(0, tokenIdx) : rawField;

        logger.debug?.("[TempVC] DEBUG Modal Submit Start", { ...diag, pureField, page });

        // JSON modals
        if (pureField === "defaultPermissionsTemplate" || pureField === "rolePermissionTemplates") {
          const jsonText = interaction.fields.getTextInputValue("json") || "{}";
          let parsed;
          try {
            parsed = JSON.parse(jsonText);
          } catch (parseErr) {
            logger.error("[TempVC] modal JSON parse error", { ...diag, error: parseErr?.message });
            return await interaction.reply({ content: "Invalid JSON.", ephemeral: true });
          }

          if (pureField === "defaultPermissionsTemplate") {
            // Basic validation: object with owner/everyone/bot blocks optional
            if (typeof parsed !== "object" || Array.isArray(parsed)) {
              logger.warn("[TempVC] modal JSON validation failed: template not object", { ...diag });
              return await interaction.reply({ content: "Template must be an object.", ephemeral: true });
            }
            await settings.setPermissionsTemplate(interaction.guildId, parsed);
          } else {
            // rolePermissionTemplates: array of { roleId, overwrites: { PermissionName: boolean } }
            if (!Array.isArray(parsed)) {
              logger.warn("[TempVC] modal JSON validation failed: role templates not array", { ...diag });
              return await interaction.reply({ content: "Role templates must be an array.", ephemeral: true });
            }
            for (const item of parsed) {
              if (!item?.roleId || typeof item?.overwrites !== "object") {
                logger.warn("[TempVC] modal JSON validation failed: item missing roleId/overwrites", { ...diag });
                return await interaction.reply({ content: "Each item must include roleId and overwrites object.", ephemeral: true });
              }
              for (const [k, v] of Object.entries(item.overwrites)) {
                if (typeof v !== "boolean") {
                  logger.warn("[TempVC] modal JSON validation failed: non-boolean overwrite", { ...diag, key: k });
                  return await interaction.reply({ content: `Invalid value for ${k}; must be boolean.`, ephemeral: true });
                }
                if (!PermissionFlagsBits[k]) {
                  logger.warn("[TempVC] modal JSON validation failed: unknown permission key", { ...diag, key: k });
                  return await interaction.reply({ content: `Unknown permission key: ${k}`, ephemeral: true });
                }
              }
            }
            await settings.upsert(interaction.guildId, { rolePermissionTemplates: parsed });
          }

          const updated = await settings.get(interaction.guildId);
          logger.debug?.("[TempVC] DEBUG Modal Ack (JSON) pre", { ...diag, replied: interaction.replied, deferred: interaction.deferred });

          // Ack first
          if (!interaction.replied && !interaction.deferred) {
            try { await interaction.reply({ ...components.adminEphemeralSaved(updated, ctx), ephemeral: true }); logger.debug?.("[TempVC] modal reply ok", diag); } catch (eAck) { logger.debug?.("[TempVC] modal reply fail", { ...diag, error: eAck?.message }); }
          } else {
            try { await interaction.followUp?.({ ...components.adminEphemeralSaved(updated, ctx), ephemeral: true }); logger.debug?.("[TempVC] modal followUp ok", diag); } catch (eAck) { logger.debug?.("[TempVC] modal followUp fail", { ...diag, error: eAck?.message }); }
          }

          // Then best-effort update the admin view
          try {
            const view = components.adminSetupView(updated, interaction.guild, ctx, page);
            // 2) Try editing the message that spawned the modal (if available)
            if (interaction.message?.editable) {
              try { await interaction.message.edit(view); logger.debug?.("[TempVC] modal message.edit ok", diag); return; } catch (eEdit) { logger.debug?.("[TempVC] modal message.edit fail", { ...diag, error: eEdit?.message }); }
            }
            // 3) Try fetch by encoded sourceMessageId (works only for non-ephemeral messages)
            if (sourceMessageId) {
              try {
                const ch = await interaction.client.channels.fetch(interaction.channelId).catch(() => null);
                const srcMsg = await ch?.messages?.fetch?.(sourceMessageId).catch(() => null);
                if (srcMsg?.editable) { await srcMsg.edit(view); logger.debug?.("[TempVC] modal fetch+edit ok", { ...diag, sourceMessageId }); return; }
              } catch (eFetchById) {
                logger.debug?.("[TempVC] modal fetch message by id failed", { ...diag, error: eFetchById?.message });
              }
            }
            // 4) As a final fallback, send a fresh ephemeral updated UI (cannot edit original ephemeral)
            try { await interaction.followUp?.({ ...view, ephemeral: true }); logger.debug?.("[TempVC] modal followUp view ok", diag); } catch (eFU) { logger.debug?.("[TempVC] modal followUp view fail", { ...diag, error: eFU?.message }); }
          } catch (e2) {
            logger.debug?.("[TempVC] modal submit: message edit failed", { ...diag, error: e2?.message });
          }
          logger.debug?.("[TempVC] DEBUG Modal Submit End (JSON)", diag);
          return;
        }

        // String/number modals
        const value = interaction.fields.getTextInputValue("value") || "";
        const patch = {};
        switch (pureField) {
          case "namingPattern": patch.namingPattern = value; break;
          case "idleTimeoutSec": patch.idleTimeoutSec = Math.max(0, Number(value) || 0); break;
          case "gracePeriodSec": patch.gracePeriodSec = Math.max(0, Number(value) || 0); break;
          case "maxShards": patch.maxShards = Math.max(1, Number(value) || 1); break;
          case "cooldownMs": patch.cooldownMs = Math.max(0, Number(value) || 0); break;
          case "scheduledDeletionHours": patch.scheduledDeletionHours = Math.max(0, Number(value) || 0); break;
          case "maxVCsPerGuild": patch.maxVCsPerGuild = Math.max(0, Number(value) || 0); break;
          case "maxVCsPerUser": patch.maxVCsPerUser = Math.max(0, Number(value) || 0); break;
          case "language": {
            const lang = String(value).trim();
            if (!/^[A-Za-z-]{1,10}$/.test(lang)) {
              logger.warn("[TempVC] modal invalid language code", { ...diag, lang });
              return await interaction.reply({ content: "Invalid language code.", ephemeral: true });
            }
            patch.language = lang;
            break;
          }
          default: break;
        }
        logger.debug?.("[TempVC] DEBUG Modal Upsert Start", { ...diag, patchKeys: Object.keys(patch) });
        await settings.upsert(interaction.guildId, patch);
        const updated = await settings.get(interaction.guildId);

        // Robust ack sequence for modal submits: deferReply -> editReply(saved) -> followUp(view)
        try {
          if (!interaction.replied && !interaction.deferred) {
            try {
              await interaction.deferReply({ ephemeral: true });
              logger.debug?.("[TempVC] modal deferReply ok", diag);
            } catch (eDef) {
              logger.debug?.("[TempVC] modal deferReply fail", { ...diag, error: eDef?.message });
            }
          }
          // Edit the deferred/original reply with saved confirmation
          try {
            await interaction.editReply({ ...components.adminEphemeralSaved(updated, ctx), ephemeral: true });
            logger.debug?.("[TempVC] modal editReply(saved) ok", diag);
          } catch (eEditSaved) {
            logger.debug?.("[TempVC] modal editReply(saved) fail", { ...diag, error: eEditSaved?.message });
            // fallback: followUp saved confirmation
            try { await interaction.followUp?.({ ...components.adminEphemeralSaved(updated, ctx), ephemeral: true }); } catch {}
          }
          // Send refreshed admin view as a separate ephemeral follow-up
          try {
            const view = components.adminSetupView(updated, interaction.guild, ctx, page);
            await interaction.followUp?.({ ...view, ephemeral: true });
            logger.debug?.("[TempVC] modal followUp(view) ok", diag);
          } catch (eFUView) {
            logger.debug?.("[TempVC] modal followUp(view) fail", { ...diag, error: eFUView?.message });
          }
          // If we have a non-ephemeral source message id, try to edit it as well
          if (sourceMessageId) {
            try {
              const ch = await interaction.client.channels.fetch(interaction.channelId).catch(() => null);
              const srcMsg = await ch?.messages?.fetch?.(sourceMessageId).catch(() => null);
              if (srcMsg?.editable) {
                const view = components.adminSetupView(updated, interaction.guild, ctx, page);
                await srcMsg.edit(view);
                logger.debug?.("[TempVC] modal fetch+edit ok", { ...diag, sourceMessageId });
              }
            } catch (eFetchById) {
              logger.debug?.("[TempVC] modal fetch message by id failed", { ...diag, error: eFetchById?.message });
            }
          }
        } catch (e2) {
          logger.debug?.("[TempVC] modal ack sequence failed", { ...diag, error: e2?.message });
        }
        logger.debug?.("[TempVC] DEBUG Modal Submit End (Scalar)", diag);
      } catch (e) {
        logger.error("[TempVC] modal save error", { ...diag, error: e?.message, name: e?.name, code: e?.code, stack: e?.stack });
        // If not already replied, reply with error; else followUp
        if (!interaction.replied && !interaction.deferred) {
          try { await interaction.reply({ content: "Failed to save.", ephemeral: true }); logger.debug?.("[TempVC] modal error reply ok", diag); } catch (eReply) { logger.debug?.("[TempVC] modal error reply fail", { ...diag, error: eReply?.message }); }
        } else {
          try { await interaction.followUp?.({ content: "Failed to save.", ephemeral: true }); logger.debug?.("[TempVC] modal error followUp ok", diag); } catch (eFU) { logger.debug?.("[TempVC] modal error followUp fail", { ...diag, error: eFU?.message }); }
        }
      }
    }, { prefix: true })
  );

  // Buttons that spawn modals (prefix handler)
  // We must showModal() on click rather than trying to update the message.
  disposeFns.push(
    interactions.registerButton(moduleName, ids.admin.modalPrefix, async (interaction) => {
      try {
        if (!interaction.inGuild()) return;
        if (!requireManageGuild(interaction)) {
          return await interaction.reply({ content: "Manage Server required.", ephemeral: true });
        }
        const page = resolveCurrentPageFromMessage(interaction) || "general";
        const cid = String(interaction.customId || "");
        // Include the source message ID in the modal customId only if the source message is non-ephemeral
        const isEphemeralParent = interaction.message?.flags?.has?.(64) || interaction.message?.flags === 64;
        const sourceIdForToken = (!isEphemeralParent && interaction.message?.id && interaction.channelId) ? interaction.message.id : null;
        const field = cid.substring(ids.admin.modalPrefix.length);

        // Fetch current conf to prefill modal values
        const conf = await settings.get(interaction.guildId);

        // Build modal depending on field
        let modal = null;
        // Encode source message id into modal customId to reliably edit on submit
        const srcMsgToken = sourceIdForToken ? `:MSG_${sourceIdForToken}` : "";

        switch (field) {
          case "namingPattern":
            modal = components.buildValueModal(ids.admin.modalPrefix + "namingPattern" + srcMsgToken, "Naming Pattern", "{username}'s Channel", conf.namingPattern || "");
            break;
          case "maxShards":
            modal = components.buildValueModal(ids.admin.modalPrefix + "maxShards" + srcMsgToken, "Max Shards", "e.g., 10", String(conf.maxShards ?? 10));
            break;
          case "idleTimeoutSec":
            modal = components.buildValueModal(ids.admin.modalPrefix + "idleTimeoutSec" + srcMsgToken, "Idle Timeout (sec)", "e.g., 600", String(conf.idleTimeoutSec ?? 600));
            break;
          case "gracePeriodSec":
            modal = components.buildValueModal(ids.admin.modalPrefix + "gracePeriodSec" + srcMsgToken, "Grace Period (sec)", "e.g., 60", String(conf.gracePeriodSec ?? 60));
            break;
          case "cooldownMs":
            modal = components.buildValueModal(ids.admin.modalPrefix + "cooldownMs" + srcMsgToken, "Cooldown (ms)", "e.g., 15000", String(conf.cooldownMs ?? 15000));
            break;
          case "scheduledDeletionHours":
            modal = components.buildValueModal(ids.admin.modalPrefix + "scheduledDeletionHours" + srcMsgToken, "Scheduled Deletion (hours)", "e.g., 0", String(conf.scheduledDeletionHours ?? 0));
            break;
          case "maxVCsPerGuild":
            modal = components.buildValueModal(ids.admin.modalPrefix + "maxVCsPerGuild" + srcMsgToken, "Max VCs per Guild", "0 = unlimited", String(conf.maxVCsPerGuild ?? 0));
            break;
          case "maxVCsPerUser":
            modal = components.buildValueModal(ids.admin.modalPrefix + "maxVCsPerUser" + srcMsgToken, "Max VCs per User", "0 = unlimited", String(conf.maxVCsPerUser ?? 0));
            break;
          case "language":
            modal = components.buildValueModal(ids.admin.modalPrefix + "language" + srcMsgToken, "Language Code", "e.g., en, es, de", String(conf.language || "en"));
            break;
          case "defaultPermissionsTemplate":
            modal = components.buildJsonModal(ids.admin.modalPrefix + "defaultPermissionsTemplate" + srcMsgToken, "Default Permissions Template (JSON)", "{ \"owner\": { \"ManageChannels\": true } }", JSON.stringify(conf.defaultPermissionsTemplate || {}, null, 2));
            break;
          case "rolePermissionTemplates":
            modal = components.buildJsonModal(ids.admin.modalPrefix + "rolePermissionTemplates" + srcMsgToken, "Role Permission Templates (JSON)", "[{ \"roleId\": \"123\", \"overwrites\": { \"Connect\": true } }]", JSON.stringify(conf.rolePermissionTemplates || [], null, 2));
            break;
          default:
            // Unknown modal field — reply to inform admin
            return await interaction.reply({ content: "Unknown setting field.", ephemeral: true });
        }

        // Show modal; do NOT deferUpdate for modal spawns
        await interaction.showModal(modal);
        // Optional: log
        logger.debug?.("[TempVC] showModal", { field, cid, page, sourceIdForToken });
      } catch (e) {
        logger.error("[TempVC] open modal error", { error: e?.message, name: e?.name, code: e?.code, stack: e?.stack });
        // Only reply if not already acknowledged; some routers auto-ack showModal errors
        if (!interaction.replied && !interaction.deferred) {
          try { await interaction.reply({ content: "Failed to open modal.", ephemeral: true }); } catch {}
        } else {
          try { await interaction.followUp?.({ content: "Failed to open modal.", ephemeral: true }); } catch {}
        }
      }
    }, { prefix: true })
  );

  // Helper: best-effort page detection from message components (active primary button)
  function resolveCurrentPageFromMessage(interaction) {
    try {
      const rows = interaction.message?.components || [];
      for (const row of rows) {
        for (const comp of row.components || []) {
          if (comp.style === 1 /* Primary */) {
            // Map button customId to page name
            switch (comp.customId) {
              case ids.admin.page.general: return "general";
              case ids.admin.page.timeouts: return "timeouts";
              case ids.admin.page.limits: return "limits";
              case ids.admin.page.logging: return "logging";
              case ids.admin.page.templates: return "templates";
            }
          }
        }
      }
    } catch {}
    return "general";
  }

  // Temporary catch-all logger for any component interactions related to this module
  // Helps diagnose non-nav buttons not firing by logging customId and component type.
  try {
    const unknownDisposer = interactions.registerAny?.(moduleName, async (interaction) => {
      try {
        // Only log guild component interactions to reduce noise
        if (!interaction?.isFromMessage?.() && interaction?.type !== 3 /* Component */) return;
        const cid = interaction?.customId;
        const type = interaction?.componentType;
        const page = (() => {
          try { return resolveCurrentPageFromMessage(interaction); } catch { return "unknown"; }
        })();
        const known =
          cid === ids.admin.page.general ||
          cid === ids.admin.page.timeouts ||
          cid === ids.admin.page.limits ||
          cid === ids.admin.page.logging ||
          cid === ids.admin.page.templates ||
          cid === ids.admin.toggle.enabled ||
          cid === ids.admin.toggle.autoShard ||
          cid === ids.admin.toggle.deleteAfterOwnerLeaves ||
          cid === ids.admin.toggle.eventLoggingEnabled ||
          cid === ids.admin.toggle.ownerTransferEnabled ||
          cid === ids.admin.select.triggers ||
          cid === ids.admin.select.baseCategory ||
          cid === ids.admin.select.modlog ||
          cid === ids.admin.select.roleCreators ||
          cid === ids.admin.select.roleAdminBypass ||
          (typeof cid === "string" && cid.startsWith(ids.admin.modalPrefix));

        logger.debug?.("[TempVC] DEBUG Component Interaction", {
          cid,
          type,
          page,
          known,
          deferred: interaction?.deferred,
          replied: interaction?.replied
        });

        // Do NOT respond here; this is a logger only and must not ack to avoid double-acks.
      } catch (e) {
        logger.warn("[TempVC] DEBUG Component logger error", { error: e?.message });
      }
    });

    if (typeof unknownDisposer === "function") {
      disposeFns.push(unknownDisposer);
    }
  } catch {}

  const disposer = () => {
    for (const d of disposeFns) { try { d?.(); } catch {} }
  };
  lifecycle.addDisposable(disposer);
  return disposer;
}
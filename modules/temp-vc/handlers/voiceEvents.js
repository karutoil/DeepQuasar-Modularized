/**
 * Voice state event handlers:
 * - Detect joins to trigger channels -> create temp VC
 * - Track presence snapshots and lastActiveAt updates
 * - Ownership reassignment when owner leaves
 */
import { settingsService } from "../services/settingsService.js";
import { channelService } from "../services/channelService.js";
import { stateService } from "../services/stateService.js";
import { ownerService } from "../services/ownerService.js";
import { cooldownService } from "../services/cooldownService.js";
import { loggingService } from "../services/loggingService.js";

export async function registerVoiceEventHandlers(ctx) {
  const { client, logger, lifecycle } = ctx;
  const settings = settingsService(ctx);
  const channels = channelService(ctx);
  const state = stateService(ctx);
  const owners = ownerService(ctx);
  const cooldowns = cooldownService(ctx);
  const logs = loggingService(ctx);

  async function enforceCreationGuards(guildId, member) {
    const conf = await settings.get(guildId);

    // Role-based creator restrictions (if configured)
    if (Array.isArray(conf.creatorRoleIds) && conf.creatorRoleIds.length > 0) {
      const hasRole = member.roles.cache.some((r) => conf.creatorRoleIds.includes(r.id));
      if (!hasRole) {
        throw new Error("You are not allowed to create a Temp VC.");
      }
    }

    // Cooldown
    const remaining = cooldowns.check(guildId, member.id);
    if (remaining > 0) {
      const seconds = Math.ceil(remaining / 1000);
      throw new Error(`Please wait ${seconds}s before creating another Temp VC.`);
    }

    // One active VC per user (owner-based) - if exists, move and abort creation
    try {
      const { repo } = await import("../services/repository.js");
      const { collections } = repo(ctx);
      const chCol = await collections.channels();
      const existing = await chCol.findOne({ guildId, ownerId: member.id, deletedAt: { $in: [null, undefined] } });
      if (existing) {
        await member.voice.setChannel(existing._id, "TempVC: one-active-per-user (existing)").catch(() => null);
        throw new Error("User already has an active Temp VC");
      }
    } catch {
      // best effort; proceed if repo unavailable
    }

    // Limits are enforced inside channelService.createTempVC (guild/user counts)
    return conf;
  }

  async function maybeCreateTempVC(newState) {
    const guildId = newState.guild.id;
    const member = newState.member;
    const userId = newState.id;

    const conf = await settings.get(guildId);
    if (!conf.enabled) return;

    if (!conf.triggerChannelIds?.includes(newState.channelId)) return;

    // Guard and create
    try {
      await enforceCreationGuards(guildId, member);
 
      const ch = await channels.createTempVC(guildId, userId);
 
      // Start cooldown
      if (conf.cooldownMs > 0) cooldowns.start(guildId, userId, conf.cooldownMs);
 
      // Ensure overwrites allow the join before moving
      try { await channels.reconcilePermissions(guildId, ch.id); } catch {}
 
      // Auto-move user into newly created channel (robust with retry)
      const tryMove = async () => {
        try {
          await member.voice.setChannel(ch.id, "TempVC: auto move");
          return true;
        } catch {
          return false;
        }
      };
      let moved = await tryMove();
      if (!moved) {
        await new Promise((r) => setTimeout(r, 600));
        moved = await tryMove();
      }
      if (!moved) {
        await new Promise((r) => setTimeout(r, 900));
        await tryMove();
      }

      // Post control panel strictly via the GuildVoiceChannel instance and persist controlPanel.* using VC id
      try {
        const { repo } = await import("../services/repository.js");
        const { collections } = repo(ctx);
        const chCol = await collections.channels();

        // Fetch as GuildVoiceChannel; enforce type 2 (GuildVoice)
        const guild = ctx.client.guilds.cache.get(guildId) || await ctx.client.guilds.fetch(guildId);
        const vc = await guild.channels.fetch(ch.id).catch(() => null);
        if (!vc || vc.type !== 2 /* GuildVoice */) {
          ctx.logger?.warn?.("[TempVC] Voice channel fetch/type check failed; cannot post control panel", { vcId: ch.id, type: vc?.type });
        } else {
          // Build panel
          const { components } = await import("../utils/components.js");
          const doc = await chCol.findOne({ _id: ch.id }) || { _id: ch.id, ownerId: userId, counter: 0 };
          const panel = components.vcOwnerPanel(doc, ctx);

          // Welcome content per user's working example
          const ownerMember = await guild.members.fetch(userId).catch(() => null);
          const welcomeContent =
            `🎙️ Welcome to your temporary voice channel!\n` +
            `👑 Owner: ${ownerMember?.displayName || `<@${userId}>`}\n\n` +
            `Use the controls below to manage your channel:`;

          // Only call GuildVoiceChannel#send — no heuristics or fallbacks
          let message = null;
          try {
            message = await vc.send({
              content: welcomeContent,
              embeds: panel.embeds,
              components: panel.components
            });
          } catch (sendErr) {
            ctx.logger?.warn?.("[TempVC] GuildVoiceChannel#send threw", { vcId: ch.id, error: sendErr?.message });
          }

          if (message && message.id) {
            await chCol.updateOne(
              { _id: ch.id },
              { $set: { "controlPanel.messageId": message.id, "controlPanel.channelId": ch.id } }
            );
            ctx.logger?.info?.("[TempVC] Control panel posted via GuildVoiceChannel#send", { vcId: ch.id, messageId: message.id });
          } else {
            ctx.logger?.warn?.("[TempVC] GuildVoiceChannel#send returned null/undefined message", { vcId: ch.id });
          }
        }
      } catch (e) {
        logger?.warn?.("[TempVC] Control panel post error", { error: e?.message });
      }
 
      // Snapshot presence and log creation (after move attempt)
      try { await state.snapshotPresence(ch.id, { force: true }); } catch {}
      try { await logs.created(guildId, ch.id, userId, ch.name); } catch {}
    } catch (e) {
      // Fail silently to user since we are in event context; consider DM or ephemeral follow-up via interaction flows
      logger.info("[TempVC] Creation blocked", { guildId, userId, reason: e?.message });
    }
  }

  // Delete a managed Temp VC immediately if it's empty
  async function deleteIfEmpty(channelId, reason = "TempVC: empty (auto-delete)") {
    try {
      const ch = await ctx.client.channels.fetch(channelId).catch(() => null);
      if (!ch) return;
      const memberCount = ch?.members?.size || 0;
      if (memberCount > 0) return;

      // Verify it's a managed temp VC record
      const { repo } = await import("../services/repository.js");
      const { collections } = repo(ctx);
      const col = await collections.channels();
      const doc = await col.findOne({ _id: channelId, deletedAt: { $in: [null, undefined] } });
      if (!doc) return;

      const channelsSvc = (await import("../services/channelService.js")).channelService(ctx);
      await channelsSvc.deleteTempVC(channelId, reason);
    } catch (e) {
      ctx.logger?.warn?.("[TempVC] deleteIfEmpty error", { channelId, error: e?.message });
    }
  }

  async function onOwnerLeftOrReassign(oldState, newState) {
    try {
      if (oldState.channelId && oldState.channelId !== newState.channelId) {
        const channelId = oldState.channelId;

        // Snapshot, then immediate delete-if-empty
        await state.snapshotPresence(channelId).catch(() => null);
        await deleteIfEmpty(channelId, "TempVC: empty after member left/moved");

        // Only attempt reassignment if the channel still exists and has members
        const ch = await ctx.client.channels.fetch(channelId).catch(() => null);
        const memberCount = ch?.members?.size || 0;
        if (memberCount > 0) {
          const newOwnerId = await owners.handleOwnerLeft(channelId);
          if (newOwnerId) {
            await loggingService(ctx).ownerChanged(oldState.guild.id, channelId, oldState.id, newOwnerId);
          }
        }
      }
    } catch (e) {
      ctx.logger?.warn?.("[TempVC] onOwnerLeftOrReassign error", { error: e?.message });
    }
  }

  const onVoiceStateUpdate = async (oldState, newState) => {
    try {
      // Creation on join trigger
      if (!oldState.channelId && newState.channelId) {
        await maybeCreateTempVC(newState);
      }

      // Track presence changes and last active on any move
      if (oldState.channelId !== newState.channelId) {
        if (oldState.channelId) {
          await state.snapshotPresence(oldState.channelId).catch(() => null);
        }
        if (newState.channelId) {
          await state.snapshotPresence(newState.channelId).catch(() => null);
        }
        // Ownership reassignment checks when someone leaves a channel
        await onOwnerLeftOrReassign(oldState, newState);
      }
    } catch (e) {
      logger.warn("[TempVC] voiceStateUpdate handler error", { error: e?.message });
    }
  };

  client.on("voiceStateUpdate", onVoiceStateUpdate);

  const disposer = () => {
    try { client.off("voiceStateUpdate", onVoiceStateUpdate); } catch {}
  };
  lifecycle.addDisposable(disposer);
  return disposer;
}
/**
 * UI control handlers for in-channel TempVC control panel (buttons/selects).
 * Implements select menus for settings and user select menus for kick/ban,
 * plus buttons for rename/delete and a rename modal.
 */
import { ids } from "../utils/ids.js";
import { repo } from "../services/repository.js";
import { channelService } from "../services/channelService.js";
import { loggingService } from "../services/loggingService.js";

export async function registerUiControlHandlers(ctx) {
  const { interactions, logger, lifecycle, client } = ctx;
  const moduleName = "temp-vc";
  const disposeFns = [];
  const { collections } = repo(ctx);
  const channels = channelService(ctx);
  const logs = loggingService(ctx);

  function parseId(prefix, customId) {
    const rest = customId.substring(prefix.length); // e.g. "privacy:123"
    const parts = rest.split(":");
    const action = parts[0];
    const channelId = parts[1];
    return { action, channelId };
  }

  async function ensureActorAuthorized(guildId, channelId, userId) {
    const chCol = await collections.channels();
    const doc = await chCol.findOne({ _id: channelId, deletedAt: { $in: [null, undefined] } });
    if (!doc) return { ok: false, reason: "Channel not managed." };

    if (doc.ownerId === userId) return { ok: true, doc };

    // Admin bypass: if member has any of configured bypass roles
    const { settingsService } = await import("../services/settingsService.js");
    const settings = settingsService(ctx);
    const conf = await settings.get(guildId);
    if (Array.isArray(conf.adminBypassRoleIds) && conf.adminBypassRoleIds.length > 0) {
      try {
        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        const hasBypass = member.roles.cache.some(r => conf.adminBypassRoleIds.includes(r.id));
        if (hasBypass) return { ok: true, doc };
      } catch {}
    }
    return { ok: false, reason: "You are not the VC owner." };
  }

  // String/Role/Channel/Mentionable Selects: action router + follow-ups (ids.ui.selectPrefix)
  // Use core registerSelect (supports prefix routing for any select type)
  disposeFns.push(
    interactions.registerSelect(moduleName, ids.ui.selectPrefix, async (interaction) => {
      try {
        const { action, channelId } = parseId(ids.ui.selectPrefix, interaction.customId);
        const guildId = interaction.guildId;
        const actorId = interaction.user.id;

        const auth = await ensureActorAuthorized(guildId, channelId, actorId);
        if (!auth.ok) return await interaction.reply({ content: auth.reason, ephemeral: true });

        const value = interaction.values?.[0];
        const chCol = await collections.channels();
        const prefsCol = await collections.userPrefs();
        async function upsertUserPrefs(guildId, ownerId, patch) {
          await prefsCol.updateOne(
            { _id: `${guildId}:${ownerId}`, guildId, ownerId },
            { $set: { ...patch, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
            { upsert: true }
          );
        }

        // Action router from components.buildActionRouter(): customId starts with `${ids.ui.selectPrefix}action:${channelId}`
        if (action === "action") {
          // Route by selected option value
          switch (value) {
            case "rename": {
              const { components } = await import("../utils/components.js");
              const modalId = `${ids.ui.modalPrefix}${ids.ui.modal.rename}:${channelId}`;
              const modal = components.buildValueModal(modalId, "Rename VC", "Enter a new name", "");
              return await interaction.showModal(modal);
            }
            case "limit": {
              const { ActionRowBuilder, StringSelectMenuBuilder } = await import("discord.js");
              const s = new StringSelectMenuBuilder()
                .setCustomId(`${ids.ui.selectPrefix}${ids.ui.select.limit}:${channelId}`)
                .setPlaceholder("Select user limit")
                .addOptions(
                  { label: "Unlimited", value: "0" },
                  { label: "2", value: "2" },
                  { label: "5", value: "5" },
                  { label: "10", value: "10" },
                  { label: "25", value: "25" },
                  { label: "50", value: "50" },
                  { label: "99", value: "99" },
                );
              const row = new ActionRowBuilder().addComponents(s);
              return await interaction.reply({ content: "Choose a user limit:", components: [row], ephemeral: true });
            }
            case "bitrate": {
              const { ActionRowBuilder, StringSelectMenuBuilder } = await import("discord.js");
              const s = new StringSelectMenuBuilder()
                .setCustomId(`${ids.ui.selectPrefix}${ids.ui.select.bitrate}:${channelId}`)
                .setPlaceholder("Select bitrate (kbps)")
                .addOptions(
                  { label: "Auto (leave unchanged)", value: "auto" },
                  { label: "32 kbps", value: "32" },
                  { label: "64 kbps", value: "64" },
                  { label: "96 kbps", value: "96" },
                );
              const row = new ActionRowBuilder().addComponents(s);
              return await interaction.reply({ content: "Choose bitrate:", components: [row], ephemeral: true });
            }
            case "region": {
              const { ActionRowBuilder, StringSelectMenuBuilder } = await import("discord.js");
              const s = new StringSelectMenuBuilder()
                .setCustomId(`${ids.ui.selectPrefix}${ids.ui.select.region}:${channelId}`)
                .setPlaceholder("Select region")
                .addOptions(
                  { label: "Auto", value: "auto" },
                  { label: "US East", value: "useast" },
                  { label: "US West", value: "uswest" },
                  { label: "Europe", value: "europe" },
                  { label: "Brazil", value: "brazil" },
                );
              const row = new ActionRowBuilder().addComponents(s);
              return await interaction.reply({ content: "Choose region:", components: [row], ephemeral: true });
            }
            case "lock": {
              await chCol.updateOne({ _id: channelId }, { $set: { "state.locked": true } });
              await channels.reconcilePermissions(guildId, channelId).catch(() => null);
              // persist owner prefs
              const doc = await chCol.findOne({ _id: channelId }, { projection: { ownerId: 1 } });
              if (doc?.ownerId) await upsertUserPrefs(guildId, doc.ownerId, { locked: true });
              try { await logs.locked(guildId, channelId); } catch {}
              return await interaction.reply({ content: "Channel locked.", ephemeral: true });
            }
            case "unlock": {
              await chCol.updateOne({ _id: channelId }, { $set: { "state.locked": false } });
              await channels.reconcilePermissions(guildId, channelId).catch(() => null);
              const doc = await chCol.findOne({ _id: channelId }, { projection: { ownerId: 1 } });
              if (doc?.ownerId) await upsertUserPrefs(guildId, doc.ownerId, { locked: false });
              try { await logs.unlocked(guildId, channelId); } catch {}
              return await interaction.reply({ content: "Channel unlocked.", ephemeral: true });
            }
            case "hide": {
              const vc = await client.channels.fetch(channelId).catch(() => null);
              if (vc?.permissionOverwrites) {
                await vc.permissionOverwrites.edit(vc.guild.roles.everyone, { ViewChannel: false }).catch(() => null);
              }
              return await interaction.reply({ content: "Channel hidden.", ephemeral: true });
            }
            case "show": {
              const vc = await client.channels.fetch(channelId).catch(() => null);
              if (vc?.permissionOverwrites) {
                await vc.permissionOverwrites.edit(vc.guild.roles.everyone, { ViewChannel: true }).catch(() => null);
              }
              return await interaction.reply({ content: "Channel visible.", ephemeral: true });
            }
            case "kick": {
              const { ActionRowBuilder, UserSelectMenuBuilder } = await import("discord.js");
              const u = new UserSelectMenuBuilder()
                .setCustomId(`${ids.ui.userSelectPrefix}${ids.ui.user.kick}:${channelId}`)
                .setPlaceholder("Select a member to kick")
                .setMinValues(1).setMaxValues(1);
              const row = new ActionRowBuilder().addComponents(u);
              return await interaction.reply({ content: "Pick a member to kick:", components: [row], ephemeral: true });
            }
            case "ban": {
              const { ActionRowBuilder, UserSelectMenuBuilder } = await import("discord.js");
              const u = new UserSelectMenuBuilder()
                .setCustomId(`${ids.ui.userSelectPrefix}${ids.ui.user.ban}:${channelId}`)
                .setPlaceholder("Select a member to ban")
                .setMinValues(1).setMaxValues(1);
              const row = new ActionRowBuilder().addComponents(u);
              return await interaction.reply({ content: "Pick a member to ban:", components: [row], ephemeral: true });
            }
            case "unban": {
              // Placeholder: guide to slash for now
              return await interaction.reply({ content: "Use /vc unban or upcoming unban list.", ephemeral: true });
            }
            case "transfer": {
              const { ActionRowBuilder, UserSelectMenuBuilder } = await import("discord.js");
              const u = new UserSelectMenuBuilder()
                .setCustomId(`${ids.ui.userSelectPrefix}${ids.ui.select.transfer}:${channelId}`)
                .setPlaceholder("Select new owner")
                .setMinValues(1).setMaxValues(1);
              const row = new ActionRowBuilder().addComponents(u);
              return await interaction.reply({ content: "Pick a member to transfer ownership to:", components: [row], ephemeral: true });
            }
            case "reset": {
              await chCol.updateOne({ _id: channelId }, { $set: { "state.locked": false, "state.userLimit": null, "state.bannedUserIds": [], "state.permittedUserIds": [] } });
              const vc = await client.channels.fetch(channelId).catch(() => null);
              if (vc?.type === 2) {
                await vc.setUserLimit(0).catch(() => null);
                await vc.setRTCRegion(null).catch(() => null);
              }
              await channels.reconcilePermissions(guildId, channelId).catch(() => null);
              return await interaction.reply({ content: "Channel settings reset to defaults.", ephemeral: true });
            }
            case "delete": {
              await channels.deleteTempVC(channelId, "TempVC: deleted via control panel").catch(() => null);
              return await interaction.reply({ content: "Channel deleted.", ephemeral: true });
            }
            default:
              return await interaction.reply({ content: "Unknown action.", ephemeral: true });
          }
        }

        // Legacy and follow-up specific selects
        switch (action) {
          case ids.ui.select.privacy: {
            const locked = value === "locked";
            await chCol.updateOne({ _id: channelId }, { $set: { "state.locked": locked } });
            await channels.reconcilePermissions(guildId, channelId).catch(() => null);
            try { await (locked ? logs.locked(guildId, channelId) : logs.unlocked(guildId, channelId)); } catch {}
            return await interaction.reply({ content: locked ? "Channel locked." : "Channel unlocked.", ephemeral: true });
          }
          case ids.ui.select.limit: {
            const count = Math.max(0, parseInt(value || "0", 10) || 0);
            try {
              const vc = await client.channels.fetch(channelId).catch(() => null);
              if (vc?.type === 2 /* GuildVoice */) {
                await vc.setUserLimit(count === 0 ? 0 : count).catch(() => null);
              }
              await chCol.updateOne({ _id: channelId }, { $set: { "state.userLimit": count === 0 ? null : count } });
              try { await logs.limited(guildId, channelId, count === 0 ? null : count); } catch {}
              return await interaction.reply({ content: `User limit set to ${count === 0 ? "unlimited" : count}.`, ephemeral: true });
            } catch (e) {
              return await interaction.reply({ content: "Failed to set user limit.", ephemeral: true });
            }
          }
          case ids.ui.select.bitrate: {
            const vc = await client.channels.fetch(channelId).catch(() => null);
            if (vc?.type !== 2) return await interaction.reply({ content: "Not a voice channel.", ephemeral: true });
            if (value !== "auto") {
              const kbps = Math.max(8, parseInt(value, 10) || 64);
              await vc.setBitrate(kbps * 1000).catch(() => null);
              return await interaction.reply({ content: `Bitrate set to ${kbps} kbps.`, ephemeral: true });
            }
            return await interaction.reply({ content: "Bitrate unchanged.", ephemeral: true });
          }
          case ids.ui.select.region: {
            const vc = await client.channels.fetch(channelId).catch(() => null);
            if (vc?.type !== 2) return await interaction.reply({ content: "Not a voice channel.", ephemeral: true });
            const region = value === "auto" ? null : value;
            await vc.setRTCRegion(region).catch(() => null);
            return await interaction.reply({ content: `Region ${region ? `set to ${region}` : "set to auto"}.`, ephemeral: true });
          }
          case ids.ui.select.transfer: {
            return await interaction.reply({ content: "Use the user selector to pick a new owner.", ephemeral: true });
          }
          default:
            return await interaction.reply({ content: "Unknown selection.", ephemeral: true });
        }
      } catch (e) {
        logger.error("[TempVC] select handler error", { error: e?.message });
        try { await interaction.reply({ content: "Selection failed.", ephemeral: true }); } catch {}
      }
    }, { prefix: true })
  );

  // User Selects: transfer/kick/ban (ids.ui.userSelectPrefix)
  // Core interactions routes all select menus via registerSelect, including user selects
  disposeFns.push(
    interactions.registerSelect(moduleName, ids.ui.userSelectPrefix, async (interaction) => {
      try {
        const { action, channelId } = parseId(ids.ui.userSelectPrefix, interaction.customId);
        const guildId = interaction.guildId;
        const actorId = interaction.user.id;

        const auth = await ensureActorAuthorized(guildId, channelId, actorId);
        if (!auth.ok) return await interaction.reply({ content: auth.reason, ephemeral: true });

        const targetId = interaction.values?.[0];
        if (!targetId) return await interaction.reply({ content: "No user selected.", ephemeral: true });

        const chCol = await collections.channels();
        switch (action) {
          case ids.ui.select.transfer: {
            // Transfer ownership
            await chCol.updateOne({ _id: channelId }, { $set: { ownerId: targetId } });
            try { await logs.ownerChanged(guildId, channelId, auth.doc?.ownerId, targetId); } catch {}
            return await interaction.reply({ content: `Ownership transferred to <@${targetId}>.`, ephemeral: true });
          }
          case ids.ui.user.kick: {
            const member = await (await client.guilds.fetch(guildId)).members.fetch(targetId).catch(() => null);
            if (member?.voice?.channelId === channelId) {
              await member.voice.disconnect("TempVC: kick via panel").catch(() => null);
              return await interaction.reply({ content: `Kicked <@${targetId}> from the channel.`, ephemeral: true });
            }
            return await interaction.reply({ content: "User is not in the channel.", ephemeral: true });
          }
          case ids.ui.user.ban: {
            await chCol.updateOne({ _id: channelId }, { $addToSet: { "state.bannedUserIds": targetId } });
            await channels.reconcilePermissions(guildId, channelId).catch(() => null);
            // Optionally disconnect if currently connected
            const member = await (await client.guilds.fetch(guildId)).members.fetch(targetId).catch(() => null);
            if (member?.voice?.channelId === channelId) {
              await member.voice.disconnect("TempVC: ban via panel").catch(() => null);
            }
            return await interaction.reply({ content: `Banned <@${targetId}> from the channel.`, ephemeral: true });
          }
          default:
            return await interaction.reply({ content: "Unknown user action.", ephemeral: true });
        }
      } catch (e) {
        logger.error("[TempVC] user select handler error", { error: e?.message });
        try { await interaction.reply({ content: "User selection failed.", ephemeral: true }); } catch {}
      }
    }, { prefix: true })
  );

  // Buttons: rename/delete (ids.ui.buttonPrefix)
  disposeFns.push(
    interactions.registerButton(moduleName, ids.ui.buttonPrefix, async (interaction) => {
      try {
        const { action, channelId } = parseId(ids.ui.buttonPrefix, interaction.customId);
        const guildId = interaction.guildId;
        const actorId = interaction.user.id;

        const auth = await ensureActorAuthorized(guildId, channelId, actorId);
        if (!auth.ok) return await interaction.reply({ content: auth.reason, ephemeral: true });

        switch (action) {
          case ids.ui.button.rename: {
            // Open modal
            const { components } = await import("../utils/components.js");
            const modalId = `${ids.ui.modalPrefix}${ids.ui.modal.rename}:${channelId}`;
            const modal = components.buildValueModal(modalId, "Rename VC", "Enter a new name", "");
            return await interaction.showModal(modal);
          }
          case ids.ui.button.delete: {
            await channels.deleteTempVC(channelId, "TempVC: deleted via panel").catch(() => null);
            return await interaction.reply({ content: "Channel scheduled for deletion.", ephemeral: true });
          }
          default:
            return await interaction.reply({ content: "Unknown control.", ephemeral: true });
        }
      } catch (e) {
        logger.error("[TempVC] button handler error", { error: e?.message });
        try { await interaction.reply({ content: "Control failed.", ephemeral: true }); } catch {}
      }
    }, { prefix: true })
  );

  // Modal: rename (ids.ui.modalPrefix)
  disposeFns.push(
    interactions.registerModal(moduleName, ids.ui.modalPrefix, async (interaction) => {
      try {
        const { action, channelId } = parseId(ids.ui.modalPrefix, interaction.customId);
        if (action !== ids.ui.modal.rename) return;

        const guildId = interaction.guildId;
        const actorId = interaction.user.id;
        const auth = await ensureActorAuthorized(guildId, channelId, actorId);
        if (!auth.ok) return await interaction.reply({ content: auth.reason, ephemeral: true });

        const newName = interaction.fields.getTextInputValue("value")?.slice(0, 100) || null;
        if (!newName) return await interaction.reply({ content: "No name provided.", ephemeral: true });

        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (ch && ch.editable) {
          await ch.edit({ name: newName }).catch(() => null);
        }
        const chCol = await collections.channels();
        await chCol.updateOne({ _id: channelId }, { $push: { renameHistory: { at: new Date(), name: newName, actorId } } });
        try { await logs.renamed(guildId, channelId, newName); } catch {}
        return await interaction.reply({ content: `Renamed to "${newName}".`, ephemeral: true });
      } catch (e) {
        logger.error("[TempVC] modal handler error", { error: e?.message });
        try { await interaction.reply({ content: "Rename failed.", ephemeral: true }); } catch {}
      }
    }, { prefix: true })
  );

  const disposer = () => {
    for (const d of disposeFns) { try { d?.(); } catch {} }
  };
  lifecycle.addDisposable(disposer);
  return disposer;
}
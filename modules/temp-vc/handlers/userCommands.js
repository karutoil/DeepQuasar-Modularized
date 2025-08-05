/**
 * /vc command group: owner/user actions and admin recovery subcommands (module).
 * Implements core actions and wires to services.
 */
import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { settingsService } from "../services/settingsService.js";
import { channelService } from "../services/channelService.js";
import { ownerService } from "../services/ownerService.js";
import { loggingService } from "../services/loggingService.js";
import { integrityService } from "../services/integrityService.js";
import { metricsService } from "../services/metricsService.js";

function ensureInGuild(interaction) {
  if (!interaction.guildId) throw new Error("Guild-only command.");
}

async function resolveUserVoiceChannel(interaction) {
  const member = interaction.member;
  const channelId = member?.voice?.channelId || null;
  return channelId;
}

export async function registerUserCommands(ctx) {
  const { commands, logger, lifecycle, mongo } = ctx;
  const moduleName = "temp-vc";

  const settings = settingsService(ctx);
  const channels = channelService(ctx);
  const owners = ownerService(ctx);
  const logs = loggingService(ctx);
  const integrity = integrityService(ctx);
  const metrics = metricsService(ctx);

  // Build /vc command with subcommands
  const data = new SlashCommandBuilder()
    .setName("vc")
    .setDescription("Temporary VC controls")
    .addSubcommand((s) => s.setName("rename").setDescription("Rename your temp VC").addStringOption((o) => o.setName("name").setDescription("New channel name").setRequired(true)))
    .addSubcommand((s) => s.setName("lock").setDescription("Lock your temp VC"))
    .addSubcommand((s) => s.setName("unlock").setDescription("Unlock your temp VC"))
    .addSubcommand((s) => s.setName("limit").setDescription("Set user limit").addIntegerOption((o) => o.setName("count").setDescription("User limit (0 = unlimited)").setRequired(true)))
    .addSubcommand((s) => s.setName("kick").setDescription("Remove a user").addUserOption((o) => o.setName("user").setDescription("User to remove").setRequired(true)))
    .addSubcommand((s) => s.setName("ban").setDescription("Ban a user from your VC").addUserOption((o) => o.setName("user").setDescription("User to ban").setRequired(true)))
    .addSubcommand((s) => s.setName("permit").setDescription("Whitelist a user").addUserOption((o) => o.setName("user").setDescription("User to permit").setRequired(true)))
    .addSubcommand((s) => s.setName("deny").setDescription("Blacklist a user").addUserOption((o) => o.setName("user").setDescription("User to deny").setRequired(true)))
    .addSubcommand((s) => s.setName("claim").setDescription("Claim ownership if current owner left"))
    .addSubcommand((s) => s.setName("info").setDescription("Show info about the temp VC"))
    // Admin recovery group
    .addSubcommandGroup((g) =>
      g
        .setName("module")
        .setDescription("Admin recovery and maintenance")
        .addSubcommand((s) => s.setName("scan").setDescription("Trigger integrity scan now"))
        .addSubcommand((s) => s.setName("cleanup").setDescription("Force cleanup of invalid/ghost VCs"))
        .addSubcommand((s) => s.setName("recover").setDescription("Re-apply ownership/permissions from backup"))
        .addSubcommand((s) => s.setName("status").setDescription("Show module status and metrics"))
    );

  // Register builder JSON only; wire execution via v2 router to satisfy core/commandHandler expectations
  try {
    commands?.registerSlash?.(moduleName, data);
    const disposeExec = commands?.v2RegisterExecute?.("vc", async (interaction) => {
      try {
        ensureInGuild(interaction);
        const guildId = interaction.guildId;
        const sub = interaction.options.getSubcommand();
        const group = interaction.options.getSubcommandGroup(false);

        // Admin group
        if (group === "module") {
          if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await interaction.reply({ content: "Manage Server required.", ephemeral: true });
          }
          if (sub === "scan") {
            // hourly scan logic (permissions/ownership/orphans)
            await integrity.runHourlyIntegrityScan();
            return await interaction.reply({ content: "Integrity scan triggered.", ephemeral: true });
          }
          if (sub === "cleanup") {
            await integrity.processScheduledDeletions();
            return await interaction.reply({ content: "Cleanup executed (scheduled deletions).", ephemeral: true });
          }
          if (sub === "recover") {
            await integrity.runHourlyIntegrityScan();
            return await interaction.reply({ content: "Recovery routines applied.", ephemeral: true });
          }
          if (sub === "status") {
            const date = new Date();
            const today = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
            const snap = await metrics.exportDaily(guildId, today);
            const dbh = await mongo.getDb();
            const active = await dbh.collection("tempvc_channels").countDocuments({ guildId, deletedAt: { $in: [null, undefined] } });
            return await interaction.reply({
              content: [
                `Active: ${active}`,
                `Created: ${snap?.vcsCreated || 0}`,
                `Deleted: ${snap?.vcsDeleted || 0}`,
                `Recovered: ${snap?.recovered || 0}`,
                `Reassigned: ${snap?.reassigned || 0}`,
                `CleanedOrphans: ${snap?.cleanedOrphans || 0}`,
                `PeakConcurrent: ${snap?.peakConcurrent || 0}`,
              ].join("\n"),
              ephemeral: true,
            });
          }
          return;
        }

        // User actions
        const channelId = await resolveUserVoiceChannel(interaction);
        if (!channelId) return await interaction.reply({ content: "You are not in a voice channel.", ephemeral: true });

        const dbh = await mongo.getDb();
        const doc = await dbh.collection("tempvc_channels").findOne({ _id: channelId, deletedAt: { $in: [null, undefined] } });
        if (!doc) return await interaction.reply({ content: "This voice channel is not managed as a Temporary VC.", ephemeral: true });

        const isOwner = doc.ownerId === interaction.user.id;
        const hasAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
        if (!isOwner && !hasAdmin && !["info"].includes(sub) && sub !== "claim") {
          return await interaction.reply({ content: "Only the owner (or an admin) can perform this action.", ephemeral: true });
        }

        switch (sub) {
          case "rename": {
            const name = interaction.options.getString("name", true);
            const channel = await interaction.guild.channels.fetch(channelId);
            await channel.setName(name, "TempVC: rename");
            const dbh2 = await mongo.getDb();
            await dbh2.collection("tempvc_channels").updateOne({ _id: channelId }, { $push: { renameHistory: { at: new Date(), name, actorId: interaction.user.id } } });
            await logs.renamed(guildId, channelId, name);
            return await interaction.reply({ content: `Renamed to: ${name}`, ephemeral: true });
          }
          case "lock": {
            const dbh2 = await mongo.getDb();
            await dbh2.collection("tempvc_channels").updateOne({ _id: channelId }, { $set: { "state.locked": true } });
            await channels.reconcilePermissions(guildId, channelId);
            await logs.locked(guildId, channelId);
            return await interaction.reply({ content: "Channel locked.", ephemeral: true });
          }
          case "unlock": {
            const dbh2 = await mongo.getDb();
            await dbh2.collection("tempvc_channels").updateOne({ _id: channelId }, { $set: { "state.locked": false } });
            await channels.reconcilePermissions(guildId, channelId);
            await logs.unlocked(guildId, channelId);
            return await interaction.reply({ content: "Channel unlocked.", ephemeral: true });
          }
          case "limit": {
            const count = Math.max(0, interaction.options.getInteger("count", true));
            const channel = await interaction.guild.channels.fetch(channelId);
            await channel.setUserLimit(count === 0 ? 0 : count);
            const dbh2 = await mongo.getDb();
            await dbh2.collection("tempvc_channels").updateOne({ _id: channelId }, { $set: { "state.userLimit": count === 0 ? null : count } });
            await logs.limited(guildId, channelId, count);
            return await interaction.reply({ content: `User limit set to ${count || "unlimited"}.`, ephemeral: true });
          }
          case "kick": {
            const user = interaction.options.getUser("user", true);
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (member?.voice?.channelId === channelId) {
              await member.voice.disconnect("TempVC: kick").catch(() => null);
            }
            return await interaction.reply({ content: `Removed ${user.tag} from the channel.`, ephemeral: true });
          }
          case "ban": {
            const user = interaction.options.getUser("user", true);
            const dbh2 = await mongo.getDb();
            await dbh2.collection("tempvc_channels").updateOne({ _id: channelId }, { $addToSet: { "state.bannedUserIds": user.id } });
            // Optional: also deny Connect for the user (not implemented here)
            return await interaction.reply({ content: `Banned ${user.tag} from the channel.`, ephemeral: true });
          }
          case "permit": {
            const user = interaction.options.getUser("user", true);
            const dbh2 = await mongo.getDb();
            await dbh2.collection("tempvc_channels").updateOne({ _id: channelId }, { $addToSet: { "state.permittedUserIds": user.id } });
            await channels.reconcilePermissions(guildId, channelId);
            return await interaction.reply({ content: `Permitted ${user.tag} to access the channel.`, ephemeral: true });
          }
          case "deny": {
            const user = interaction.options.getUser("user", true);
            const dbh2 = await mongo.getDb();
            await dbh2.collection("tempvc_channels").updateOne({ _id: channelId }, { $pull: { "state.permittedUserIds": user.id } });
            await channels.reconcilePermissions(guildId, channelId);
            return await interaction.reply({ content: `Denied ${user.tag} from the channel.`, ephemeral: true });
          }
          case "claim": {
            try {
              const result = await owners.claim(channelId, interaction.user.id);
              return await interaction.reply({ content: result?.message || "Claimed.", ephemeral: true });
            } catch (e) {
              return await interaction.reply({ content: e?.message || "Cannot claim.", ephemeral: true });
            }
          }
          case "info": {
            const owner = doc.ownerId ? `<@${doc.ownerId}>` : "None";
            const created = new Date(doc.createdAt).toISOString();
            const lastActive = doc.lastActiveAt ? new Date(doc.lastActiveAt).toISOString() : "N/A";
            const locked = !!doc?.state?.locked;
            const limit = doc?.state?.userLimit ?? "unlimited";
            return await interaction.reply({
              content: [
                `Owner: ${owner}`,
                `Created: ${created}`,
                `Last Active: ${lastActive}`,
                `Locked: ${locked}`,
                `User Limit: ${limit}`,
              ].join("\n"),
              ephemeral: true,
            });
          }
        }
      } catch (e) {
        logger.error("[TempVC] /vc handler error", { error: e?.message, stack: e?.stack });
        try { if (interaction.isRepliable() && !interaction.replied) await interaction.reply({ content: "Error handling command.", ephemeral: true }); } catch {}
      }
    });
    lifecycle.addDisposable(() => { try { disposeExec?.(); } catch {} });
  } catch (e) {
    logger.error("[TempVC] Failed to register /vc", { error: e?.message });
  }
 
  const disposer = () => {};
  lifecycle.addDisposable(disposer);
  return disposer;
}
/**
 * Component factories for TempVC admin and user UIs.
 * Now i18n-aware via utils/i18n.t fallback to English literals.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from "discord.js";
import { ids } from "./ids.js";
import { t } from "./i18n.js";

/**
 * Helpers for control panel formatting
 */
function fmtBoolIcon(v) { return v ? "🔓 Unlocked" : "🔒 Locked"; }
function fmtVisible(v) { return v ? "👁️ Visible" : "🙈 Hidden"; }
function fmtRegion(v) { return v ? v : "Automatic"; }
function fmtBitrate(bps) { return typeof bps === "number" && bps > 0 ? `${Math.round(bps/1000)}kbps` : "Automatic"; }
function fmtLimit(n) { return Number.isFinite(n) && n > 0 ? String(n) : "∞"; }
function joined(arr, sep = ", ") { return Array.isArray(arr) ? arr.join(sep) : String(arr || ""); }

function onOff(v) { return v ? "On" : "Off"; }

function pageNavRow(activePage) {
  const mkBtn = (label, id, active) =>
    new ButtonBuilder()
      .setCustomId(id)
      .setStyle(active ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setLabel(label);
  return new ActionRowBuilder().addComponents(
    mkBtn("General", ids.admin.page.general, activePage === "general"),
    mkBtn("Timeouts", ids.admin.page.timeouts, activePage === "timeouts"),
    mkBtn("Limits", ids.admin.page.limits, activePage === "limits"),
    mkBtn("Logging", ids.admin.page.logging, activePage === "logging"),
    mkBtn("Templates", ids.admin.page.templates, activePage === "templates"),
  );
}

export const components = {
  // Main admin setup view with pagination (ephemeral)
  adminSetupView(conf, guild, ctx, page = "general") {
    // Build a minimal, always-valid description: avoid i18n issues by falling back to literals
    const safeBool = (v) => (v ? "On" : "Off");
    const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
    const arrLen = (a) => (Array.isArray(a) ? a.length : 0);
    const baseCat = conf?.baseCategoryId ? `<#${conf.baseCategoryId}>` : "Not set";

    const summaryLines = [
      `Enabled: ${safeBool(!!conf?.enabled)}`,
      `Triggers: ${arrLen(conf?.triggerChannelIds)}`,
      `Base Category: ${baseCat}`,
      `Auto-Shard: ${safeBool(!!conf?.autoShardCategories)}  MaxShards: ${num(conf?.maxShards, 1)}`,
      `Naming: ${String(conf?.namingPattern ?? "{username}'s Channel").slice(0, 100)}`,
      `Idle: ${num(conf?.idleTimeoutSec)}s  Grace: ${num(conf?.gracePeriodSec)}s  Cooldown: ${num(conf?.cooldownMs)}ms`,
      `Limits — Guild: ${Number.isFinite(conf?.maxVCsPerGuild) && conf.maxVCsPerGuild > 0 ? conf.maxVCsPerGuild : "∞"}, User: ${Number.isFinite(conf?.maxVCsPerUser) && conf.maxVCsPerUser > 0 ? conf.maxVCsPerUser : "∞"}`,
      `Logging: ${safeBool(!!conf?.eventLoggingEnabled)}  Lang: ${String(conf?.language || "en").slice(0, 10)}`
    ];
    const description = summaryLines.map(s => String(s).slice(0, 512)).join("\n").slice(0, 4096);

    const title = "TempVC Setup";
    const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(0x5865f2);

    const rows = [];
    // Row 1: page navigation
    rows.push(pageNavRow(page));

    if (page === "general") {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(ids.admin.toggle.enabled)
            .setStyle(conf.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
            .setLabel(conf.enabled ? "Disable" : "Enable"),
          new ButtonBuilder()
            .setCustomId(ids.admin.toggle.autoShard)
            .setStyle(conf.autoShardCategories ? ButtonStyle.Danger : ButtonStyle.Success)
            .setLabel(`Auto-Shard: ${onOff(conf.autoShardCategories)}`),
        )
      );

      rows.push(
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(ids.admin.select.triggers)
            .setPlaceholder("Select trigger voice channels")
            .setMinValues(0)
            .setMaxValues(25)
            .addChannelTypes(ChannelType.GuildVoice)
        )
      );

      rows.push(
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(ids.admin.select.baseCategory)
            .setPlaceholder("Select base category")
            .setMinValues(0)
            .setMaxValues(1)
            .addChannelTypes(ChannelType.GuildCategory)
        )
      );

      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(ids.admin.modalPrefix + "namingPattern").setStyle(ButtonStyle.Primary).setLabel("Set Naming"),
          new ButtonBuilder().setCustomId(ids.admin.modalPrefix + "maxShards").setStyle(ButtonStyle.Secondary).setLabel("Max Shards")
        )
      );
    } else if (page === "timeouts") {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(ids.admin.modalPrefix + "idleTimeoutSec").setStyle(ButtonStyle.Primary).setLabel("Idle (sec)"),
          new ButtonBuilder().setCustomId(ids.admin.modalPrefix + "gracePeriodSec").setStyle(ButtonStyle.Secondary).setLabel("Grace (sec)"),
          new ButtonBuilder().setCustomId(ids.admin.modalPrefix + "cooldownMs").setStyle(ButtonStyle.Secondary).setLabel("Cooldown (ms)"),
          new ButtonBuilder().setCustomId(ids.admin.modalPrefix + "scheduledDeletionHours").setStyle(ButtonStyle.Secondary).setLabel("Scheduled Deletion (hours)")
        )
      );

      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(ids.admin.toggle.deleteAfterOwnerLeaves)
            .setStyle(conf.deleteAfterOwnerLeaves ? ButtonStyle.Danger : ButtonStyle.Success)
            .setLabel(`Delete after owner leaves: ${onOff(conf.deleteAfterOwnerLeaves)}`),
          new ButtonBuilder()
            .setCustomId(ids.admin.toggle.ownerTransferEnabled)
            .setStyle(conf.ownerTransferEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
            .setLabel(`Owner transfer: ${onOff(conf.ownerTransferEnabled)}`)
        )
      );
    } else if (page === "limits") {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(ids.admin.modalPrefix + "maxVCsPerGuild").setStyle(ButtonStyle.Primary).setLabel("Max VCs / Guild"),
          new ButtonBuilder().setCustomId(ids.admin.modalPrefix + "maxVCsPerUser").setStyle(ButtonStyle.Secondary).setLabel("Max VCs / User"),
        )
      );

      rows.push(
        new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder()
            .setCustomId(ids.admin.select.roleCreators)
            .setPlaceholder("Select creator roles")
            .setMinValues(0)
            .setMaxValues(25),
        )
      );

      rows.push(
        new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder()
            .setCustomId(ids.admin.select.roleAdminBypass)
            .setPlaceholder("Select admin bypass roles")
            .setMinValues(0)
            .setMaxValues(25),
        )
      );
    } else if (page === "logging") {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(ids.admin.toggle.eventLoggingEnabled)
            .setStyle(conf.eventLoggingEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
            .setLabel(`Event logging: ${onOff(conf.eventLoggingEnabled)}`),
        )
      );

      rows.push(
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(ids.admin.select.modlog)
            .setPlaceholder("Select modlog text channel")
            .setMinValues(0)
            .setMaxValues(1)
            .addChannelTypes(ChannelType.GuildText),
        )
      );

      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(ids.admin.modalPrefix + "language").setStyle(ButtonStyle.Secondary).setLabel("Language (code)"),
        )
      );
    } else if (page === "templates") {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(ids.admin.modalPrefix + "defaultPermissionsTemplate").setStyle(ButtonStyle.Primary).setLabel("Edit Default Template (JSON)"),
          new ButtonBuilder().setCustomId(ids.admin.modalPrefix + "rolePermissionTemplates").setStyle(ButtonStyle.Secondary).setLabel("Edit Role Templates (JSON)"),
        )
      );
    }

    return {
      embeds: [embed],
      components: rows.slice(0, 5),
    };
  },

  // Simple ephemeral saved confirmation
  adminEphemeralSaved(conf, ctx) {
    const embed = new EmbedBuilder()
      .setTitle(t(ctx, "tempvc.saved"))
      .setDescription(t(ctx, "tempvc.saved.desc"))
      .setColor(0x57f287);
    return { embeds: [embed], ephemeral: true };
  },

  // Modal factory for numeric/string values — used via dynamic ids with prefix
  buildValueModal(customId, label, placeholder, currentValue = "") {
    const modal = new ModalBuilder().setCustomId(customId).setTitle(label);
    const input = new TextInputBuilder()
      .setCustomId("value")
      .setLabel(label)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(placeholder)
      .setRequired(true)
      .setValue(String(currentValue));

    const row = new ActionRowBuilder().addComponents(input);
    modal.addComponents(row);
    return modal;
  },

  // Modal factory for JSON input
  buildJsonModal(customId, label, placeholder, currentValue = "{}") {
    const modal = new ModalBuilder().setCustomId(customId).setTitle(label);
    const input = new TextInputBuilder()
      .setCustomId("json")
      .setLabel(label)
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder(placeholder)
      .setRequired(true)
      .setValue(String(currentValue));
    const row = new ActionRowBuilder().addComponents(input);
    modal.addComponents(row);
    return modal;
  },

  // Build rich "Control Panel" embed from live state
  buildControlPanelEmbed({ guild, vc, doc, presence, bannedCount = 0, now = new Date() }) {
    const ownerMention = doc?.ownerId ? `<@${doc.ownerId}>` : "None";
    const members = Array.from(vc?.members?.values() || []).map(m => `• ${m.displayName}`).slice(0, 15);
    const memberCount = vc?.members?.size || 0;
    const limit = doc?.state?.userLimit ?? vc?.userLimit ?? null;

    const settingsLines = [
      `Bitrate: ${fmtBitrate(vc?.bitrate)}`,
      `Region: ${fmtRegion(vc?.rtcRegion)}`,
      `Status: ${fmtBoolIcon(!(doc?.state?.locked))}`,
      `Visibility: ${fmtVisible(true)}`,
    ];

    const statsLines = [
      `Peak Members: ${Math.max(memberCount, doc?.presence?.peakMembers || memberCount || 0)}`,
      `Uptime: ${Math.max(0, Math.floor(((now - new Date(doc?.createdAt || now)) / 1000))) }s`,
      `Last Updated: ${"just now"}`,
    ];

    const permLines = [
      `Banned: ${bannedCount} user(s)`,
    ];

    const description = [
      `Owner: ${ownerMention}`,
      `Members: ${memberCount}/${fmtLimit(limit)}`,
      ``,
      `Use the buttons below to manage this voice channel`,
      ``,
      `🧰 Channel Settings`,
      ...settingsLines,
      ``,
      `👥 Current Members`,
      ...(members.length ? members : ["• None"]),
      ``,
      `📈 Statistics`,
      ...statsLines,
      ``,
      `🔒 Permissions`,
      ...permLines,
      ``,
      `This message will update automatically when the channel changes`,
    ].join("\n");

    const titleName = `${vc?.name || "Temp VC"} — Control Panel`;

    return new EmbedBuilder()
      .setTitle(titleName)
      .setDescription(description.slice(0, 4096))
      .setColor(0x5865f2);
  },

  // Single action router select, matches screenshots
  buildActionRouter(channelId) {
    // Note: Discord validates emoji in select options strictly. Use basic Unicode emoji characters only.
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${ids.ui.selectPrefix}action:${channelId}`)
      .setPlaceholder("Select an action...")
      .addOptions(
        { label: "Rename Channel", value: "rename", description: "Change the channel name", emoji: "✏️" },
        { label: "Set User Limit", value: "limit", description: "Change the user limit", emoji: "👥" },
        { label: "Change Bitrate", value: "bitrate", description: "Adjust audio quality", emoji: "🎶" }, // simpler emoji
        { label: "Change Region", value: "region", description: "Set voice region", emoji: "🌎" }, // basic globe
        { label: "Lock Channel", value: "lock", description: "Prevent others from joining", emoji: "🔒" },
        { label: "Unlock Channel", value: "unlock", description: "Allow others to join", emoji: "🔓" },
        { label: "Hide Channel", value: "hide", description: "Hide channel from others", emoji: "🙈" }, // avoid ZWJ/VS
        { label: "Show Channel", value: "show", description: "Make channel visible", emoji: "👁️" },
        { label: "Kick Member", value: "kick", description: "Remove someone from the channel", emoji: "🦶" }, // boot alternative
        { label: "Ban Member", value: "ban", description: "Ban someone from joining the channel", emoji: "🔨" },
        { label: "Unban Member", value: "unban", description: "Unban someone from the channel", emoji: "🔓" },
        { label: "Transfer Ownership", value: "transfer", description: "Transfer channel ownership", emoji: "👑" },
        { label: "Reset to Defaults", value: "reset", description: "Reset all settings and clear bans", emoji: "♻️" }, // recycle
        { label: "Delete Channel", value: "delete", description: "Permanently delete this channel", emoji: "🗑️" },
      );
    return new ActionRowBuilder().addComponents(select);
  },

  // VC Owner Panel builder (embed + single action select)
  vcOwnerPanel(doc, ctx) {
    const guild = ctx.client.guilds.cache.get(doc.guildId) || null;
    const vc = guild?.channels?.cache?.get(doc._id) || null;
    const embed = this.buildControlPanelEmbed({ guild, vc, doc, bannedCount: (doc?.state?.bannedUserIds || []).length, now: new Date() });
    const actionRow = this.buildActionRouter(doc._id);
    return { embeds: [embed], components: [actionRow] };
  },
};
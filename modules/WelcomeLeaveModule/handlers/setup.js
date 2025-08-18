// WelcomeLeaveModule setup command and interactive UI
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  EmbedBuilder,
} from "discord.js";
import { getGuildSettings, upsertGuildSettings, defaultSettings } from "../services/settingsService.js";
import { PLACEHOLDERS as ALL_PLACEHOLDERS } from "../utils/placeholders.js";

const MODULE = "welcomeleave";

// Register the /welcome-leave-setup slash command and handler
export function registerSetupCommand(ctx) {
  const { logger, commands, interactions, lifecycle } = ctx;

  // Define the slash command using v2.createInteractionCommand if available, else fallback
  let command;
  if (ctx.v2 && typeof ctx.v2.createInteractionCommand === "function") {
    command = ctx.v2.createInteractionCommand()
      .setName("welcome-leave-setup")
      .setDescription(
        (ctx.i18n?.t && typeof ctx.i18n.t("welcomeleave:setup_desc") === "string" && ctx.i18n.t("welcomeleave:setup_desc").trim())
          ? ctx.i18n.t("welcomeleave:setup_desc")
          : "Open the Welcome/Leave module setup panel for this server."
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString());
    // Log the full command JSON for debugging
    try {
      logger.debug("[WelcomeLeave] v2 command JSON (fixed BigInt)", { json: command.toJSON ? command.toJSON() : command });
    } catch (e) {
      logger.warn("[WelcomeLeave] Could not stringify v2 command", { error: e?.message });
    }
    ctx.v2.register(command, MODULE);
  } else {
    // Fallback to legacy registration
    const data = new SlashCommandBuilder()
      .setName("welcome-leave-setup")
      .setDescription(
        (ctx.i18n?.t && typeof ctx.i18n.t("welcomeleave:setup_desc") === "string" && ctx.i18n.t("welcomeleave:setup_desc").trim())
          ? ctx.i18n.t("welcomeleave:setup_desc")
          : "Open the Welcome/Leave module setup panel for this server."
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
    // Log the full command JSON for debugging
    try {
      logger.info("[WelcomeLeave] legacy command JSON", { json: data.toJSON() });
    } catch (e) {
      logger.warn("[WelcomeLeave] Could not stringify legacy command", { error: e?.message });
    }
    commands.registerSlash("welcome-leave-setup", data.toJSON());
  }

  // Register the command handler
  const disposer = commands.onInteractionCreate(MODULE, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "welcome-leave-setup") {
      return;
    }
    try {
      const { assertInGuild, requireManageGuild, _safeReply } = await import("../../tickets/utils/validators.js");
      assertInGuild(interaction);
      requireManageGuild(interaction);

      await showSetupPanel(ctx, interaction);
      logger.info("[WelcomeLeave] /welcome-leave-setup panel opened", { guildId: interaction.guildId, user: interaction.user.id });
    } catch (err) {
      logger.error("[WelcomeLeave] /welcome-leave-setup handler error", { error: err?.message, stack: err?.stack });
      try {
        const { safeReply } = await import("../../tickets/utils/validators.js");
        await safeReply(interaction, {
          content: (err?.code === "PERM:MANAGE_GUILD"
            ? (ctx.i18n?.t
              ? ctx.i18n.t("welcomeleave:perm_required", "Manage Server permission required.")
              : "Manage Server permission required.")
            : (ctx.i18n?.t
              ? ctx.i18n.t("welcomeleave:setup_error", "An error occurred while opening the setup panel.")
              : "An error occurred while opening the setup panel.")),
          ephemeral: true,
        });
      } catch (err) { void err; }
    }
  });

  // Register interaction handlers for all setup UI components
  const disposers = [
    // Welcome enable/disable toggle
    interactions.registerButton(MODULE, "welcomeleave:toggle:welcome", async (interaction) => {
      await handleToggle(ctx, interaction, "welcome");
    }),
    // Leave enable/disable toggle
    interactions.registerButton(MODULE, "welcomeleave:toggle:leave", async (interaction) => {
      await handleToggle(ctx, interaction, "leave");
    }),
    // Welcome channel select
    interactions.registerSelect(MODULE, "welcomeleave:select:welcome_channel", async (interaction) => {
      await handleChannelSelect(ctx, interaction, "welcome");
    }),
    // Leave channel select
    interactions.registerSelect(MODULE, "welcomeleave:select:leave_channel", async (interaction) => {
      await handleChannelSelect(ctx, interaction, "leave");
    }),
    // Welcome embed config stub
    interactions.registerButton(MODULE, "welcomeleave:config:welcome_embed", async (interaction) => {
      await handleEmbedConfigBuilder(ctx, interaction, "welcome");
    }),
    // Leave embed config
    interactions.registerButton(MODULE, "welcomeleave:config:leave_embed", async (interaction) => {
      await handleEmbedConfigBuilder(ctx, interaction, "leave");
    }),
    // Save & exit
    interactions.registerButton(MODULE, "welcomeleave:save_exit", async (interaction) => {
      await handleSaveExit(ctx, interaction);
    }),
  ];

  // Register a catch-all handler for builder buttons (fixes lost handler after reload)
  disposers.push(
    interactions.registerButton(MODULE, /^welcomeleave:builder:[a-z_]+$/, async (interaction) => {
      await handleEmbedBuilderButton(ctx, interaction);
    })
  );
  // Persistent handler for cancel button (works even if collector is not active)
  disposers.push(
    interactions.registerButton(MODULE, "welcomeleave:builder:cancel", async (interaction) => {
      const { i18n } = ctx;
      // Defensive: always reply, even if collector is not active
      await interaction.reply(
        getSafeReplyOptions({
          content: i18n?.t
            ? i18n.t("welcomeleave:builder_cancelled", "Embed builder cancelled. No changes saved.")
            : "Embed builder cancelled. No changes saved.",
          ephemeral: true,
        })
      );
      // Optionally, show the setup panel again
      await showSetupPanel(ctx, interaction);
    })
  );

  // Track disposers for hot-reload
  lifecycle.addDisposable(() => {
    try { disposer?.(); } catch (err) { void err; }
    for (const d of disposers) { try { d?.(); } catch (err) { void err; } }
  });

  return () => {
    try { disposer?.(); } catch (err) { void err; }
    for (const d of disposers) { try { d?.(); } catch (err) { void err; } }
  };
}

export { registerSetupCommand as registerSetupCommandCompat };

// Top-level handler for builder buttons (routes to builder logic)
async function handleEmbedBuilderButton(ctx, interaction) {
  // Try to recover the type ("welcome" or "leave") from the interaction context
  // Fallback to "welcome" if not available
  let type = "welcome";
  try {
    // Try to get the type from the message embed title or footer
    const embeds = interaction.message?.embeds || [];
    for (const embed of embeds) {
      if (embed.title && /leave/i.test(embed.title)) {
        type = "leave";
        break;
      }
    }
  } catch (err) { void err; }
  // Call the builder with the recovered type
  await handleEmbedConfigBuilder(ctx, interaction, type);
}

// Helper: Show the main setup panel
async function showSetupPanel(ctx, interaction) {
  const settings = await getGuildSettings(ctx, interaction.guildId);

    // Build fields array and log for debugging
    const fields = [
      {
        name:
          (typeof ctx.i18n?.t === "function" &&
            ctx.i18n.t("welcomeleave:welcome_status", "Welcome Message") &&
            ctx.i18n.t("welcomeleave:welcome_status", "Welcome Message").trim()) ||
          "Welcome Message",
        value:
          ((settings.welcome.enabled
            ? ((typeof ctx.i18n?.t === "function" &&
                ctx.i18n.t("welcomeleave:enabled", "Enabled") &&
                ctx.i18n.t("welcomeleave:enabled", "Enabled").trim()) ||
              "Enabled")
            : ((typeof ctx.i18n?.t === "function" &&
                ctx.i18n.t("welcomeleave:disabled", "Disabled") &&
                ctx.i18n.t("welcomeleave:disabled", "Disabled").trim()) ||
              "Disabled")) +
            "\n" +
            (settings.welcome.channelId
              ? `<#${settings.welcome.channelId}>`
              : ((typeof ctx.i18n?.t === "function" &&
                  ctx.i18n.t("welcomeleave:no_channel", "No channel set") &&
                  ctx.i18n.t("welcomeleave:no_channel", "No channel set").trim()) ||
                "No channel set"))),
        inline: false,
      },
      {
        name:
          (typeof ctx.i18n?.t === "function" &&
            ctx.i18n.t("welcomeleave:leave_status", "Leave Message") &&
            ctx.i18n.t("welcomeleave:leave_status", "Leave Message").trim()) ||
          "Leave Message",
        value:
          ((settings.leave.enabled
            ? ((typeof ctx.i18n?.t === "function" &&
                ctx.i18n.t("welcomeleave:enabled", "Enabled") &&
                ctx.i18n.t("welcomeleave:enabled", "Enabled").trim()) ||
              "Enabled")
            : ((typeof ctx.i18n?.t === "function" &&
                ctx.i18n.t("welcomeleave:disabled", "Disabled") &&
                ctx.i18n.t("welcomeleave:disabled", "Disabled").trim()) ||
              "Disabled")) +
            "\n" +
            (settings.leave.channelId
              ? `<#${settings.leave.channelId}>`
              : ((typeof ctx.i18n?.t === "function" &&
                  ctx.i18n.t("welcomeleave:no_channel", "No channel set") &&
                  ctx.i18n.t("welcomeleave:no_channel", "No channel set").trim()) ||
                "No channel set"))),
        inline: false,
      }
    ];
    ctx.logger.debug("[WelcomeLeave] setup panel embed fields", { fields });

    const embed = new EmbedBuilder()
      .setTitle(
        (ctx.i18n?.t && typeof ctx.i18n.t("welcomeleave:setup_title") === "string" && ctx.i18n.t("welcomeleave:setup_title").trim())
          ? ctx.i18n.t("welcomeleave:setup_title")
          : "Welcome/Leave — Module Setup"
      )
      .setDescription(
        (ctx.i18n?.t && typeof ctx.i18n.t("welcomeleave:setup_desc_long") === "string" && ctx.i18n.t("welcomeleave:setup_desc_long").trim())
          ? ctx.i18n.t("welcomeleave:setup_desc_long")
          : "Configure welcome and leave messages for this server. Use the toggles and selectors below to enable/disable messages, choose channels, and customize embeds."
      )
      .setColor(0x2f3136)
      .addFields(...fields);

  // Row 1: Welcome enable/disable toggle, embed config
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("welcomeleave:toggle:welcome")
      .setLabel(
        settings.welcome.enabled
          ? (
              (typeof ctx.i18n?.t === "function" &&
                ctx.i18n.t("welcomeleave:disable_welcome", "Disable Welcome") &&
                ctx.i18n.t("welcomeleave:disable_welcome", "Disable Welcome").trim()) ||
              "Disable Welcome"
            )
          : (
              (typeof ctx.i18n?.t === "function" &&
                ctx.i18n.t("welcomeleave:enable_welcome", "Enable Welcome") &&
                ctx.i18n.t("welcomeleave:enable_welcome", "Enable Welcome").trim()) ||
              "Enable Welcome"
            )
      )
      .setStyle(settings.welcome.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("welcomeleave:config:welcome_embed")
      .setLabel(
        (typeof ctx.i18n?.t === "function" &&
          ctx.i18n.t("welcomeleave:config_welcome_embed", "Configure Welcome Embed") &&
          ctx.i18n.t("welcomeleave:config_welcome_embed", "Configure Welcome Embed").trim()) ||
        "Configure Welcome Embed"
      )
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 2: Welcome channel select
  const row2 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("welcomeleave:select:welcome_channel")
      .setPlaceholder(
        (typeof ctx.i18n?.t === "function" &&
          ctx.i18n.t("welcomeleave:select_welcome_channel", "Select Welcome Channel") &&
          ctx.i18n.t("welcomeleave:select_welcome_channel", "Select Welcome Channel").trim()) ||
        "Select Welcome Channel"
      )
      .addChannelTypes(0) // 0 = GuildText
  );

  // Row 3: Leave enable/disable toggle, embed config
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("welcomeleave:toggle:leave")
      .setLabel(
        settings.leave.enabled
          ? (
              (typeof ctx.i18n?.t === "function" &&
                ctx.i18n.t("welcomeleave:disable_leave", "Disable Leave") &&
                ctx.i18n.t("welcomeleave:disable_leave", "Disable Leave").trim()) ||
              "Disable Leave"
            )
          : (
              (typeof ctx.i18n?.t === "function" &&
                ctx.i18n.t("welcomeleave:enable_leave", "Enable Leave") &&
                ctx.i18n.t("welcomeleave:enable_leave", "Enable Leave").trim()) ||
              "Enable Leave"
            )
      )
      .setStyle(settings.leave.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("welcomeleave:config:leave_embed")
      .setLabel(
        (typeof ctx.i18n?.t === "function" &&
          ctx.i18n.t("welcomeleave:config_leave_embed", "Configure Leave Embed") &&
          ctx.i18n.t("welcomeleave:config_leave_embed", "Configure Leave Embed").trim()) ||
        "Configure Leave Embed"
      )
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 4: Leave channel select
  const row4 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("welcomeleave:select:leave_channel")
      .setPlaceholder(
        (typeof ctx.i18n?.t === "function" &&
          ctx.i18n.t("welcomeleave:select_leave_channel", "Select Leave Channel") &&
          ctx.i18n.t("welcomeleave:select_leave_channel", "Select Leave Channel").trim()) ||
        "Select Leave Channel"
      )
      .addChannelTypes(0) // 0 = GuildText
  );

  // Row 5: Save & Exit
  const row5 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("welcomeleave:save_exit")
      .setLabel(
        (typeof ctx.i18n?.t === "function" &&
          ctx.i18n.t("welcomeleave:save_exit", "Save & Exit") &&
          ctx.i18n.t("welcomeleave:save_exit", "Save & Exit").trim()) ||
        "Save & Exit"
      )
      .setStyle(ButtonStyle.Primary)
  );

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ embeds: [embed], components: [row1, row2, row3, row4, row5], ephemeral: true });
  } else {
    await interaction.reply({ embeds: [embed], components: [row1, row2, row3, row4, row5], ephemeral: true });
  }
}

// Handler: Toggle welcome/leave enabled
async function handleToggle(ctx, interaction, type) {
  const { logger, i18n } = ctx;
  try {
    const { assertInGuild, requireManageGuild, safeReply } = await import("../../tickets/utils/validators.js");
    assertInGuild(interaction);
    requireManageGuild(interaction);

    const settings = await getGuildSettings(ctx, interaction.guildId);
    const current = settings[type]?.enabled ?? false;
    const patch = {};
    patch[type] = { ...settings[type], enabled: !current };

    await upsertGuildSettings(ctx, interaction.guildId, patch);
    logger.info(`[WelcomeLeave] ${type} toggled`, { guildId: interaction.guildId, user: interaction.user.id, enabled: !current });

    // Defensive: Always provide a non-empty message
    let toggledMsg =
      (typeof i18n?.t === "function" &&
        i18n.t(`welcomeleave:${type}_toggled`, `${type === "welcome" ? "Welcome" : "Leave"} message ${!current ? "enabled" : "disabled"}.`) &&
        i18n.t(`welcomeleave:${type}_toggled`, `${type === "welcome" ? "Welcome" : "Leave"} message ${!current ? "enabled" : "disabled"}.`).trim()) ||
      `${type === "welcome" ? "Welcome" : "Leave"} message ${!current ? "enabled" : "disabled"}.`;

    if (!toggledMsg || !toggledMsg.trim()) {
      toggledMsg = `${type === "welcome" ? "Welcome" : "Leave"} message ${!current ? "enabled" : "disabled"}.`;
    }

    await safeReply(interaction, {
      content: toggledMsg,
      ephemeral: true,
    });
    await showSetupPanel(ctx, interaction);
  } catch (err) {
    logger.error(`[WelcomeLeave] ${type} toggle error`, { error: err?.message, stack: err?.stack });
    try {
      const { safeReply } = await import("../../tickets/utils/validators.js");
      await safeReply(interaction, {
        content: i18n?.t
          ? i18n.t("welcomeleave:toggle_error", "Failed to toggle setting.")
          : "Failed to toggle setting.",
        ephemeral: true,
      });
    } catch (err) { void err; }
  }
}

// Handler: Channel select for welcome/leave
async function handleChannelSelect(ctx, interaction, type) {
  const { logger, i18n } = ctx;
  try {
    const { assertInGuild, requireManageGuild, safeReply } = await import("../../tickets/utils/validators.js");
    assertInGuild(interaction);
    requireManageGuild(interaction);

    const channelId = interaction.values?.[0];
    if (!channelId) throw new Error("No channel selected");

    const settings = await getGuildSettings(ctx, interaction.guildId);
    const patch = {};
    patch[type] = { ...settings[type], channelId };

    await upsertGuildSettings(ctx, interaction.guildId, patch);
    logger.info(`[WelcomeLeave] ${type} channel set`, { guildId: interaction.guildId, user: interaction.user.id, channelId });

    // Always reply with a non-empty message using getSafeReplyOptions
    await safeReply(
      interaction,
      getSafeReplyOptions({
        content: i18n?.t
          ? i18n.t(`welcomeleave:${type}_channel_set`, `${type === "welcome" ? "Welcome" : "Leave"} channel set.`)
          : `${type === "welcome" ? "Welcome" : "Leave"} channel set.`,
        ephemeral: true,
      })
    );
    await showSetupPanel(ctx, interaction);
  } catch (err) {
    logger.error(`[WelcomeLeave] ${type} channel select error`, { error: err?.message, stack: err?.stack });
    try {
      const { safeReply } = await import("../../tickets/utils/validators.js");
      await safeReply(interaction, {
        content: i18n?.t
          ? i18n.t("welcomeleave:channel_set_error", "Failed to set channel.")
          : "Failed to set channel.",
        ephemeral: true,
      });
    } catch (err) { void err; }
  }
}

// Handler: Stub for embed config
/**
 * Interactive embed builder flow for Welcome/Leave messages.
 * @param {object} ctx - Core context
 * @param {object} interaction - Discord interaction
 * @param {string} type - "welcome" or "leave"
 */
// --- BEGIN: Shared helpers for all handlers ---
// Utility: Validate HTTP/HTTPS URL
function isValidUrl(url) {
  if (typeof url !== "string" || !url.trim()) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
// Recursively sanitize embed for Discord API, always return plain object
function sanitizeEmbedForDiscord(embed) {
  if (!embed || typeof embed !== "object") return embed;
  // If EmbedBuilder instance, use toJSON
  let e;
  if (typeof embed.toJSON === "function") {
    e = embed.toJSON();
  } else if (embed.data) {
    e = { ...embed.data };
  } else {
    e = { ...embed };
  }
  // Helper: remove if contains unresolved placeholder
  function hasPlaceholder(val) {
    return typeof val === "string" && (val.includes("{") || val.includes("}"));
  }
  // Sanitize author.icon_url
  if (e.author && e.author.icon_url) {
    if (!isValidUrl(e.author.icon_url) || hasPlaceholder(e.author.icon_url)) delete e.author.icon_url;
  }
  if (e.author && Object.keys(e.author).length === 0) delete e.author;
  // Sanitize footer.icon_url
  if (e.footer && e.footer.icon_url) {
    if (!isValidUrl(e.footer.icon_url) || hasPlaceholder(e.footer.icon_url)) delete e.footer.icon_url;
  }
  if (e.footer && Object.keys(e.footer).length === 0) delete e.footer;
  // Sanitize image.url
  if (e.image && e.image.url && (!isValidUrl(e.image.url) || hasPlaceholder(e.image.url))) delete e.image.url;
  if (e.image && Object.keys(e.image).length === 0) delete e.image;
  // Sanitize thumbnail.url
  if (e.thumbnail && e.thumbnail.url && (!isValidUrl(e.thumbnail.url) || hasPlaceholder(e.thumbnail.url))) delete e.thumbnail.url;
  if (e.thumbnail && Object.keys(e.thumbnail).length === 0) delete e.thumbnail;
  // Sanitize fields
  if (Array.isArray(e.fields)) {
    e.fields = e.fields.filter(
      f =>
        typeof f.name === "string" &&
        f.name.trim().length > 0 &&
        typeof f.value === "string" &&
        f.value.trim().length > 0
    );
  }
  return e;
}
// Always provide a non-empty message for Discord
function getSafeReplyOptions({ content, embeds, components, ephemeral }) {
  // Remove empty embeds and sanitize, always return plain objects
  const validEmbeds = (embeds || [])
    .filter(
      e =>
        e &&
        (typeof e.data?.description === "string" ? e.data.description.trim().length > 0 : true) &&
        (typeof e.data?.title === "string" ? e.data.title.trim().length > 0 : true) &&
        (Array.isArray(e.data?.fields) ? e.data.fields.length > 0 : true)
    )
    .map(sanitizeEmbedForDiscord);
  let safeContent = typeof content === "string" ? content : "";
  // If both content and embeds are empty, provide a fallback
  if ((!safeContent || !safeContent.trim()) && validEmbeds.length === 0) {
    safeContent = "Embed updated.";
  }
  // DEBUG: Log outgoing embeds for diagnostics
  //logger.debug("Outgoing embeds to Discord:", JSON.stringify(validEmbeds, null, 2));
  return {
    content: safeContent,
    embeds: validEmbeds,
    components,
    ephemeral,
  };
}
// --- END: Shared helpers for all handlers ---

async function handleEmbedConfigBuilder(ctx, interaction, type) {
  const { logger, i18n } = ctx;
  try {
    const { assertInGuild, requireManageGuild, safeReply } = await import("../../tickets/utils/validators.js");
    assertInGuild(interaction);
    requireManageGuild(interaction);

    logger.info(`[WelcomeLeave] ${type} embed builder launched`, { guildId: interaction.guildId, user: interaction.user.id });

    // Import builder utilities
    const { row } = await import("../../embedbuilder/utils/components.js");
    const { toDiscordEmbed } = await import("../../embedbuilder/utils/preview.js");
    const { validate } = await import("../../embedbuilder/utils/schema.js");
    const { getGuildSettings, upsertGuildSettings } = await import("../services/settingsService.js");

    // Placeholders for help field (dynamically imported from utils/placeholders.js)
    // ALL_PLACEHOLDERS is imported at the top and contains all supported placeholders.

    // State per interaction (ephemeral, in-memory)
    let draft = {};
    const settings = await getGuildSettings(ctx, interaction.guildId);
    draft = settings[type]?.embed
      ? { ...settings[type].embed }
      : {
          title: "",
          description: "",
          color: null,
          url: "",
          thumbnail: "",
          image: "",
          footerText: "",
          footerIcon: "",
          authorName: "",
          authorIcon: "",
          authorUrl: "",
          fields: [],
        };

    // Utility: Validate HTTP/HTTPS URL
    const isValidUrl = (url) => {
      if (typeof url !== "string" || !url.trim()) return false;
      try {
        const u = new URL(url);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    };

    // Sanitize embed image-related fields and resolve {server.icon}
    const _sanitizeEmbedImages = (embed, guild) => {
      // Helper to resolve {server.icon}
      const resolveServerIcon = (url) => {
        if (url === "{server.icon}" && guild && typeof guild.iconURL === "function") {
          return guild.iconURL({ extension: "png", size: 512 });
        }
        return url;
      };
      if (embed.image && embed.image.url) {
        embed.image.url = resolveServerIcon(embed.image.url);
        if (!isValidUrl(embed.image.url)) embed.image.url = undefined;
      }
      if (embed.thumbnail && embed.thumbnail.url) {
        embed.thumbnail.url = resolveServerIcon(embed.thumbnail.url);
        if (!isValidUrl(embed.thumbnail.url)) embed.thumbnail.url = undefined;
      }
      if (embed.footer && embed.footer.icon_url) {
        embed.footer.icon_url = resolveServerIcon(embed.footer.icon_url);
        if (!isValidUrl(embed.footer.icon_url)) embed.footer.icon_url = undefined;
      }
      if (embed.author && embed.author.icon_url) {
        embed.author.icon_url = resolveServerIcon(embed.author.icon_url);
        if (!isValidUrl(embed.author.icon_url)) embed.author.icon_url = undefined;
      }
      return embed;
    }

  // Helper to build the embed preview
  const buildPreview = (draft) => {
      // Defensive: ensure all image-related fields are objects with a valid url property
      const normalized = { ...draft };
      if (typeof normalized.image === "string" && normalized.image.trim()) {
        normalized.image = { url: normalized.image.trim() };
      }
      if (typeof normalized.thumbnail === "string" && normalized.thumbnail.trim()) {
        normalized.thumbnail = { url: normalized.thumbnail.trim() };
      }
      if (typeof normalized.footerIcon === "string" && normalized.footerIcon.trim()) {
        normalized.footer = normalized.footer || {};
        normalized.footer.icon_url = normalized.footerIcon.trim();
      }
      if (typeof normalized.authorIcon === "string" && normalized.authorIcon.trim()) {
        normalized.author = normalized.author || {};
        normalized.author.icon_url = normalized.authorIcon.trim();
      }
      // Remove empty image/thumbnail/footerIcon/authorIcon fields
      if (typeof normalized.image === "string" && !normalized.image.trim()) delete normalized.image;
      if (typeof normalized.thumbnail === "string" && !normalized.thumbnail.trim()) delete normalized.thumbnail;
      if (typeof normalized.footerIcon === "string" && !normalized.footerIcon.trim()) delete normalized.footerIcon;
      if (typeof normalized.authorIcon === "string" && !normalized.authorIcon.trim()) delete normalized.authorIcon;

      const embed = toDiscordEmbed(normalized);
      // Defensive: filter out any invalid fields
      embed.fields = (embed.fields || []).filter(
        f =>
          typeof f.name === "string" &&
          f.name.trim().length > 0 &&
          typeof f.value === "string" &&
          f.value.trim().length > 0
      );
      // --- Patch: Always resolve {server.icon} for preview embed before sending ---
      const resolveServerIcon = (url) => {
        if (url === "{server.icon}" && interaction.guild && typeof interaction.guild.iconURL === "function") {
          const icon = interaction.guild.iconURL({ extension: "png", size: 512 });
          // Only return if it's a valid URL, else undefined
          if (icon && isValidUrl(icon)) return icon;
          // Optionally, fallback to Discord logo or nothing
          // return "https://cdn.discordapp.com/embed/avatars/0.png";
          return undefined;
        }
        return url;
      };
      if (embed.image && embed.image.url) {
        embed.image.url = resolveServerIcon(embed.image.url);
        if (!isValidUrl(embed.image.url)) embed.image.url = undefined;
      }
      if (embed.thumbnail && embed.thumbnail.url) {
        embed.thumbnail.url = resolveServerIcon(embed.thumbnail.url);
        if (!isValidUrl(embed.thumbnail.url)) embed.thumbnail.url = undefined;
      }
      if (embed.footer && embed.footer.icon_url) {
        embed.footer.icon_url = resolveServerIcon(embed.footer.icon_url);
        if (!isValidUrl(embed.footer.icon_url)) delete embed.footer.icon_url;
        if (
          typeof embed.footer.icon_url !== "string" ||
          !embed.footer.icon_url ||
          !isValidUrl(embed.footer.icon_url)
        ) {
          delete embed.footer.icon_url;
        }
      }
      if (embed.footer && Object.keys(embed.footer).length === 0) {
        delete embed.footer;
      }
      if (embed.author && embed.author.icon_url) {
        embed.author.icon_url = resolveServerIcon(embed.author.icon_url);
        if (!isValidUrl(embed.author.icon_url)) delete embed.author.icon_url;
        if (
          typeof embed.author.icon_url !== "string" ||
          !embed.author.icon_url ||
          !isValidUrl(embed.author.icon_url)
        ) {
          delete embed.author.icon_url;
        }
      }
      if (embed.author && Object.keys(embed.author).length === 0) {
        delete embed.author;
      }
      if (embed.image && embed.image.url && !isValidUrl(embed.image.url)) {
        delete embed.image.url;
      }
      if (embed.thumbnail && embed.thumbnail.url && !isValidUrl(embed.thumbnail.url)) {
        delete embed.thumbnail.url;
      }
      // DEBUG: Log outgoing embed for diagnostics
      // logger.debug("Outgoing preview embed:", JSON.stringify(embed, null, 2));
      return embed;
    }

    // (Removed duplicate buildPreview definition to fix redeclaration error)

    // Helper to build the placeholder embed
    const buildPlaceholderEmbed = () => {
      return new EmbedBuilder()
        .setTitle(
          (typeof i18n?.t === "function" &&
            i18n.t("welcomeleave:embed_placeholders", "Available Placeholders") &&
            i18n.t("welcomeleave:embed_placeholders", "Available Placeholders").trim()) ||
          "Available Placeholders"
        )
        .setDescription(
          ALL_PLACEHOLDERS
            .map(ph => `\`${ph.key}\``)
            .join(" ") +
          "\n\n" +
          ((typeof i18n?.t === "function" &&
            i18n.t(
              "welcomeleave:embed_placeholders_note",
              "You can use these placeholders in any text field, except image related placeholders, they can only be used in thumbnail or image field."
            ))
            || "You can use these placeholders in any text field, except image related placeholders, they can only be used in thumbnail or image field.")
        )
        .setColor(0x5865f2);
    }

    // Helper to build the action rows
    const buildRows = () => {
      return [
        row([
          new ButtonBuilder()
            .setCustomId("welcomeleave:builder:title")
            .setLabel(
              (typeof i18n?.t === "function" &&
                i18n.t("welcomeleave:builder_title", "Title") &&
                i18n.t("welcomeleave:builder_title", "Title").trim()) ||
              "Title"
            )
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("welcomeleave:builder:description")
            .setLabel(
              (typeof i18n?.t === "function" &&
                i18n.t("welcomeleave:builder_description", "Description") &&
                i18n.t("welcomeleave:builder_description", "Description").trim()) ||
              "Description"
            )
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("welcomeleave:builder:color")
            .setLabel(
              (typeof i18n?.t === "function" &&
                i18n.t("welcomeleave:builder_color", "Color") &&
                i18n.t("welcomeleave:builder_color", "Color").trim()) ||
              "Color"
            )
            .setStyle(ButtonStyle.Secondary),
        ]),
        row([
          new ButtonBuilder()
            .setCustomId("welcomeleave:builder:image")
            .setLabel(
              (typeof i18n?.t === "function" &&
                i18n.t("welcomeleave:builder_image", "Image") &&
                i18n.t("welcomeleave:builder_image", "Image").trim()) ||
              "Image"
            )
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("welcomeleave:builder:thumbnail")
            .setLabel(
              (typeof i18n?.t === "function" &&
                i18n.t("welcomeleave:builder_thumbnail", "Thumbnail") &&
                i18n.t("welcomeleave:builder_thumbnail", "Thumbnail").trim()) ||
              "Thumbnail"
            )
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("welcomeleave:builder:footer")
            .setLabel(
              (typeof i18n?.t === "function" &&
                i18n.t("welcomeleave:builder_footer", "Footer") &&
                i18n.t("welcomeleave:builder_footer", "Footer").trim()) ||
              "Footer"
            )
            .setStyle(ButtonStyle.Secondary),
        ]),
        row([
          new ButtonBuilder()
            .setCustomId("welcomeleave:builder:fields")
            .setLabel(
              (typeof i18n?.t === "function" &&
                i18n.t("welcomeleave:builder_fields", "Fields") &&
                i18n.t("welcomeleave:builder_fields", "Fields").trim()) ||
              "Fields"
            )
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("welcomeleave:builder:placeholders")
            .setLabel(
              (typeof i18n?.t === "function" &&
                i18n.t("welcomeleave:builder_placeholders", "Insert Placeholder") &&
                i18n.t("welcomeleave:builder_placeholders", "Insert Placeholder").trim()) ||
              "Insert Placeholder"
            )
            .setStyle(ButtonStyle.Secondary),
        ]),
        row([
          new ButtonBuilder()
            .setCustomId("welcomeleave:builder:back")
            .setLabel(
              (typeof i18n?.t === "function" &&
                i18n.t("welcomeleave:builder_back", "Back") &&
                i18n.t("welcomeleave:builder_back", "Back").trim()) ||
              "Back"
            )
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("welcomeleave:builder:cancel")
            .setLabel(
              (typeof i18n?.t === "function" &&
                i18n.t("welcomeleave:builder_cancel", "Cancel") &&
                i18n.t("welcomeleave:builder_cancel", "Cancel").trim()) ||
              "Cancel"
            )
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId("welcomeleave:builder:save")
            .setLabel(
              (typeof i18n?.t === "function" &&
                i18n.t("welcomeleave:builder_save", "Save") &&
                i18n.t("welcomeleave:builder_save", "Save").trim()) ||
              "Save"
            )
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId("welcomeleave:builder:load_default")
            .setLabel(
              (typeof i18n?.t === "function" &&
                i18n.t("welcomeleave:builder_load_default", "Load Default") &&
                i18n.t("welcomeleave:builder_load_default", "Load Default").trim()) ||
              "Load Default"
            )
            .setStyle(ButtonStyle.Primary),
        ]),
      ];
    }

  // Utility: Ensure at least one of content or embeds is non-empty and valid
  const getSafeReplyOptions = ({ content, embeds, components, ephemeral }) => {
      // Utility: Validate HTTP/HTTPS URL
      const isValidUrl = (url) => {
        if (typeof url !== "string" || !url.trim()) return false;
        try {
          const u = new URL(url);
          return u.protocol === "http:" || u.protocol === "https:";
        } catch {
          return false;
        }
      };
      // Recursively sanitize embed for Discord API, always return plain object
      const sanitizeEmbedForDiscord = (embed) => {
        if (!embed || typeof embed !== "object") return embed;
        // If EmbedBuilder instance, use toJSON
        let e;
        if (typeof embed.toJSON === "function") {
          e = embed.toJSON();
        } else if (embed.data) {
          e = { ...embed.data };
        } else {
          e = { ...embed };
        }
        // Helper: remove if contains unresolved placeholder
        const hasPlaceholder = (val) => typeof val === "string" && (val.includes("{") || val.includes("}"));
        // Sanitize author.icon_url
        if (e.author && e.author.icon_url) {
          if (!isValidUrl(e.author.icon_url) || hasPlaceholder(e.author.icon_url)) delete e.author.icon_url;
        }
        if (e.author && Object.keys(e.author).length === 0) delete e.author;
        // Sanitize footer.icon_url
        if (e.footer && e.footer.icon_url) {
          if (!isValidUrl(e.footer.icon_url) || hasPlaceholder(e.footer.icon_url)) delete e.footer.icon_url;
        }
        if (e.footer && Object.keys(e.footer).length === 0) delete e.footer;
        // Sanitize image.url
        if (e.image && e.image.url && (!isValidUrl(e.image.url) || hasPlaceholder(e.image.url))) delete e.image.url;
        if (e.image && Object.keys(e.image).length === 0) delete e.image;
        // Sanitize thumbnail.url
        if (e.thumbnail && e.thumbnail.url && (!isValidUrl(e.thumbnail.url) || hasPlaceholder(e.thumbnail.url))) delete e.thumbnail.url;
        if (e.thumbnail && Object.keys(e.thumbnail).length === 0) delete e.thumbnail;
        // Sanitize fields
        if (Array.isArray(e.fields)) {
          e.fields = e.fields.filter(
            f =>
              typeof f.name === "string" &&
              f.name.trim().length > 0 &&
              typeof f.value === "string" &&
              f.value.trim().length > 0
          );
        }
        return e;
      };
      // Remove empty embeds and sanitize, always return plain objects
      const validEmbeds = (embeds || [])
        .filter(
          e =>
            e &&
            (typeof e.data?.description === "string" ? e.data.description.trim().length > 0 : true) &&
            (typeof e.data?.title === "string" ? e.data.title.trim().length > 0 : true) &&
            (Array.isArray(e.data?.fields) ? e.data.fields.length > 0 : true)
        )
        .map(sanitizeEmbedForDiscord);
      let safeContent = typeof content === "string" ? content : "";
      // If both content and embeds are empty, provide a fallback
      if ((!safeContent || !safeContent.trim()) && validEmbeds.length === 0) {
        safeContent = "Embed updated.";
      }
      // DEBUG: Log outgoing embeds for diagnostics
      //logger.debug("Outgoing embeds to Discord:", JSON.stringify(validEmbeds, null, 2));
      return {
        content: safeContent,
        embeds: validEmbeds,
        components,
        ephemeral,
      };
    }

    // Initial reply with builder UI
    await interaction.reply(
      getSafeReplyOptions({
        embeds: [buildPlaceholderEmbed(), buildPreview(draft)],
        components: buildRows(),
        ephemeral: true,
      })
    );

    // Set up a collector for button interactions (ephemeral, per user)
    const filter = i => i.user.id === interaction.user.id;
    const collector = interaction.channel.createMessageComponentCollector({
      filter,
      time: 10 * 60 * 1000, // 10 min
    });

    collector.on("collect", async i => {
      try {
        if (i.customId === "welcomeleave:builder:load_default") {
          // Load the default embed for the current type
          const defaults = typeof defaultSettings === "function" ? defaultSettings() : {};
          draft = defaults[type]?.embed ? { ...defaults[type].embed } : {};
          await i.update(
            getSafeReplyOptions({
              embeds: [buildPlaceholderEmbed(), buildPreview(draft)],
              components: buildRows(),
              content: i18n?.t
                ? i18n.t("welcomeleave:builder_loaded_default", "Loaded default embed.")
                : "Loaded default embed.",
              ephemeral: true,
            })
          );
        } else if (i.customId === "welcomeleave:builder:title") {
          // Show modal for description
          const modal = new (await import("discord.js")).ModalBuilder()
            .setCustomId("welcomeleave:builder:description_modal")
            .setTitle(
              (typeof i18n?.t === "function" &&
                i18n.t("welcomeleave:builder_description", "Description") &&
                i18n.t("welcomeleave:builder_description", "Description").trim()) ||
              "Description"
            )
            .addComponents(
              new (await import("discord.js")).ActionRowBuilder().addComponents(
                new (await import("discord.js")).TextInputBuilder()
                  .setCustomId("description")
                  .setLabel(
                    (typeof i18n?.t === "function" &&
                      i18n.t("welcomeleave:builder_description_label", "Embed Description") &&
                      i18n.t("welcomeleave:builder_description_label", "Embed Description").trim()) ||
                    "Embed Description"
                  )
                  .setStyle(2)
                  .setMaxLength(4000)
                  .setRequired(false)
                  .setValue(draft.description || "")
              )
            );
          await i.showModal(modal);
        } else if (i.customId === "welcomeleave:builder:color") {
          // Show modal for color
          const modal = new (await import("discord.js")).ModalBuilder()
            .setCustomId("welcomeleave:builder:color_modal")
            .setTitle(
              (typeof i18n?.t === "function" &&
                i18n.t("welcomeleave:builder_color", "Color") &&
                i18n.t("welcomeleave:builder_color", "Color").trim()) ||
              "Color"
            )
            .addComponents(
              new (await import("discord.js")).ActionRowBuilder().addComponents(
                new (await import("discord.js")).TextInputBuilder()
                  .setCustomId("color")
                  .setLabel(
                    (typeof i18n?.t === "function" &&
                      i18n.t("welcomeleave:builder_color_label", "Hex Color (e.g. #5865F2)") &&
                      i18n.t("welcomeleave:builder_color_label", "Hex Color (e.g. #5865F2)").trim()) ||
                    "Hex Color (e.g. #5865F2)"
                  )
                  .setStyle(1)
                  .setMaxLength(7)
                  .setRequired(false)
                  .setValue(draft.color ? `#${draft.color.toString(16).padStart(6, "0")}` : "")
              )
            );
          await i.showModal(modal);
        } else if (i.customId === "welcomeleave:builder:image") {
          // Show modal for image
          const modal = new (await import("discord.js")).ModalBuilder()
            .setCustomId("welcomeleave:builder:image_modal")
            .setTitle(
              (typeof i18n?.t === "function" &&
                i18n.t("welcomeleave:builder_image", "Image") &&
                i18n.t("welcomeleave:builder_image", "Image").trim()) ||
              "Image"
            )
            .addComponents(
              new (await import("discord.js")).ActionRowBuilder().addComponents(
                new (await import("discord.js")).TextInputBuilder()
                  .setCustomId("image")
                  .setLabel(
                    (typeof i18n?.t === "function" &&
                      i18n.t("welcomeleave:builder_image_label", "Image URL") &&
                      i18n.t("welcomeleave:builder_image_label", "Image URL").trim()) ||
                    "Image URL"
                  )
                  .setStyle(1)
                  .setRequired(false)
                  .setValue(draft.image || "")
              )
            );
          await i.showModal(modal);
        } else if (i.customId === "welcomeleave:builder:thumbnail") {
          // Show modal for thumbnail
          const modal = new (await import("discord.js")).ModalBuilder()
            .setCustomId("welcomeleave:builder:thumbnail_modal")
            .setTitle(
              (typeof i18n?.t === "function" &&
                i18n.t("welcomeleave:builder_thumbnail", "Thumbnail") &&
                i18n.t("welcomeleave:builder_thumbnail", "Thumbnail").trim()) ||
              "Thumbnail"
            )
            .addComponents(
              new (await import("discord.js")).ActionRowBuilder().addComponents(
                new (await import("discord.js")).TextInputBuilder()
                  .setCustomId("thumbnail")
                  .setLabel(
                    (typeof i18n?.t === "function" &&
                      i18n.t("welcomeleave:builder_thumbnail_label", "Thumbnail URL") &&
                      i18n.t("welcomeleave:builder_thumbnail_label", "Thumbnail URL").trim()) ||
                    "Thumbnail URL"
                  )
                  .setStyle(1)
                  .setRequired(false)
                  .setValue(draft.thumbnail || "")
              )
            );
          await i.showModal(modal);
        } else if (i.customId === "welcomeleave:builder:footer") {
          // Show modal for footer
          const modal = new (await import("discord.js")).ModalBuilder()
            .setCustomId("welcomeleave:builder:footer_modal")
            .setTitle(
              (typeof i18n?.t === "function" &&
                i18n.t("welcomeleave:builder_footer", "Footer") &&
                i18n.t("welcomeleave:builder_footer", "Footer").trim()) ||
              "Footer"
            )
            .addComponents(
              new (await import("discord.js")).ActionRowBuilder().addComponents(
                new (await import("discord.js")).TextInputBuilder()
                  .setCustomId("footerText")
                  .setLabel(
                    (typeof i18n?.t === "function" &&
                      i18n.t("welcomeleave:builder_footer_text", "Footer Text") &&
                      i18n.t("welcomeleave:builder_footer_text", "Footer Text").trim()) ||
                    "Footer Text"
                  )
                  .setStyle(1)
                  .setMaxLength(2048)
                  .setRequired(false)
                  .setValue(draft.footerText || "")
              ),
              new (await import("discord.js")).ActionRowBuilder().addComponents(
                new (await import("discord.js")).TextInputBuilder()
                  .setCustomId("footerIcon")
                  .setLabel(
                    (typeof i18n?.t === "function" &&
                      i18n.t("welcomeleave:builder_footer_icon", "Footer Icon URL") &&
                      i18n.t("welcomeleave:builder_footer_icon", "Footer Icon URL").trim()) ||
                    "Footer Icon URL"
                  )
                  .setStyle(1)
                  .setRequired(false)
                  .setValue(draft.footerIcon || "")
              )
            );
          await i.showModal(modal);
        } else if (i.customId === "welcomeleave:builder:fields") {
          // Show modal to add a single field
          const modal = new (await import("discord.js")).ModalBuilder()
            .setCustomId("welcomeleave:builder:field_modal")
            .setTitle(
              (typeof i18n?.t === "function" &&
                i18n.t("welcomeleave:builder_field_modal_title", "Add Embed Field") &&
                i18n.t("welcomeleave:builder_field_modal_title", "Add Embed Field").trim()) ||
              "Add Embed Field"
            )
            .addComponents(
              new (await import("discord.js")).ActionRowBuilder().addComponents(
                new (await import("discord.js")).TextInputBuilder()
                  .setCustomId("field_name")
                  .setLabel(
                    (typeof i18n?.t === "function" &&
                      i18n.t("welcomeleave:builder_field_name", "Field Name") &&
                      i18n.t("welcomeleave:builder_field_name", "Field Name").trim()) ||
                    "Field Name"
                  )
                  .setStyle(1)
                  .setMaxLength(256)
                  .setRequired(true)
              ),
              new (await import("discord.js")).ActionRowBuilder().addComponents(
                new (await import("discord.js")).TextInputBuilder()
                  .setCustomId("field_value")
                  .setLabel(
                    (typeof i18n?.t === "function" &&
                      i18n.t("welcomeleave:builder_field_value", "Field Value") &&
                      i18n.t("welcomeleave:builder_field_value", "Field Value").trim()) ||
                    "Field Value"
                  )
                  .setStyle(2)
                  .setMaxLength(1024)
                  .setRequired(true)
              ),
              new (await import("discord.js")).ActionRowBuilder().addComponents(
                new (await import("discord.js")).TextInputBuilder()
                  .setCustomId("field_inline")
                  .setLabel(
                    (typeof i18n?.t === "function" &&
                      i18n.t("welcomeleave:builder_field_inline", "Inline? (yes/no)") &&
                      i18n.t("welcomeleave:builder_field_inline", "Inline? (yes/no)").trim()) ||
                    "Inline? (yes/no)"
                  )
                  .setStyle(1)
                  .setMaxLength(3)
                  .setRequired(false)
                  .setValue("no")
              )
            );
          await i.showModal(modal);
        } else if (i.customId === "welcomeleave:builder:placeholders") {
          // Insert a placeholder into description (for demo)
          draft.description = (draft.description || "") + " {user}";
          await i.update(
            getSafeReplyOptions({
              embeds: [buildPlaceholderEmbed(), buildPreview(draft)],
              components: buildRows(),
              content: i18n?.t
                ? i18n.t("welcomeleave:builder_placeholder_inserted", "Inserted {user} placeholder into description.")
                : "Inserted {user} placeholder into description.",
              ephemeral: true,
            })
          );
        } else if (i.customId === "welcomeleave:builder:back") {
          // Return to setup panel
          collector.stop("back");
          await showSetupPanel(ctx, interaction);
        } else if (i.customId === "welcomeleave:builder:cancel") {
          // Cancel builder, do not save
          collector.stop("cancel");
          await safeReply(i, {
            content: i18n?.t
              ? i18n.t("welcomeleave:builder_cancelled", "Embed builder cancelled. No changes saved.")
              : "Embed builder cancelled. No changes saved.",
            ephemeral: true,
          });
          await showSetupPanel(ctx, interaction);
        } else if (i.customId === "welcomeleave:builder:save") {
          // Validate and save
          const result = validate(draft);
          if (!result.ok) {
            await i.update(
              getSafeReplyOptions({
                embeds: [buildPlaceholderEmbed(), buildPreview(draft)],
                components: buildRows(),
                content: i18n?.t
                  ? i18n.t("welcomeleave:builder_invalid", "Embed is invalid: {error}", { error: result.error })
                  : `Embed is invalid: ${result.error}`,
                ephemeral: true,
              })
            );
            return;
          }
          // Save to settings
          const patch = {};
          patch[type] = { ...(settings[type] || {}), embed: result.embed };
          await upsertGuildSettings(ctx, interaction.guildId, patch);
          logger.info(`[WelcomeLeave] ${type} embed saved`, { guildId: interaction.guildId, user: interaction.user.id });
          collector.stop("save");
          await safeReply(
            i,
            getSafeReplyOptions({
              content: i18n?.t
                ? i18n.t("welcomeleave:builder_saved", "Embed saved successfully.")
                : "Embed saved successfully.",
              ephemeral: true,
            })
          );
          await showSetupPanel(ctx, interaction);
        }
      } catch (err) {
        logger.error(`[WelcomeLeave] embed builder interaction error`, { error: err?.message, stack: err?.stack });
        try {
          await i.reply({
            content: i18n?.t
              ? i18n.t("welcomeleave:builder_error", "An error occurred in the embed builder.")
              : "An error occurred in the embed builder.",
            ephemeral: true,
          });
        } catch (err) { void err; }
      }
    });

    // Modal submit handler
    interaction.client.on("interactionCreate", async modalInt => {
      if (!modalInt.isModalSubmit()) return;
      if (modalInt.user.id !== interaction.user.id) return;
      if (!modalInt.customId.startsWith("welcomeleave:builder:")) return;

      try {
        if (modalInt.customId === "welcomeleave:builder:title_modal") {
          draft.title = modalInt.fields.getTextInputValue("title") || "";
        } else if (modalInt.customId === "welcomeleave:builder:description_modal") {
          draft.description = modalInt.fields.getTextInputValue("description") || "";
        } else if (modalInt.customId === "welcomeleave:builder:color_modal") {
          const colorVal = modalInt.fields.getTextInputValue("color") || "";
          draft.color = colorVal.startsWith("#") ? parseInt(colorVal.slice(1), 16) : null;
        } else if (modalInt.customId === "welcomeleave:builder:image_modal") {
          draft.image = modalInt.fields.getTextInputValue("image") || "";
        } else if (modalInt.customId === "welcomeleave:builder:thumbnail_modal") {
          draft.thumbnail = modalInt.fields.getTextInputValue("thumbnail") || "";
        } else if (modalInt.customId === "welcomeleave:builder:footer_modal") {
          draft.footerText = modalInt.fields.getTextInputValue("footerText") || "";
          draft.footerIcon = modalInt.fields.getTextInputValue("footerIcon") || "";
        } else if (modalInt.customId === "welcomeleave:builder:field_modal") {
          // Add a new field to the embed
          const name = modalInt.fields.getTextInputValue("field_name") || "";
          const value = modalInt.fields.getTextInputValue("field_value") || "";
          const inlineRaw = modalInt.fields.getTextInputValue("field_inline") || "no";
          const inline = /^y(es)?$/i.test(inlineRaw.trim());
          if (!draft.fields) draft.fields = [];
          draft.fields.push({ name, value, inline });
        }
        await modalInt.reply(
          getSafeReplyOptions({
            embeds: [buildPlaceholderEmbed(), buildPreview(draft)],
            components: buildRows(),
            content: i18n?.t
              ? i18n.t("welcomeleave:builder_updated", "Embed updated.")
              : "Embed updated.",
            ephemeral: true,
          })
        );
      } catch (err) {
        logger.error(`[WelcomeLeave] embed builder modal error`, { error: err?.message, stack: err?.stack });
        try {
          await modalInt.reply({
            content: i18n?.t
              ? i18n.t("welcomeleave:builder_modal_error", "An error occurred updating the embed.")
              : "An error occurred updating the embed.",
            ephemeral: true,
          });
        } catch (err) { void err; }
      }
    });

    collector.on("end", async (_collected, reason) => {
      if (reason !== "save" && reason !== "back" && reason !== "cancel") {
        try {
          await safeReply(interaction, {
            content: i18n?.t
              ? i18n.t("welcomeleave:builder_timeout", "Embed builder timed out. No changes saved.")
              : "Embed builder timed out. No changes saved.",
            ephemeral: true,
          });
          await showSetupPanel(ctx, interaction);
        } catch (err) { void err; }
      }
    });
  } catch (err) {
    logger.error(`[WelcomeLeave] ${type} embed builder error`, { error: err?.message, stack: err?.stack });
    try {
      const { safeReply } = await import("../../tickets/utils/validators.js");
      await safeReply(interaction, {
        content: i18n?.t
          ? i18n.t("welcomeleave:embed_config_error", "Failed to open embed config.")
          : "Failed to open embed config.",
        ephemeral: true,
      });
    } catch (err) { void err; }
  }
}

// Handler: Save & Exit
async function handleSaveExit(ctx, interaction) {
  const { logger, i18n } = ctx;
  try {
    const { assertInGuild, requireManageGuild, safeReply } = await import("../../tickets/utils/validators.js");
    assertInGuild(interaction);
    requireManageGuild(interaction);

    logger.info("[WelcomeLeave] settings saved & exited", { guildId: interaction.guildId, user: interaction.user.id });

    await safeReply(interaction, {
      content: i18n?.t
        ? i18n.t("welcomeleave:settings_saved", "Settings saved. You may close this panel.")
        : "Settings saved. You may close this panel.",
      ephemeral: true,
    });
  } catch (err) {
    logger.error("[WelcomeLeave] save & exit error", { error: err?.message, stack: err?.stack });
    try {
      const { safeReply } = await import("../../tickets/utils/validators.js");
      await safeReply(interaction, {
        content: i18n?.t
          ? i18n.t("welcomeleave:save_exit_error", "Failed to save settings.")
          : "Failed to save settings.",
        ephemeral: true,
      });
    } catch (err) { void err; }
  }
}
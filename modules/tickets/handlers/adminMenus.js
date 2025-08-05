 // Admin menus for Tickets module: General Settings, Panels, Types
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} from "discord.js";
import { SetupIds, PanelIds, TypeIds, Prefix } from "../utils/ids.js";
import { getGuildSettings, upsertGuildSettings } from "../services/settingsService.js";
import { listPanels, updatePanel, deletePanel } from "../services/panelService.js";
import { listTypes, createType, updateType, deleteType } from "../services/typeService.js";

/**
 * Registers button/select/modal handlers for:
 * - Set General Settings
 * - Manage Ticket Panels
 * - Manage Ticket Types
 *
 * This file wires the high-level menus and persists general settings.
 * Panels/Types CRUD flows are implemented here for common admin ops.
 */
export async function registerAdminMenus(ctx) {
  const { logger, lifecycle, interactions } = ctx;
  const moduleName = "tickets";
  const disposers = [];

  if (!interactions) {
    logger.warn("[Tickets] interactions registrar not available");
    return () => {};
  }

  // Register setup entry buttons
  disposers.push(
    interactions.registerButton(moduleName, SetupIds.General(), async (interaction) => {
      try {
        const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
        assertInGuild(interaction);
        requireManageGuild(interaction);
        await showGeneralSettings(ctx, interaction);
      } catch (e) {
        const { safeReply } = await import("../utils/validators.js");
        await safeReply(interaction, { content: (e?.code === "PERM:MANAGE_GUILD" ? "You need Manage Server permission to configure Tickets." : "Failed to open settings."), ephemeral: true });
      }
    })
  );

  disposers.push(
    interactions.registerButton(moduleName, SetupIds.Panels(), async (interaction) => {
      try {
        const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
        assertInGuild(interaction);
        requireManageGuild(interaction);
        await showPanelsMenu(ctx, interaction);
      } catch (e) {
        const { safeReply } = await import("../utils/validators.js");
        await safeReply(interaction, { content: (e?.code === "PERM:MANAGE_GUILD" ? "You need Manage Server permission to manage panels." : "Failed to open panels menu."), ephemeral: true });
      }
    })
  );

  disposers.push(
    interactions.registerButton(moduleName, SetupIds.Types(), async (interaction) => {
      try {
        const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
        assertInGuild(interaction);
        requireManageGuild(interaction);
        await showTypesMenu(ctx, interaction);
      } catch (e) {
        const { safeReply } = await import("../utils/validators.js");
        await safeReply(interaction, { content: (e?.code === "PERM:MANAGE_GUILD" ? "You need Manage Server permission to manage ticket types." : "Failed to open types menu."), ephemeral: true });
      }
    })
  );

  // General settings dynamic components
  disposers.push(
    interactions.registerSelect(moduleName, "tickets:general:selectCategory", async (interaction) => {
      try {
        const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
        assertInGuild(interaction); requireManageGuild(interaction);
        const guildId = interaction.guildId;
        const categoryId = interaction.values?.[0];
        await upsertGuildSettings(ctx, guildId, { ticketCategoryId: categoryId });
        await safeReply(interaction, { content: "Ticket category saved.", ephemeral: true });
      } catch (e) {
        const { safeReply } = await import("../utils/validators.js");
        await safeReply(interaction, { content: "Failed to save category.", ephemeral: true });
      }
    })
  );

  disposers.push(
    interactions.registerSelect(moduleName, "tickets:general:selectLog", async (interaction) => {
      try {
        const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
        assertInGuild(interaction); requireManageGuild(interaction);
        const guildId = interaction.guildId;
        const channelId = interaction.values?.[0];
        await upsertGuildSettings(ctx, guildId, { ticketLogChannelId: channelId });
        await safeReply(interaction, { content: "Ticket log channel saved.", ephemeral: true });
      } catch {
        const { safeReply } = await import("../utils/validators.js");
        await safeReply(interaction, { content: "Failed to save log channel.", ephemeral: true });
      }
    })
  );

  disposers.push(
    interactions.registerSelect(moduleName, "tickets:general:selectRoles", async (interaction) => {
      try {
        const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
        assertInGuild(interaction); requireManageGuild(interaction);
        const guildId = interaction.guildId;
        const roleIds = interaction.values || [];
        await upsertGuildSettings(ctx, guildId, { supportRoleIds: roleIds });
        await safeReply(interaction, { content: "Support roles saved.", ephemeral: true });
      } catch {
        const { safeReply } = await import("../utils/validators.js");
        await safeReply(interaction, { content: "Failed to save support roles.", ephemeral: true });
      }
    })
  );

  // Transcript options modal
  disposers.push(
    interactions.registerButton(moduleName, "tickets:general:transcript", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);

        // Encode non-ephemeral source message id when available for future-proofing
        const srcId = interaction.message?.id && interaction.channelId ? `:MSG_${interaction.message.id}` : "";

        const modal = new ModalBuilder()
          .setCustomId("tickets:general:transcriptModal" + srcId)
          .setTitle("Transcript Options");

        const format = new TextInputBuilder()
          .setCustomId("format")
          .setLabel("Format (html|text)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("html");

        const dm = new TextInputBuilder()
          .setCustomId("dmUser")
          .setLabel("DM transcript to user? (true|false)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("true");

        modal.addComponents(
          new ActionRowBuilder().addComponents(format),
          new ActionRowBuilder().addComponents(dm)
        );
        await interaction.showModal(modal);
        logger.debug?.("[Tickets] showModal", { module: "tickets", page: "general", field: "transcript", cid: interaction.customId, srcId: interaction.message?.id || null });
      } catch (e) {
        await safeReply(interaction, { content: "Cannot open transcript options.", ephemeral: true });
      }
    })
  );

  // Simplified: Always followUp "Successfully updated" then refresh UI; never attempt to edit ephemeral parents directly
  disposers.push(
    interactions.registerModal(moduleName, "tickets:general:transcriptModal", async (interaction) => {
      const { assertInGuild, requireManageGuild } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);

        const format = interaction.fields.getTextInputValue("format")?.trim()?.toLowerCase();
        const dm = interaction.fields.getTextInputValue("dmUser")?.trim()?.toLowerCase();
        const patch = { transcript: {} };
        if (format === "html" || format === "text") patch.transcript.format = format;
        if (dm === "true" || dm === "false") patch.transcript.dmUser = dm === "true";
        await upsertGuildSettings(ctx, interaction.guildId, patch);

        // Always followUp success to avoid any "Something went wrong" from modal contexts
        try { await interaction.followUp?.({ content: "Successfully updated.", ephemeral: true }); } catch { try { await interaction.reply({ content: "Successfully updated.", ephemeral: true }); } catch {} }

        // Refresh admin panel as fresh ephemeral
        try { await showGeneralSettings(ctx, interaction); } catch {}

      } catch (e) {
        try { await interaction.followUp?.({ content: "Failed to save transcript options.", ephemeral: true }); } catch { try { await interaction.reply({ content: "Failed to save transcript options.", ephemeral: true }); } catch {} }
      }
    }, { prefix: true })
  );

  // Ticket name format modal
  disposers.push(
    interactions.registerButton(moduleName, "tickets:general:nameFormat", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);

        const srcId = interaction.message?.id && interaction.channelId ? `:MSG_${interaction.message.id}` : "";

        const modal = new ModalBuilder()
          .setCustomId("tickets:general:nameFormatModal" + srcId)
          .setTitle("Ticket Name Format");

        const fmt = new TextInputBuilder()
          .setCustomId("format")
          .setLabel("Format string")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("ticket-{userid}-{shortdate}");

        const help = new TextInputBuilder()
          .setCustomId("help")
          .setLabel("Placeholders (read-only)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue("{username},{user_tag},{userid},{type},{count},{date},{time},{shortdate},{timestamp},{server},{channel_id},{ticket_id}")
          .setPlaceholder("See description")
          .setMaxLength(400);

        modal.addComponents(
          new ActionRowBuilder().addComponents(fmt),
          new ActionRowBuilder().addComponents(help),
        );
        await interaction.showModal(modal);
        logger.debug?.("[Tickets] showModal", { module: "tickets", page: "general", field: "nameFormat", cid: interaction.customId, srcId: interaction.message?.id || null });
      } catch {
        await safeReply(interaction, { content: "Cannot open ticket name format modal.", ephemeral: true });
      }
    })
  );

  disposers.push(
    interactions.registerModal(moduleName, "tickets:general:nameFormatModal", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);

        let sourceMessageId = null;
        try {
          const m = String(interaction.customId || "").match(/:MSG_(\d+)/);
          sourceMessageId = m?.[1] || null;
        } catch {}

        const format = interaction.fields.getTextInputValue("format")?.trim();
        const patch = {};
        if (format) patch.ticketNameFormat = format.slice(0, 200);
        await upsertGuildSettings(ctx, interaction.guildId, patch);

        // Ack
        const msg = `Ticket name format ${format ? "saved" : "cleared to default"}.`;
        if (!interaction.replied && !interaction.deferred) {
          try { await interaction.reply({ content: msg, ephemeral: true }); } catch {}
        } else {
          try { await interaction.followUp?.({ content: msg, ephemeral: true }); } catch {}
        }

        // Re-render general settings ephemeral
        try {
          await showGeneralSettings(ctx, interaction);
        } catch (e2) {
          logger.debug?.("[Tickets] general:nameFormatModal follow-up render failed", { error: e2?.message });
        }

        // Try editing non-ephemeral parent if available
        if (sourceMessageId) {
          try {
            const ch = await interaction.client.channels.fetch(interaction.channelId).catch(() => null);
            const srcMsg = await ch?.messages?.fetch?.(sourceMessageId).catch(() => null);
            if (srcMsg?.editable) {
              const settings = await getGuildSettings(ctx, interaction.guildId);
              const embed = new EmbedBuilder()
                .setTitle("Tickets — General Settings")
                .setColor(0x2f3136)
                .setDescription("Configure ticket category, log channel, support roles, transcripts, auto-closure, and naming format.")
                .addFields(
                  { name: "Ticket Category", value: settings.ticketCategoryId ? `<#${settings.ticketCategoryId}>` : "Not set", inline: true },
                  { name: "Log Channel", value: settings.ticketLogChannelId ? `<#${settings.ticketLogChannelId}>` : "Not set", inline: true },
                  { name: "Support Roles", value: (settings.supportRoleIds?.map(id => `<@&${id}>`).join(", ") || "None"), inline: false },
                  { name: "Transcript", value: `Format: ${settings.transcript.format} • DM: ${settings.transcript.dmUser ? "yes" : "no"}`, inline: true },
                  { name: "Auto-Closure", value: `Inactive: ${settings.autoClosure.inactivityMs} ms • Warning: ${settings.autoClosure.warningMs} ms`, inline: true },
                  { name: "Ticket Name Format", value: `\`${settings.ticketNameFormat || "ticket-{userid}-{shortdate}"}\`\nPlaceholders: {username},{user_tag},{userid},{type},{count},{date},{time},{shortdate},{timestamp},{server},{channel_id},{ticket_id}`, inline: false },
                );
              const rows = [];
              rows.push(new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder().setCustomId("tickets:general:selectCategory").setPlaceholder("Select Ticket Category").addChannelTypes(ChannelType.GuildCategory)
              ));
              rows.push(new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder().setCustomId("tickets:general:selectLog").setPlaceholder("Select Log Channel").addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread)
              ));
              rows.push(new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder().setCustomId("tickets:general:selectRoles").setPlaceholder("Select Support Roles")
              ));
              rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("tickets:general:transcript").setLabel("Transcript Options").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId("tickets:general:autoClose").setLabel("Auto-Closure Settings").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId("tickets:general:nameFormat").setLabel("Ticket Name Format").setStyle(ButtonStyle.Secondary),
              ));
              await srcMsg.edit({ embeds: [embed], components: rows });
            }
          } catch (eFetch) {
            logger.debug?.("[Tickets] nameFormatModal: fetch/edit source failed", { error: eFetch?.message });
          }
        }
      } catch {
        await safeReply(interaction, { content: "Failed to save ticket name format.", ephemeral: true });
      }
    }, { prefix: true })
  );

  // Auto-closure options modal
  disposers.push(
    interactions.registerButton(moduleName, "tickets:general:autoClose", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);

        const srcId = interaction.message?.id && interaction.channelId ? `:MSG_${interaction.message.id}` : "";

        const modal = new ModalBuilder()
          .setCustomId("tickets:general:autoCloseModal" + srcId)
          .setTitle("Auto-Closure Settings");

        const inactivity = new TextInputBuilder()
          .setCustomId("inactivityMs")
          .setLabel("Inactivity (ms)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("172800000")
          .setRequired(false);

        const warning = new TextInputBuilder()
          .setCustomId("warningMs")
          .setLabel("Warning lead (ms)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("43200000")
          .setRequired(false);

        const message = new TextInputBuilder()
          .setCustomId("warningMessage")
          .setLabel("Warning message")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("This ticket will be closed due to inactivity. Reply to keep it open.")
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(inactivity),
          new ActionRowBuilder().addComponents(warning),
          new ActionRowBuilder().addComponents(message),
        );

        await interaction.showModal(modal);
        logger.debug?.("[Tickets] showModal", { module: "tickets", page: "general", field: "autoClose", cid: interaction.customId, srcId: interaction.message?.id || null });
      } catch {
        await safeReply(interaction, { content: "Cannot open auto-closure settings.", ephemeral: true });
      }
    })
  );

  disposers.push(
    interactions.registerModal(moduleName, "tickets:general:autoCloseModal", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);

        let sourceMessageId = null;
        try {
          const m = String(interaction.customId || "").match(/:MSG_(\d+)/);
          sourceMessageId = m?.[1] || null;
        } catch {}

        const inactivityMs = interaction.fields.getTextInputValue("inactivityMs")?.trim();
        const warningMs = interaction.fields.getTextInputValue("warningMs")?.trim();
        const warningMessage = interaction.fields.getTextInputValue("warningMessage")?.trim();

        const patch = { autoClosure: {} };
        if (inactivityMs) patch.autoClosure.inactivityMs = Number(inactivityMs);
        if (warningMs) patch.autoClosure.warningMs = Number(warningMs);
        if (warningMessage) patch.autoClosure.warningMessage = warningMessage;

        await upsertGuildSettings(ctx, interaction.guildId, patch);

        // Ack
        if (!interaction.replied && !interaction.deferred) {
          try { await interaction.reply({ content: "Auto-closure settings saved.", ephemeral: true }); } catch {}
        } else {
          try { await interaction.followUp?.({ content: "Auto-closure settings saved.", ephemeral: true }); } catch {}
        }

        // Re-render general settings ephemeral
        try {
          await showGeneralSettings(ctx, interaction);
        } catch (e2) {
          logger.debug?.("[Tickets] general:autoCloseModal follow-up render failed", { error: e2?.message });
        }

        // Try editing non-ephemeral parent if available
        if (sourceMessageId) {
          try {
            const ch = await interaction.client.channels.fetch(interaction.channelId).catch(() => null);
            const srcMsg = await ch?.messages?.fetch?.(sourceMessageId).catch(() => null);
            if (srcMsg?.editable) {
              const settings = await getGuildSettings(ctx, interaction.guildId);
              const embed = new EmbedBuilder()
                .setTitle("Tickets — General Settings")
                .setColor(0x2f3136)
                .setDescription("Configure ticket category, log channel, support roles, transcripts, auto-closure, and naming format.")
                .addFields(
                  { name: "Ticket Category", value: settings.ticketCategoryId ? `<#${settings.ticketCategoryId}>` : "Not set", inline: true },
                  { name: "Log Channel", value: settings.ticketLogChannelId ? `<#${settings.ticketLogChannelId}>` : "Not set", inline: true },
                  { name: "Support Roles", value: (settings.supportRoleIds?.map(id => `<@&${id}>`).join(", ") || "None"), inline: false },
                  { name: "Transcript", value: `Format: ${settings.transcript.format} • DM: ${settings.transcript.dmUser ? "yes" : "no"}`, inline: true },
                  { name: "Auto-Closure", value: `Inactive: ${settings.autoClosure.inactivityMs} ms • Warning: ${settings.autoClosure.warningMs} ms`, inline: true },
                  { name: "Ticket Name Format", value: `\`${settings.ticketNameFormat || "ticket-{userid}-{shortdate}"}\`\nPlaceholders: {username},{user_tag},{userid},{type},{count},{date},{time},{shortdate},{timestamp},{server},{channel_id},{ticket_id}`, inline: false },
                );
              const rows = [];
              rows.push(new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder().setCustomId("tickets:general:selectCategory").setPlaceholder("Select Ticket Category").addChannelTypes(ChannelType.GuildCategory)
              ));
              rows.push(new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder().setCustomId("tickets:general:selectLog").setPlaceholder("Select Log Channel").addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread)
              ));
              rows.push(new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder().setCustomId("tickets:general:selectRoles").setPlaceholder("Select Support Roles")
              ));
              rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("tickets:general:transcript").setLabel("Transcript Options").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId("tickets:general:autoClose").setLabel("Auto-Closure Settings").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId("tickets:general:nameFormat").setLabel("Ticket Name Format").setStyle(ButtonStyle.Secondary),
              ));
              await srcMsg.edit({ embeds: [embed], components: rows });
            }
          } catch (eFetch) {
            logger.debug?.("[Tickets] autoCloseModal: fetch/edit source failed", { error: eFetch?.message });
          }
        }
      } catch {
        await safeReply(interaction, { content: "Failed to save auto-closure settings.", ephemeral: true });
      }
    }, { prefix: true })
  );

  // Panels: edit/delete flows
  disposers.push(
    interactions.registerButton(moduleName, "tickets:panel:editOpen", async (interaction) => {
      try {
        const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
        assertInGuild(interaction); requireManageGuild(interaction);
        const panels = await listPanels(ctx, interaction.guildId);
        if (!panels.length) return safeReply(interaction, { content: "No panels found.", ephemeral: true });

      const options = panels.slice(0, 25).map((p) => ({
        label: `${p.embed?.title || "Panel"} • ${p.panelId}`,
        description: `#${p.channelId} • msg ${p.messageId}`,
        value: p.panelId,
      }));

      const embed = new EmbedBuilder().setTitle("Edit Panel").setDescription("Select a panel to edit.").setColor(0x2f3136);
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId("tickets:panel:edit:select").setPlaceholder("Select a panel").addOptions(options)
      );
      await safeReply(interaction, { embeds: [embed], components: [row], ephemeral: true });
      } catch (e) {
        const { safeReply } = await import("../utils/validators.js");
        await safeReply(interaction, { content: "Failed to open edit menu.", ephemeral: true });
      }
    })
  );

  disposers.push(
    interactions.registerSelect(moduleName, "tickets:panel:edit:select", async (interaction) => {
      try {
        const { assertInGuild, requireManageGuild } = await import("../utils/validators.js");
        assertInGuild(interaction); requireManageGuild(interaction);
        const panelId = interaction.values?.[0];
        const modal = new ModalBuilder().setCustomId(`tickets:panel:edit:${panelId}`).setTitle("Edit Panel");
        const title = new TextInputBuilder().setCustomId("title").setLabel("Embed Title").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100);
        const desc = new TextInputBuilder().setCustomId("description").setLabel("Embed Description").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000);
        const button = new TextInputBuilder().setCustomId("buttonLabel").setLabel("Button Label").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80);
        modal.addComponents(new ActionRowBuilder().addComponents(title), new ActionRowBuilder().addComponents(desc), new ActionRowBuilder().addComponents(button));
        await interaction.showModal(modal);
      } catch {
        const { safeReply } = await import("../utils/validators.js");
        await safeReply(interaction, { content: "Cannot open edit modal.", ephemeral: true });
      }
    })
  );

  disposers.push(
    interactions.registerModal(moduleName, "tickets:panel:edit:", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const [, , , , panelId] = interaction.customId.split(":"); // tickets:panel:edit:{panelId}
        const patch = {};
        const title = interaction.fields.getTextInputValue("title")?.trim();
        const desc = interaction.fields.getTextInputValue("description")?.trim();
        const buttonLabel = interaction.fields.getTextInputValue("buttonLabel")?.trim();
        if (title || desc) patch.embed = { ...(title && { title }), ...(desc && { description: desc }) };
        if (buttonLabel) patch.buttons = [{ label: buttonLabel, style: "Primary" }];
        await updatePanel(ctx, interaction.guildId, panelId, patch);
        try {
          const { sendLog } = await import("../services/loggingService.js");
          await sendLog(ctx, interaction.guildId, {
            title: "Panel Updated",
            description: `Updated by <@${interaction.user.id}>`,
            color: 0x5865f2,
            fields: [
              { name: "Panel ID", value: panelId, inline: true },
              ...(title ? [{ name: "Embed Title", value: title.slice(0, 100), inline: true }] : []),
              ...(desc ? [{ name: "Embed Description", value: desc.slice(0, 150), inline: false }] : []),
              ...(buttonLabel ? [{ name: "Buttons", value: `Set 1 button: "${buttonLabel.slice(0,80)}"`, inline: false }] : []),
            ]
          });
        } catch {}
        await safeReply(interaction, { content: "Panel updated.", ephemeral: true });
      } catch {
        await safeReply(interaction, { content: "Failed to update panel.", ephemeral: true });
      }
    }, { prefix: true })
  );

  disposers.push(
    interactions.registerButton(moduleName, "tickets:panel:deleteOpen", async (interaction) => {
      try {
        const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
        assertInGuild(interaction); requireManageGuild(interaction);
        const panels = await listPanels(ctx, interaction.guildId);
        if (!panels.length) return safeReply(interaction, { content: "No panels to delete.", ephemeral: true });

      const options = panels.slice(0, 25).map((p) => ({ label: `${p.embed?.title || "Panel"} • ${p.panelId}`, value: p.panelId }));
      const embed = new EmbedBuilder().setTitle("Delete Panel").setDescription("Select a panel to delete.").setColor(0xed4245);
      const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("tickets:panel:delete:select").setPlaceholder("Select a panel").addOptions(options));
      await safeReply(interaction, { embeds: [embed], components: [row], ephemeral: true });
      } catch {
        const { safeReply } = await import("../utils/validators.js");
        await safeReply(interaction, { content: "Failed to open delete menu.", ephemeral: true });
      }
    })
  );

  disposers.push(
    interactions.registerSelect(moduleName, "tickets:panel:delete:select", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const panelId = interaction.values?.[0];
        await deletePanel(ctx, interaction.guildId, panelId);
        await safeReply(interaction, { content: "Panel deleted.", ephemeral: true });
      } catch {
        await safeReply(interaction, { content: "Failed to delete panel.", ephemeral: true });
      }
    })
  );

  // Types: create/edit/delete flows
  disposers.push(
    interactions.registerButton(moduleName, TypeIds.Create(), async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const modal = new ModalBuilder().setCustomId("tickets:type:createModal").setTitle("Create Type");
        const name = new TextInputBuilder().setCustomId("name").setLabel("Type Name").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);
        const welcome = new TextInputBuilder().setCustomId("welcome").setLabel("Welcome Message").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000);
        modal.addComponents(new ActionRowBuilder().addComponents(name), new ActionRowBuilder().addComponents(welcome));
        await interaction.showModal(modal);
      } catch {
        await safeReply(interaction, { content: "Cannot open create type modal.", ephemeral: true });
      }
    })
  );

  disposers.push(
    interactions.registerModal(moduleName, "tickets:type:createModal", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const name = interaction.fields.getTextInputValue("name")?.trim();
        const welcomeMessage = interaction.fields.getTextInputValue("welcome")?.trim();
        const doc = await createType(ctx, interaction.guildId, { name, welcomeMessage, pingRoleIds: [] });
        try {
          const { sendLog } = await import("../services/loggingService.js");
          await sendLog(ctx, interaction.guildId, {
            title: "Type Created",
            description: `Created by <@${interaction.user.id}>`,
            color: 0x57f287,
            fields: [
              { name: "Type", value: `${doc.name}`, inline: true },
              { name: "Type ID", value: `${doc.typeId}`, inline: true }
            ]
          });
        } catch {}
        await safeReply(interaction, { content: `Type created: ${doc.name} (${doc.typeId})`, ephemeral: true });
      } catch {
        await safeReply(interaction, { content: "Failed to create type.", ephemeral: true });
      }
    })
  );

  // Types: Edit flow (now includes ping role configuration)
  disposers.push(
    interactions.registerButton(moduleName, "tickets:type:editOpen", async (interaction) => {
      try {
        const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
        assertInGuild(interaction); requireManageGuild(interaction);
        const types = await listTypes(ctx, interaction.guildId);
        if (!types.length) return safeReply(interaction, { content: "No types found.", ephemeral: true });
      const options = types.slice(0, 25).map((t) => ({ label: `${t.name}`, description: t.typeId, value: t.typeId }));
      const embed = new EmbedBuilder().setTitle("Edit Type").setDescription("Select a type to edit or configure ping roles.").setColor(0x2f3136);
      const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("tickets:type:edit:select").setPlaceholder("Select a type").addOptions(options));
      await safeReply(interaction, { embeds: [embed], components: [row], ephemeral: true });
      } catch {
        const { safeReply } = await import("../utils/validators.js");
        await safeReply(interaction, { content: "Failed to open type edit.", ephemeral: true });
      }
    })
  );

  // After selecting a type to edit, offer two actions: edit fields (name/welcome) or set ping roles
  disposers.push(
    interactions.registerSelect(moduleName, "tickets:type:edit:select", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const typeId = interaction.values?.[0];
        const embed = new EmbedBuilder().setTitle("Edit Type").setDescription("Choose what to edit for this type.").setColor(0x2f3136);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`tickets:type:editFields:${typeId}`).setLabel("Edit Name/Welcome").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`tickets:type:setPings:${typeId}`).setLabel("Configure Ping Roles").setStyle(ButtonStyle.Secondary),
        );
        await safeReply(interaction, { embeds: [embed], components: [row], ephemeral: true });
      } catch {
        await safeReply(interaction, { content: "Failed to show type edit options.", ephemeral: true });
      }
    })
  );

  // Open modal for editing name/welcome
  disposers.push(
    interactions.registerButton(moduleName, "tickets:type:editFields:", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const [, , , , typeId] = interaction.customId.split(":"); // tickets:type:editFields:{typeId}
        const modal = new ModalBuilder().setCustomId(`tickets:type:edit:${typeId}`).setTitle("Edit Type");
        const name = new TextInputBuilder().setCustomId("name").setLabel("Type Name").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100);
        const welcome = new TextInputBuilder().setCustomId("welcome").setLabel("Welcome Message").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000);
        modal.addComponents(new ActionRowBuilder().addComponents(name), new ActionRowBuilder().addComponents(welcome));
        await interaction.showModal(modal);
      } catch {
        await safeReply(interaction, { content: "Cannot open edit fields modal.", ephemeral: true });
      }
    }, { prefix: true })
  );

  // RoleSelect to configure ping roles for a type
  disposers.push(
    interactions.registerButton(moduleName, "tickets:type:setPings:", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const [, , , , typeId] = interaction.customId.split(":"); // tickets:type:setPings:{typeId}
        const row = new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder()
            .setCustomId(`tickets:type:setPingsSelect:${typeId}`)
            .setPlaceholder("Select ping roles for this type")
        );
        await safeReply(interaction, { content: "Select roles to ping when this type is used.", components: [row], ephemeral: true });
      } catch {
        await safeReply(interaction, { content: "Cannot open ping role selector.", ephemeral: true });
      }
    }, { prefix: true })
  );

  // Persist ping role selection
  disposers.push(
    interactions.registerSelect(moduleName, "tickets:type:setPingsSelect:", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const [, , , , state] = interaction.customId.split(":"); // tickets:type:setPingsSelect:{typeId}
        const roleIds = interaction.values || [];
        const { setTypePingRoles } = await import("../services/typeService.js");
        await setTypePingRoles(ctx, interaction.guildId, state, roleIds);
        try {
          const { sendLog } = await import("../services/loggingService.js");
          await sendLog(ctx, interaction.guildId, {
            title: "Type Ping Roles Updated",
            description: `Updated by <@${interaction.user.id}>`,
            color: 0x5865f2,
            fields: [
              { name: "Type ID", value: state, inline: true },
              { name: "Roles", value: (roleIds.length ? roleIds.map(r => `<@&${r}>`).join(", ") : "None"), inline: false }
            ]
          });
        } catch {}
        await safeReply(interaction, { content: "Type ping roles saved.", ephemeral: true });
      } catch (e) {
        await safeReply(interaction, { content: "Failed to save ping roles.", ephemeral: true });
      }
    }, { prefix: true })
  );

  disposers.push(
    interactions.registerModal(moduleName, "tickets:type:edit:", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const [, , , , typeId] = interaction.customId.split(":"); // tickets:type:edit:{typeId}
        const name = interaction.fields.getTextInputValue("name")?.trim();
        const welcomeMessage = interaction.fields.getTextInputValue("welcome")?.trim();
        const patch = {};
        if (name) patch.name = name;
        if (welcomeMessage) patch.welcomeMessage = welcomeMessage;
        const doc = await updateType(ctx, interaction.guildId, typeId, patch);
        try {
          const { sendLog } = await import("../services/loggingService.js");
          await sendLog(ctx, interaction.guildId, {
            title: "Type Updated",
            description: `Updated by <@${interaction.user.id}>`,
            color: 0x5865f2,
            fields: [
              { name: "Type ID", value: `${typeId}`, inline: true },
              ...(name ? [{ name: "Name", value: `${doc?.name || name}`, inline: true }] : []),
              ...(welcomeMessage ? [{ name: "Welcome", value: `${(welcomeMessage || "").slice(0, 100)}`, inline: false }] : []),
            ]
          });
        } catch {}
        await safeReply(interaction, { content: "Type updated.", ephemeral: true });
      } catch {
        await safeReply(interaction, { content: "Failed to update type.", ephemeral: true });
      }
    }, { prefix: true })
  );

  disposers.push(
    interactions.registerButton(moduleName, "tickets:type:deleteOpen", async (interaction) => {
      try {
        const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
        assertInGuild(interaction); requireManageGuild(interaction);
        const types = await listTypes(ctx, interaction.guildId);
        if (!types.length) return safeReply(interaction, { content: "No types to delete.", ephemeral: true });
      const options = types.slice(0, 25).map((t) => ({ label: `${t.name}`, description: t.typeId, value: t.typeId }));
      const embed = new EmbedBuilder().setTitle("Delete Type").setDescription("Select a type to delete.").setColor(0xed4245);
      const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("tickets:type:delete:select").setPlaceholder("Select a type").addOptions(options));
      await safeReply(interaction, { embeds: [embed], components: [row], ephemeral: true });
      } catch {
        const { safeReply } = await import("../utils/validators.js");
        await safeReply(interaction, { content: "Failed to open delete type menu.", ephemeral: true });
      }
    })
  );

  disposers.push(
    interactions.registerSelect(moduleName, "tickets:type:delete:select", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const typeId = interaction.values?.[0];
        await deleteType(ctx, interaction.guildId, typeId);
        try {
          const { sendLog } = await import("../services/loggingService.js");
          await sendLog(ctx, interaction.guildId, {
            title: "Type Deleted",
            description: `Deleted by <@${interaction.user.id}>`,
            color: 0xed4245,
            fields: [{ name: "Type ID", value: `${typeId}`, inline: true }]
          });
        } catch {}
        await safeReply(interaction, { content: "Type deleted.", ephemeral: true });
      } catch {
        await safeReply(interaction, { content: "Failed to delete type.", ephemeral: true });
      }
    })
  );

  lifecycle.addDisposable(() => {
    for (const d of disposers) { try { d?.(); } catch {} }
  });

  return () => {
    for (const d of disposers) { try { d?.(); } catch {} }
  };
}

async function showGeneralSettings(ctx, interaction) {
  const settings = await getGuildSettings(ctx, interaction.guildId);

  const embed = new EmbedBuilder()
    .setTitle("Tickets — General Settings")
    .setColor(0x2f3136)
    .setDescription("Configure ticket category, log channel, support roles, transcripts, auto-closure, and naming format.")
    .addFields(
      { name: "Ticket Category", value: settings.ticketCategoryId ? `<#${settings.ticketCategoryId}>` : "Not set", inline: true },
      { name: "Log Channel", value: settings.ticketLogChannelId ? `<#${settings.ticketLogChannelId}>` : "Not set", inline: true },
      { name: "Support Roles", value: (settings.supportRoleIds?.map(id => `<@&${id}>`).join(", ") || "None"), inline: false },
      { name: "Transcript", value: `Format: ${settings.transcript.format} • DM: ${settings.transcript.dmUser ? "yes" : "no"}`, inline: true },
      { name: "Auto-Closure", value: `Inactive: ${settings.autoClosure.inactivityMs} ms • Warning: ${settings.autoClosure.warningMs} ms`, inline: true },
      { name: "Ticket Name Format", value: `\`${settings.ticketNameFormat || "ticket-{userid}-{shortdate}"}\`\nPlaceholders: {username},{user_tag},{userid},{type},{count},{date},{time},{shortdate},{timestamp},{server},{channel_id},{ticket_id}`, inline: false },
    );

  const rows = [];

  const row1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("tickets:general:selectCategory")
      .setPlaceholder("Select Ticket Category")
      .addChannelTypes(ChannelType.GuildCategory)
  );
  rows.push(row1);

  const row2 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("tickets:general:selectLog")
      .setPlaceholder("Select Log Channel")
      .addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread)
  );
  rows.push(row2);

  const row3 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("tickets:general:selectRoles")
      .setPlaceholder("Select Support Roles")
  );
  rows.push(row3);

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("tickets:general:transcript")
      .setLabel("Transcript Options")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("tickets:general:autoClose")
      .setLabel("Auto-Closure Settings")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("tickets:general:nameFormat")
      .setLabel("Ticket Name Format")
      .setStyle(ButtonStyle.Secondary),
  );
  rows.push(row4);

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ embeds: [embed], components: rows, ephemeral: true });
  } else {
    await interaction.reply({ embeds: [embed], components: rows, ephemeral: true });
  }
}

async function showPanelsMenu(ctx, interaction) {
  const embed = new EmbedBuilder()
    .setTitle("Tickets — Manage Panels")
    .setDescription("Create, edit, delete ticket panels.")
    .setColor(0x2f3136);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(PanelIds.Create()).setLabel("Create Panel").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("tickets:panel:editOpen").setLabel("Edit Panel").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("tickets:panel:deleteOpen").setLabel("Delete Panel").setStyle(ButtonStyle.Danger),
  );

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

async function showTypesMenu(ctx, interaction) {
  const embed = new EmbedBuilder()
    .setTitle("Tickets — Manage Types")
    .setDescription("Create, edit, delete ticket types. Use Edit to also configure ping roles.")
    .setColor(0x2f3136);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(TypeIds.Create()).setLabel("Create Type").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("tickets:type:editOpen").setLabel("Edit Type").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("tickets:type:deleteOpen").setLabel("Delete Type").setStyle(ButtonStyle.Danger),
  );

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}
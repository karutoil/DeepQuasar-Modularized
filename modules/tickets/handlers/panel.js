// Panel handlers: create/edit/delete ticket panels and publish messages
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { PanelIds, TypeIds } from "../utils/ids.js";
import { ensureIndexes as ensurePanelIndexes, createPanel, updatePanel, deletePanel, listPanels, linkMessage } from "../services/panelService.js";
import { listTypes } from "../services/typeService.js";

export async function registerPanelHandlers(ctx) {
  const { logger, lifecycle, client, interactions } = ctx;
  const moduleName = "tickets";
  const disposers = [];

  // Initialize temporary storage for panel creation data
  if (!ctx.tempPanelData) {
    ctx.tempPanelData = new Map();
  }

  await ensurePanelIndexes(ctx);

  if (!interactions) {
    logger.warn("[Tickets] interactions registrar not available for panel handlers");
    return () => {};
  }

  // Create Panel: open modal to collect embed + initial button label, then ask for channel via ChannelSelect
  disposers.push(
    interactions.registerButton(moduleName, PanelIds.Create(), async (interaction) => {
      try {
        const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
        assertInGuild(interaction); requireManageGuild(interaction);

        // Prompt minimal data via modal: title, description, button label
        const modal = new ModalBuilder()
          .setCustomId("tickets:panel:createModal")
          .setTitle("Create Ticket Panel");

      const title = new TextInputBuilder()
        .setCustomId("title").setLabel("Embed Title")
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);

      const desc = new TextInputBuilder()
        .setCustomId("description").setLabel("Embed Description")
        .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000);

      const button = new TextInputBuilder()
        .setCustomId("buttonLabel").setLabel("Button Label")
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80);

      modal.addComponents(
        new ActionRowBuilder().addComponents(title),
        new ActionRowBuilder().addComponents(desc),
        new ActionRowBuilder().addComponents(button),
      );

      await interaction.showModal(modal);
      } catch (e) {
        logger.error("[Tickets] Panel create button error", { 
          error: e?.message, 
          stack: e?.stack,
          guildId: interaction.guildId,
          userId: interaction.user.id
        });
        try {
          const { safeReply } = await import("../utils/validators.js");
          await safeReply(interaction, { content: `Cannot open create panel modal. Error: ${e?.message || 'Unknown error'}`, ephemeral: true });
        } catch (err) { void err; }
      }
    })
  );

  // Handle panel create modal -> ask for channel via select
  disposers.push(
    interactions.registerModal(moduleName, "tickets:panel:createModal", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const embedTitle = interaction.fields.getTextInputValue("title")?.trim();
        const embedDesc = interaction.fields.getTextInputValue("description")?.trim();
        const buttonLabel = interaction.fields.getTextInputValue("buttonLabel")?.trim();

        // Store the panel data temporarily using a simple timestamp-based ID
        // We'll store it in memory or use the interaction message ID as a key
        const tempId = Date.now().toString(36); // Short timestamp-based ID
        
        // Store the data temporarily (we'll use the message ID after reply)
        const panelData = { embedTitle, embedDesc, buttonLabel, tempId };
        
        const row = new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(`tickets:panel:create:pickChannel:${tempId}`)
            .setPlaceholder("Select a channel to publish the panel")
            .addChannelTypes(ChannelType.GuildText)
        );

        const reply = await safeReply(interaction, {
          content: "Select the channel where the panel should be published.",
          components: [row],
          ephemeral: true,
        });

        // Store the panel data using the reply message ID for retrieval
        if (reply && reply.id) {
          if (!ctx.tempPanelData) ctx.tempPanelData = new Map();
          ctx.tempPanelData.set(tempId, panelData);
          
          // Clean up after 5 minutes
          setTimeout(() => {
            if (ctx.tempPanelData) {
              ctx.tempPanelData.delete(tempId);
            }
          }, 5 * 60 * 1000);
        }
      } catch (e) {
        logger.error("[Tickets] Panel creation modal error", { 
          error: e?.message, 
          stack: e?.stack,
          guildId: interaction.guildId,
          userId: interaction.user.id
        });
        try {
          await safeReply(interaction, { content: `Failed to prepare panel creation. Error: ${e?.message || 'Unknown error'}`, ephemeral: true });
        } catch (err) { void err; }
      }
    })
  );

  // Publish to selected channel and persist panel
  disposers.push(
    interactions.registerSelect(moduleName, "tickets:panel:create:pickChannel:", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        // prefix route: extract temp ID from customId
        const [, , , , tempId] = interaction.customId.split(":"); // tickets:panel:create:pickChannel:{tempId}
        
        // Retrieve the stored panel data
        const payload = ctx.tempPanelData?.get(tempId);
        if (!payload) {
          return safeReply(interaction, { content: "Panel creation session expired. Please try again.", ephemeral: true });
        }

        // Clean up the temporary data
        ctx.tempPanelData?.delete(tempId);

        const channelId = interaction.values?.[0];
        if (!channelId) return safeReply(interaction, { content: "No channel selected.", ephemeral: true });

        const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.send) return safeReply(interaction, { content: "Selected channel is not sendable.", ephemeral: true });

        // Build the panel embed
        const panelEmbed = new EmbedBuilder().setTitle(payload.embedTitle).setDescription(payload.embedDesc).setColor(0x5865f2);

        // Multiple ticket types -> map to buttons; fall back to a default single button if no types
        const types = await listTypes(ctx, interaction.guildId);
        let components = [];
        if (types.length > 0) {
          const row = new ActionRowBuilder();
          for (const t of types.slice(0, 5)) {
            row.addComponents(
              new ButtonBuilder()
                .setCustomId(`tickets:user:create:${t.typeId}`)
                .setLabel(`${payload.buttonLabel || "Create"}: ${t.name}`)
                .setStyle(ButtonStyle.Primary)
            );
          }
          components.push(row);
        } else {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`tickets:user:create:default`)
              .setLabel(payload.buttonLabel || "Create Ticket")
              .setStyle(ButtonStyle.Primary)
          );
          components.push(row);
        }

        const sent = await channel.send({ embeds: [panelEmbed], components });

        // Persist panel record with per-button type mapping (first 5)
        const buttons = (types.length > 0
          ? types.slice(0, 5).map((t) => ({ label: `${payload.buttonLabel || "Create"}: ${t.name}`, style: "Primary", typeId: t.typeId }))
          : [{ label: payload.buttonLabel || "Create Ticket", style: "Primary", typeId: "default" }]
        );

        const panel = await createPanel(ctx, interaction.guildId, {
          channelId: channel.id,
          messageId: sent.id,
          embed: { title: payload.embedTitle, description: payload.embedDesc },
          buttons,
        });

        // Log creation
        try {
          const { sendLog } = await import("../services/loggingService.js");
          await sendLog(ctx, interaction.guildId, {
            title: "Panel Created",
            description: `Created by <@${interaction.user.id}> in <#${channel.id}>`,
            color: 0x57f287,
            fields: [
              { name: "Panel ID", value: panel.panelId, inline: true },
              { name: "Channel", value: `<#${channel.id}>`, inline: true },
            ],
          });
        } catch (err) { void err; }

        await safeReply(interaction, { content: `Panel published in <#${channel.id}> and saved (ID: ${panel.panelId}).`, ephemeral: true });
      } catch (e) {
        logger.error("[Tickets] Panel channel selection error", { 
          error: e?.message, 
          stack: e?.stack,
          guildId: interaction.guildId,
          userId: interaction.user.id
        });
        try {
          await safeReply(interaction, { content: `Failed to publish panel. Error: ${e?.message || 'Unknown error'}`, ephemeral: true });
        } catch (err) { void err; }
      }
    }, { prefix: true })
  );

  // Edit and Delete entry menus (scaffold)
  // Edit entry: show panels and allow choosing one for editing buttons/embed
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
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId("tickets:panel:edit:pick").setPlaceholder("Select a panel").addOptions(options)
      );
      await safeReply(interaction, { content: "Select a panel to edit.", components: [row], ephemeral: true });
      } catch (e) {
        try {
          const { safeReply } = await import("../utils/validators.js");
          await safeReply(interaction, { content: "Failed to open panel list.", ephemeral: true });
        } catch (err) { void err; }
      }
    })
  );

  // After selecting a panel -> show actions
  disposers.push(
    interactions.registerSelect(moduleName, "tickets:panel:edit:pick", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const panelId = interaction.values?.[0];
        const actionRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`tickets:panel:addButton:${panelId}`).setLabel("Add Button").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`tickets:panel:removeButton:${panelId}`).setLabel("Remove Button").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`tickets:panel:republish:${panelId}`).setLabel("Re-publish").setStyle(ButtonStyle.Success),
        );
        await safeReply(interaction, { content: `Editing panel ${panelId}.`, components: [actionRow], ephemeral: true });
      } catch (e) {
        try {
          await safeReply(interaction, { content: "Cannot open edit actions.", ephemeral: true });
        } catch (err) { void err; }
      }
    })
  );

  // Add Button -> pick type and label
  disposers.push(
    interactions.registerButton(moduleName, "tickets:panel:addButton:", async (interaction) => {
      try {
        const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
        assertInGuild(interaction); requireManageGuild(interaction);
        const [, , , panelId] = interaction.customId.split(":"); // tickets:panel:addButton:{panelId}
        
        // Debug logging
        logger.info("[Tickets] Add button debug", { 
          customId: interaction.customId,
          panelId,
          splitResult: interaction.customId.split(":")
        });

        if (!panelId || panelId === 'undefined') {
          return safeReply(interaction, { content: "Invalid panel ID. Please try again from the panel selection.", ephemeral: true });
        }

        const types = await listTypes(ctx, interaction.guildId);
        logger.info("[Tickets] Available typeIds for panel button", {
          typeIds: types.map(t => t.typeId),
          types
        });
        if (!types.length) return safeReply(interaction, { content: "No ticket types available. Create a type first.", ephemeral: true });
        const options = types.slice(0, 25).map((t) => ({ label: t.name, value: `${t.typeId}` }));
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId(`tickets:panel:addButton:pickType:${panelId}`).setPlaceholder("Choose a type").addOptions(options)
        );
        await safeReply(interaction, { content: "Select a ticket type for the new button.", components: [row], ephemeral: true });
      } catch (e) {
        logger.error("[Tickets] Add button flow error", { 
          error: e?.message, 
          stack: e?.stack,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          customId: interaction.customId
        });
        try {
          const { safeReply } = await import("../utils/validators.js");
          await safeReply(interaction, { content: `Failed to open add button flow. Error: ${e?.message || 'Unknown error'}`, ephemeral: true });
        } catch (err) { void err; }
      }
    }, { prefix: true })
  );

  // After type pick -> ask for label via modal
  disposers.push(
    interactions.registerSelect(moduleName, "tickets:panel:addButton:pickType:", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const [, , , , panelId] = interaction.customId.split(":"); // tickets:panel:addButton:pickType:{panelId}
        const typeId = interaction.values?.[0];
        
        // Debug logging
        logger.info("[Tickets] Type selection debug", { 
          customId: interaction.customId,
          panelId,
          typeId,
          values: interaction.values
        });

        if (!panelId || panelId === 'undefined') {
          return safeReply(interaction, { content: "Invalid panel ID. Please try again from the panel selection.", ephemeral: true });
        }

        if (!typeId) {
          return safeReply(interaction, { content: "No type selected. Please try again.", ephemeral: true });
        }

        const modal = new ModalBuilder().setCustomId(`tickets:panel:addButton:label:${panelId}:${typeId}`).setTitle("Button Label");
        const label = new TextInputBuilder().setCustomId("label").setLabel("Label").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80);
        modal.addComponents(new ActionRowBuilder().addComponents(label));
        await interaction.showModal(modal);
      } catch (e) {
        logger.error("[Tickets] Type selection error", { 
          error: e?.message, 
          stack: e?.stack,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          customId: interaction.customId
        });
        try {
          await safeReply(interaction, { content: `Cannot open label modal. Error: ${e?.message || 'Unknown error'}`, ephemeral: true });
        } catch (err) { void err; }
      }
    }, { prefix: true })
  );

  // Persist add button and re-publish
  disposers.push(
    interactions.registerModal(moduleName, "tickets:panel:addButton:label:", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const parts = interaction.customId.split(":"); // tickets:panel:addButton:label:{panelId}:{typeId}
        const panelId = parts[4];
        const typeId = parts[5];
        
        // Debug logging
        logger.info("[Tickets] Add button modal debug", { 
          customId: interaction.customId,
          parts,
          panelId,
          typeId
        });

        if (!panelId || panelId === 'undefined') {
          return safeReply(interaction, { content: "Invalid panel ID. Please try again from the panel selection.", ephemeral: true });
        }

        if (!typeId || typeId === 'undefined') {
          return safeReply(interaction, { content: "Invalid type ID. Please try again from the type selection.", ephemeral: true });
        }

        const label = interaction.fields.getTextInputValue("label")?.trim()?.slice(0, 80) || "Create Ticket";
        const { getPanel } = await import("../services/panelService.js");
        const panel = await getPanel(ctx, interaction.guildId, panelId);
        if (!panel) {
          // Debug: log all panels for this guild
          const allPanels = await listPanels(ctx, interaction.guildId);
          logger.warn("[Tickets] Panel not found in addButton modal", { panelId, allPanels });
          return safeReply(interaction, { content: "Panel not found. It may have been deleted.", ephemeral: true });
        }

        const buttons = Array.isArray(panel?.buttons) ? [...panel.buttons] : [];
        if (buttons.length >= 5) {
          return safeReply(interaction, { content: "This panel already has 5 buttons (Discord limit per row).", ephemeral: true });
        }
        buttons.push({ label, style: "Primary", typeId });

        await updatePanel(ctx, interaction.guildId, panelId, { buttons });
        await republishPanelMessage(interaction, panelId);

        // log
        try {
          const { sendLog } = await import("../services/loggingService.js");
          await sendLog(ctx, interaction.guildId, {
            title: "Panel Button Added",
            description: `Added by <@${interaction.user.id}>`,
            color: 0x57f287,
            fields: [
              { name: "Panel ID", value: panelId, inline: true },
              { name: "Type ID", value: typeId, inline: true },
              { name: "Label", value: label, inline: true }
            ]
          });
        } catch (err) { void err; }

        await safeReply(interaction, { content: "Button added and panel re-published.", ephemeral: true });
      } catch (e) {
        logger.error("[Tickets] Add button error", { 
          error: e?.message, 
          stack: e?.stack,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          customId: interaction.customId
        });
        try {
          await safeReply(interaction, { content: `Failed to add button. Error: ${e?.message || 'Unknown error'}`, ephemeral: true });
        } catch (err) { void err; }
      }
    }, { prefix: true })
  );

  // Remove Button -> show current buttons
  disposers.push(
    interactions.registerButton(moduleName, "tickets:panel:removeButton:", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const [, , , panelId] = interaction.customId.split(":"); // tickets:panel:removeButton:{panelId}
        const { getPanel } = await import("../services/panelService.js");
        const panel = await getPanel(ctx, interaction.guildId, panelId);
        const buttons = Array.isArray(panel?.buttons) ? panel.buttons : [];
        if (!buttons.length) return safeReply(interaction, { content: "No buttons to remove.", ephemeral: true });
 
        const options = buttons.map((b, idx) => ({ label: `${b.label} (${b.typeId})`, value: String(idx) })).slice(0, 25);
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId(`tickets:panel:removeButton:pick:${panelId}`).setPlaceholder("Select a button to remove").addOptions(options)
        );
        await safeReply(interaction, { content: "Choose a button to remove.", components: [row], ephemeral: true });
      } catch (e) {
        try {
          await safeReply(interaction, { content: "Failed to open remove menu.", ephemeral: true });
        } catch (err) { void err; }
      }
    }, { prefix: true })
  );

  // Persist removal and re-publish
  disposers.push(
    interactions.registerSelect(moduleName, "tickets:panel:removeButton:pick:", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const [, , , , panelId] = interaction.customId.split(":"); // tickets:panel:removeButton:pick:{panelId}
        const idx = Number(interaction.values?.[0] ?? -1);
        const { getPanel } = await import("../services/panelService.js");
        const panel = await getPanel(ctx, interaction.guildId, panelId);
        const buttons = Array.isArray(panel?.buttons) ? [...panel.buttons] : [];
        if (!(idx >= 0 && idx < buttons.length)) return safeReply(interaction, { content: "Invalid selection.", ephemeral: true });
 
        const removed = buttons[idx];
        buttons.splice(idx, 1);
        await updatePanel(ctx, interaction.guildId, panelId, { buttons });
        await republishPanelMessage(interaction, panelId);
 
        // log
        try {
          const { sendLog } = await import("../services/loggingService.js");
          await sendLog(ctx, interaction.guildId, {
            title: "Panel Button Removed",
            description: `Removed by <@${interaction.user.id}>`,
            color: 0xed4245,
            fields: [
              { name: "Panel ID", value: panelId, inline: true },
              { name: "Removed", value: `${removed?.label || "unknown"} (${removed?.typeId || "n/a"})`, inline: false }
            ]
          });
        } catch (err) { void err; }
 
        await safeReply(interaction, { content: "Button removed and panel re-published.", ephemeral: true });
      } catch (e) {
        try {
          await safeReply(interaction, { content: "Failed to remove button.", ephemeral: true });
        } catch (err) { void err; }
      }
    }, { prefix: true })
  );

  // Re-publish without changes
  disposers.push(
    interactions.registerButton(moduleName, "tickets:panel:republish:", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const [, , , panelId] = interaction.customId.split(":"); // tickets:panel:republish:{panelId}
        
        await republishPanelMessage(interaction, panelId);

        // log
        try {
          const { sendLog } = await import("../services/loggingService.js");
          await sendLog(ctx, interaction.guildId, {
            title: "Panel Re-published",
            description: `Re-published by <@${interaction.user.id}>`,
            color: 0x5865f2,
            fields: [{ name: "Panel ID", value: panelId, inline: true }]
          });
        } catch (err) { void err; }

        await safeReply(interaction, { content: "Panel re-published.", ephemeral: true });
      } catch (e) {
        logger.error("[Tickets] Panel republish error", { 
          error: e?.message, 
          stack: e?.stack,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          panelId: interaction.customId.split(":")[3]
        });
        try {
          await safeReply(interaction, { content: `Failed to re-publish panel. Error: ${e?.message || 'Unknown error'}`, ephemeral: true });
        } catch (err) { void err; }
      }
    }, { prefix: true })
  );

  disposers.push(
    interactions.registerButton(moduleName, "tickets:panel:deleteOpen", async (interaction) => {
      const { assertInGuild, requireManageGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const panels = await listPanels(ctx, interaction.guildId);
        if (!panels.length) return safeReply(interaction, { content: "No panels to delete.", ephemeral: true });

        const list = panels.map(p => `• ${p.panelId} in <#${p.channelId}>`).join("\n");
        await safeReply(interaction, { content: `Panels:\n${list}\nUse / command to delete by ID in next iteration.`, ephemeral: true });
      } catch {
        await safeReply(interaction, { content: "Failed to open delete helper.", ephemeral: true });
      }
    })
  );

  lifecycle.addDisposable(() => {
    for (const d of disposers) {
      try { d?.(); } catch (e) { /* eslint-disable-line no-empty */ /* noop */ }
    }
  });

  const republishPanelMessage = async (interaction, panelId) => {
    try {
      const { getPanel, linkMessage } = await import("../services/panelService.js");
      const p = await getPanel(ctx, interaction.guildId, panelId);
      if (!p) {
        logger.warn("[Tickets] Panel not found for republish", { panelId, guildId: interaction.guildId });
        return;
      }

      const channel = await interaction.client.channels.fetch(p.channelId).catch(() => null);
      if (!channel || !channel.send) {
        logger.warn("[Tickets] Channel not accessible for republish", { channelId: p.channelId, panelId });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(p.embed?.title || "Tickets")
        .setDescription(p.embed?.description || "")
        .setColor(0x5865f2);

      // Build rows from stored buttons
      const btns = Array.isArray(p.buttons) ? p.buttons : [];
      let components = [];
      
      if (btns.length > 0) {
        const row = new ActionRowBuilder();
        for (const b of btns.slice(0, 5)) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`tickets:user:create:${b.typeId}`)
              .setLabel(b.label || "Create")
              .setStyle(ButtonStyle[b.style] || ButtonStyle.Primary)
          );
        }
        components.push(row);
      }

      // Try to edit existing message; if missing, send new and update record
      let failedEdit = false;
      try {
        const msg = await channel.messages.fetch(p.messageId).catch(() => null);
        if (msg) {
          await msg.edit({ embeds: [embed], components });
        } else {
          failedEdit = true;
        }
      } catch (e) {
        logger.warn("[Tickets] Failed to edit existing panel message", { error: e?.message, panelId });
        failedEdit = true;
      }

      if (failedEdit) {
        const sent = await channel.send({ embeds: [embed], components });
        await linkMessage(ctx, interaction.guildId, panelId, { channelId: channel.id, messageId: sent.id });
        logger.info("[Tickets] Panel message re-created", { panelId, newMessageId: sent.id });
      }
    } catch (e) {
      logger.error("[Tickets] Error in republishPanelMessage", { 
        error: e?.message, 
        stack: e?.stack, 
        panelId, 
        guildId: interaction.guildId 
      });
      throw e; // Re-throw so the calling handler can catch and respond appropriately
    }
  }

  return () => {
    for (const d of disposers) {
      try { d?.(); } catch (e) { /* eslint-disable-line no-empty */ /* noop */ }
    }
  };
}
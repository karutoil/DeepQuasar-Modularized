// Helper to build the default ticket control buttons
function buildDefaultTicketControls(ticketId) {
  const buttons = [
    new ButtonBuilder().setCustomId(`tickets:control:lock:${ticketId}`).setLabel("Lock").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`tickets:control:rename:${ticketId}`).setLabel("Rename").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tickets:control:transcript:${ticketId}`).setLabel("Transcript").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tickets:control:addUser:${ticketId}`).setLabel("Add User").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tickets:control:removeUser:${ticketId}`).setLabel("Remove User").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tickets:control:assignSelf:${ticketId}`).setLabel("Assign to Me").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`tickets:control:transfer:${ticketId}`).setLabel("Transfer").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tickets:control:reopen:${ticketId}`).setLabel("Reopen").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tickets:control:close:${ticketId}`).setLabel("Close").setStyle(ButtonStyle.Danger)
  ];
  // Split into rows of max 5 buttons
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));
  }
  return rows;
}
/**
 * Ticket control handlers: Close, Add/Remove User, Lock/Unlock, Rename, Transcript, Transfer, Reopen
 * All actions are embed/button driven inside the ticket channel.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
  EmbedBuilder,
} from "discord.js";
import { safeReply, assertInGuild, requireManageGuild } from "../utils/validators.js";
import {
  getTicketByChannel,
  updateTicket,
  beginClosing,
  finalizeClosed,
  archiveTicket,
  addParticipant,
  removeParticipant,
  setLocked,
  reopenTicket,
} from "../services/ticketService.js";
import { getGuildSettings } from "../services/settingsService.js";
import { generateTranscriptAndUpload } from "../services/transcriptService.js";
import { sendLog } from "../services/loggingService.js";

export async function registerTicketControlHandlers(ctx) {
  const { logger, lifecycle, client, interactions } = ctx;
  const moduleName = "tickets";
  const disposers = [];
  if (!interactions) {
    logger.warn("[Tickets] interactions registrar not available for ticket controls");
    return () => {};
  }
  // ...existing code...

  // Always register addUserSelect handler at startup (canonical - remove duplicates below)
  const disposerAddUserSelect = interactions.registerSelectMenu(moduleName, "tickets:control:addUserSelect:", async (interaction) => {
    let replied = false;
    try {
      const isUserSelect = (typeof interaction.isUserSelectMenu === "function" && interaction.isUserSelectMenu()) || interaction.componentType === 5;
      if (!isUserSelect) {
        ctx.logger.warn("[Tickets] addUserSelect: not a user select menu", { customId: String(interaction.customId), componentType: String(interaction.componentType) });
        await safeReply(interaction, { content: "Not a user select menu.", flags: 64 });
        replied = true;
        return;
      }
      const parts = String(interaction.customId).split(":");
      const ticketId = parts[3];
      const uid = Array.isArray(interaction.values) ? String(interaction.values[0]) : undefined;
      const ticket = await updateTicket(ctx, interaction.guildId, ticketId, {});
      if (!ticket) {
        ctx.logger.warn("[Tickets] addUserSelect: ticket not found", { ticketId, guildId: String(interaction.guildId) });
        await safeReply(interaction, { content: "Ticket not found.", flags: 64 });
        replied = true;
        return;
      }
      const channel = await interaction.client.channels.fetch(ticket.channelId).catch((err) => { ctx.logger.error("[Tickets] addUserSelect channel fetch error", { error: err?.message }); return null; });
      if (!channel) {
        ctx.logger.warn("[Tickets] addUserSelect: channel not found", { channelId: String(ticket.channelId) });
        await safeReply(interaction, { content: "Channel not found.", flags: 64 });
        replied = true;
        return;
      }
      await addParticipant(ctx, interaction.guildId, ticket.ticketId, uid);
      await channel.permissionOverwrites.edit(uid, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      }).catch((err) => { ctx.logger.error("[Tickets] addUserSelect permissionOverwrites error", { error: err?.message }); });
      await sendLog(ctx, interaction.guildId, {
        title: "User Added to Ticket",
        description: `Added <@${uid}> by <@${interaction.user.id}>`,
        color: 0x57f287,
        ticket: { channelId: ticket.channelId, ticketId: ticket.ticketId },
      });
      await safeReply(interaction, { content: "User added.", flags: 64 });
      replied = true;
    } catch (e) {
      ctx.logger.error("[Tickets] addUserSelect error", { error: e?.message, stack: e?.stack });
      if (!replied) {
        try { await safeReply(interaction, { content: "Failed to add user. " + (e?.message || ""), flags: 64 }); } catch (err) { void err; }
      }
    } finally {
      // If still not replied, send a fallback
      if (!replied) {
        try { await safeReply(interaction, { content: "This interaction failed due to an unknown error.", flags: 64 }); } catch (err) { void err; }
      }
    }
  }, { prefix: true });
  disposers.push(disposerAddUserSelect);

  // Always register transferSelect handler at startup (canonical - remove duplicates below)
  const disposerTransferSelect = interactions.registerSelectMenu(moduleName, "tickets:control:transferSelect:", async (interaction) => {
    let replied = false;
    try {
      const isUserSelect = (typeof interaction.isUserSelectMenu === "function" && interaction.isUserSelectMenu()) || interaction.componentType === 5;
      if (!isUserSelect) {
        ctx.logger.warn("[Tickets] transferSelect: not a user select menu", { customId: String(interaction.customId), componentType: String(interaction.componentType) });
        await safeReply(interaction, { content: "Not a user select menu.", flags: 64 });
        replied = true;
        return;
      }
      const parts = String(interaction.customId).split(":");
      const ticketId = parts[3];
      const assigneeId = Array.isArray(interaction.values) ? String(interaction.values[0]) : undefined;
      const ticket = await updateTicket(ctx, interaction.guildId, ticketId, { assigneeId });
      if (!ticket) {
        await safeReply(interaction, { content: "Ticket not found.", flags: 64 });
        replied = true;
        return;
      }
      await sendLog(ctx, interaction.guildId, {
        title: "Ticket Transferred",
        description: `Assigned to <@${assigneeId}> by <@${interaction.user.id}>`,
        color: 0x5865f2,
        ticket: { channelId: ticket.channelId, ticketId: ticket.ticketId },
      });
      // DM the assignee if enabled
      try {
        const settings = await (await import("../services/settingsService.js")).getGuildSettings(ctx, interaction.guildId);
        if (settings?.dmNotifications?.assign) {
          const userToDM = await interaction.client.users.fetch(assigneeId).catch(() => null);
          if (userToDM) {
            const embed = new (await import("discord.js")).EmbedBuilder()
              .setTitle("Ticket Update")
              .setColor(0x5865f2)
              .addFields(
                { name: "Ticket", value: `<#${ticket.channelId}> · ID: ${ticket.ticketId}`, inline: false },
                { name: "Action", value: `Assigned to you`, inline: true },
                { name: "Server", value: `${interaction.guild?.name || interaction.guildId}`, inline: true },
                { name: "Performed By", value: `<@${interaction.user.id}>`, inline: true },
              )
              .setTimestamp(new Date());
            await userToDM.send({ embeds: [embed] }).catch(() => {});
          }
        }
      } catch (e) { ctx.logger?.warn?.("[Tickets] DM assign failed", { error: e?.message }); }
      // Update both embeds in the ticket channel to show new owner
      try {
        const channel = await interaction.client.channels.fetch(ticket.channelId).catch(() => null);
        if (channel) {
          const messages = await channel.messages.fetch({ limit: 20 });
          // Find the two most recent bot messages with embeds
          const botMessages = messages.filter(m => m.author.id === interaction.client.user.id && m.embeds?.length);
          const toUpdate = Array.from(botMessages.values()).slice(0, 2);
          for (const msg of toUpdate) {
            const embed = msg.embeds[0];
            if (embed) {
              // Clone embed and update owner/assignee field
              const newEmbed = EmbedBuilder.from(embed);
              // Try to update a field named "Owner" or "Assignee" if present, else add one
              let found = false;
              const fields = newEmbed.data.fields || [];
              for (let f of fields) {
                if (f.name.toLowerCase().includes("owner") || f.name.toLowerCase().includes("assignee")) {
                  f.value = `<@${assigneeId}>`;
                  found = true;
                }
              }
              if (!found) {
                fields.push({ name: "Owner", value: `<@${assigneeId}>`, inline: true });
              }
              newEmbed.setFields(fields);
              await msg.edit({ embeds: [newEmbed] });
            }
          }
        }
      } catch (e) {
        ctx.logger.warn("[Tickets] transferSelect: failed to update embeds after transfer", { error: e?.message });
      }
      await safeReply(interaction, { content: "Ticket transferred.", flags: 64 });
      replied = true;
    } catch (e) {
      ctx.logger.error("[Tickets] transferSelect error", { error: e?.message, stack: e?.stack });
      if (!replied) {
        try { await safeReply(interaction, { content: "Transfer failed. " + (e?.message || ""), flags: 64 }); } catch (err) { void err; }
      }
    } finally {
      // If still not replied, send a fallback
      if (!replied) {
        try { await safeReply(interaction, { content: "This interaction failed due to an unknown error.", flags: 64 }); } catch (err) { void err; }
      }
    }
  }, { prefix: true });
  disposers.push(disposerTransferSelect);
  // Close -> ask reason modal
  disposers.push(
    interactions.registerButton(moduleName, "tickets:control:close:", async (interaction) => {
      try {
        assertInGuild(interaction);
        // Permission: opener or Manage Guild can close
        const ticket = await getTicketByChannel(ctx, interaction.guildId, interaction.channelId);
        if (!ticket) return safeReply(interaction, { content: "Not a ticket channel.", ephemeral: true });
        const isOpener = ticket.openerId === interaction.user.id;
        const isManager = interaction.memberPermissions?.has?.("ManageGuild");
        if (!isOpener && !isManager) {
          return safeReply(interaction, { content: "You cannot close this ticket.", ephemeral: true });
        }

        const modal = new ModalBuilder().setCustomId(`tickets:control:closeModal:${ticket.ticketId}`).setTitle("Close Ticket");
        const reason = new TextInputBuilder().setCustomId("reason").setLabel("Reason").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000);
        modal.addComponents(new ActionRowBuilder().addComponents(reason));
        await interaction.showModal(modal);
      } catch (e) {
        logger.warn("[Tickets] close button error", { error: e?.message });
      }
    }, { prefix: true })
  );

  // Close modal -> confirm and proceed
  disposers.push(
    interactions.registerModal(moduleName, "tickets:control:closeModal:", async (interaction) => {
      const parts = interaction.customId.split(":");
      const ticketId = parts[3];
      const reason = interaction.fields.getTextInputValue("reason")?.trim();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tickets:control:closeConfirm:${ticketId}:${Buffer.from(reason || "").toString("base64url")}`).setLabel("Confirm Close").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`tickets:control:cancelClose:${ticketId}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      );
      await safeReply(interaction, { content: "Confirm ticket closure?", components: [row], ephemeral: true });
    }, { prefix: true })
  );

  // Cancel close
  disposers.push(
    interactions.registerButton(moduleName, "tickets:control:cancelClose:", async (interaction) => {
      await safeReply(interaction, { content: "Ticket close canceled.", ephemeral: true });
    }, { prefix: true })
  );

  // Confirm close -> transcript, DM, log, delete channel, archive
  disposers.push(
    interactions.registerButton(moduleName, "tickets:control:closeConfirm:", async (interaction) => {
      try {
        assertInGuild(interaction);
        const parts = interaction.customId.split(":"); // tickets:control:closeConfirm:{ticketId}:{reasonB64}
        const ticketId = parts[3];
        const reason = parts[4] ? Buffer.from(parts[4], "base64url").toString("utf8") : "";
        const guildId = interaction.guildId;
        logger.info("[Tickets] closeConfirm pressed", { customId: interaction.customId, ticketId, reason, guildId });

        const ticket = await updateTicket(ctx, guildId, ticketId, {}); // fetch latest
        logger.info("[Tickets] closeConfirm updateTicket result", { ticket });
        if (!ticket) {
          logger.warn("[Tickets] closeConfirm: ticket not found", { ticketId, guildId });
          return safeReply(interaction, { content: "Ticket not found.", ephemeral: true });
        }

        try {
          await beginClosing(ctx, guildId, ticketId);
        } catch (e) {
          logger.error("[Tickets] closeConfirm: beginClosing error", { error: e?.message, stack: e?.stack });
        }

        // Transcript
        let transcript = null;
        try {
          transcript = await generateTranscriptAndUpload(ctx, guildId, ticket.channelId);
        } catch (e) {
          logger.warn("[Tickets] transcript failure on close", { error: e?.message });
        }

        // Finalize closed
        try {
          await finalizeClosed(ctx, guildId, ticketId, { reason: reason || "Closed by staff/user", transcript });
        } catch (e) {
          logger.error("[Tickets] closeConfirm: finalizeClosed error", { error: e?.message, stack: e?.stack });
        }

        // DM opener if configured (controlled by dmNotifications.close; include transcript link if available)
        try {
          const settings = await getGuildSettings(ctx, guildId);
          if (settings?.dmNotifications?.close) {
            const user = await client.users.fetch(ticket.openerId).catch(() => null);
            if (user) {
              const msg = transcript?.url
                ? `Your ticket has been closed.\nReason: ${reason || "No reason provided"}\nTranscript: ${transcript.url}`
                : `Your ticket has been closed.\nReason: ${reason || "No reason provided"}`;
              await user.send(msg).catch((err) => {
                logger?.warn?.("[Tickets] DM close failed", {
                  error: err?.message,
                  code: err?.code,
                  guildId,
                  ticketId: ticket.ticketId,
                  channelId: ticket.channelId,
                  userId: ticket.openerId
                });
              });
            }
          }
        } catch (e) {
          logger.warn("[Tickets] closeConfirm: DM error", { error: e?.message, guildId, ticketId: ticket.ticketId, channelId: ticket.channelId });
        }

        // Log
        try {
          await sendLog(ctx, guildId, {
            title: "Ticket Closed",
            description: `Ticket ${ticket.ticketId} closed by <@${interaction.user.id}>.\nReason: ${reason || "N/A"}`,
            color: 0xed4245,
            ticket: { channelId: ticket.channelId, ticketId: ticket.ticketId },
          });
        } catch (e) {
          logger.warn("[Tickets] closeConfirm: sendLog error", { error: e?.message });
        }

        // Optional metrics: ticket closed
        try {
          const mod = await import("../../../core/reporting.js").catch(() => null);
          const report = mod?.report;
          if (typeof report === "function") {
            report("tickets.ticket_closed", {
              guildId,
              ticketId,
              reason: reason || null,
              transcriptUrl: transcript?.url || null,
            });
          }
        } catch (e) {
          logger.warn("[Tickets] closeConfirm: metrics error", { error: e?.message });
        }

        // Always reply before deleting the channel
        try {
          await safeReply(interaction, { content: "Ticket closed.", ephemeral: true });
        } catch (e) {
          // Ignore unknown interaction errors
          if (e?.code !== 10062) {
            logger.warn("[Tickets] closeConfirm: safeReply error", { error: e?.message });
          }
        }
        // Delete channel then archive
        try {
          const channel = await interaction.client.channels.fetch(ticket.channelId).catch(() => null);
          if (channel && channel.deletable) {
            await channel.delete("Ticket closed");
          }
        } catch (e) {
          // Ignore unknown channel errors
          if (e?.code !== 10003) {
            logger.warn("[Tickets] closeConfirm: channel delete error", { error: e?.message });
          }
        }
        try {
          await archiveTicket(ctx, guildId, ticketId);
        } catch (e) {
          logger.warn("[Tickets] closeConfirm: archiveTicket error", { error: e?.message });
        }
      } catch (e) {
        logger.error("[Tickets] closeConfirm: top-level error", { error: e?.message, stack: e?.stack });
        await safeReply(interaction, { content: "Failed to close ticket.", ephemeral: true });
      }
    }, { prefix: true })
  );

  // Lock
  disposers.push(
    interactions.registerButton(moduleName, "tickets:control:lock:", async (interaction) => {
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const guild = interaction.guild;
        const channel = interaction.channel;
        const ticket = await getTicketByChannel(ctx, interaction.guildId, interaction.channelId);
        if (!ticket) return safeReply(interaction, { content: "Not a ticket channel.", ephemeral: true });

        // Apply lock overwrites using centralized helper for consistency
        const { buildLockOverwrites } = await import("../utils/permissions.js");
        const me = guild.members.me || (await guild.members.fetch(client.user.id).catch(() => null));
        const lockOvr = buildLockOverwrites({
          openerId: ticket.openerId,
          supportRoleIds: (await getGuildSettings(ctx, interaction.guildId))?.supportRoleIds || [],
          botId: me?.id,
          locked: true,
        });
        // Apply computed overwrites
        for (const o of lockOvr) {
          let allow = {};
          let deny = {};
          if (o.allow && typeof o.allow === "number" && o.allow !== 0) {
            allow = new PermissionsBitField(o.allow).toArray().reduce((acc, k) => ({ ...acc, [k]: true }), {});
          }
          if (o.deny && typeof o.deny === "number" && o.deny !== 0) {
            deny = new PermissionsBitField(o.deny).toArray().reduce((acc, k) => ({ ...acc, [k]: false }), {});
          }
          await channel.permissionOverwrites.edit(o.id, { ...allow, ...deny }).catch(() => {});
        }
        await setLocked(ctx, interaction.guildId, ticket.ticketId, true);

        // Update control message to show 'Unlock' instead of 'Lock'
        try {
          // Find the last bot message in the channel with components
          const messages = await channel.messages.fetch({ limit: 10 });
          const botMsg = messages.find(m => m.author.id === interaction.client.user.id && m.components?.length);
          if (botMsg) {
            // Build new row with 'Unlock' button and keep Assign to Me visible
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`tickets:control:unlock:${ticket.ticketId}`)
                .setLabel("Unlock")
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId(`tickets:control:assignSelf:${ticket.ticketId}`)
                .setLabel("Assign to Me")
                .setStyle(ButtonStyle.Primary),
            );
            await botMsg.edit({ components: [row] });
          }
        } catch (e) {
          logger.warn("[Tickets] lock: failed to update control message", { error: e?.message });
        }

        await sendLog(ctx, interaction.guildId, {
          title: "Ticket Locked",
          description: `Locked by <@${interaction.user.id}>`,
          color: 0xf1c40f,
          ticket: { channelId: ticket.channelId, ticketId: ticket.ticketId },
        });
        await safeReply(interaction, { content: "Ticket locked.", ephemeral: true });
      } catch (e) {
        logger.error("[Tickets] lock button error", { error: e?.message, stack: e?.stack });
        await safeReply(interaction, { content: `Lock failed. ${e?.message || ''}`, ephemeral: true });
      }
    }, { prefix: true })
  );

  // Unlock
  disposers.push(
    interactions.registerButton(moduleName, "tickets:control:unlock:", async (interaction) => {
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const guild = interaction.guild;
        const channel = interaction.channel;
        const ticket = await getTicketByChannel(ctx, interaction.guildId, interaction.channelId);
        if (!ticket) return safeReply(interaction, { content: "Not a ticket channel.", ephemeral: true });

        // Restore open-state overwrites using centralized helper
        const { buildLockOverwrites } = await import("../utils/permissions.js");
        const me2 = guild.members.me || (await guild.members.fetch(client.user.id).catch(() => null));
        const openOvr = buildLockOverwrites({
          openerId: ticket.openerId,
          supportRoleIds: (await getGuildSettings(ctx, interaction.guildId))?.supportRoleIds || [],
          botId: me2?.id,
          locked: false,
        });
        for (const o of openOvr) {
          let allow = {};
          let deny = {};
          if (o.allow && typeof o.allow === "number" && o.allow !== 0) {
            allow = new PermissionsBitField(o.allow).toArray().reduce((acc, k) => ({ ...acc, [k]: true }), {});
          }
          if (o.deny && typeof o.deny === "number" && o.deny !== 0) {
            deny = new PermissionsBitField(o.deny).toArray().reduce((acc, k) => ({ ...acc, [k]: false }), {});
          }
          await channel.permissionOverwrites.edit(o.id, { ...allow, ...deny }).catch(() => {});
        }
        await setLocked(ctx, interaction.guildId, ticket.ticketId, false);

        // Update control message to restore all buttons using helper
        try {
          const messages = await channel.messages.fetch({ limit: 10 });
          const botMsg = messages.find(m => m.author.id === interaction.client.user.id && m.components?.length);
          if (botMsg) {
            await botMsg.edit({ components: buildDefaultTicketControls(ticket.ticketId) });
          }
        } catch (e) {
          logger.warn("[Tickets] unlock: failed to update control message", { error: e?.message });
        }

        await sendLog(ctx, interaction.guildId, {
          title: "Ticket Unlocked",
          description: `Unlocked by <@${interaction.user.id}>`,
          color: 0x57f287,
          ticket: { channelId: ticket.channelId, ticketId: ticket.ticketId },
        });
        await safeReply(interaction, { content: "Ticket unlocked.", ephemeral: true });
      } catch {
        await safeReply(interaction, { content: "Unlock failed.", ephemeral: true });
      }
    }, { prefix: true })
  );

  // Rename
  disposers.push(
    interactions.registerButton(moduleName, "tickets:control:rename:", async (interaction) => {
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const ticket = await getTicketByChannel(ctx, interaction.guildId, interaction.channelId);
        if (!ticket) return safeReply(interaction, { content: "Not a ticket channel.", ephemeral: true });

        const modal = new ModalBuilder().setCustomId(`tickets:control:renameModal:${ticket.ticketId}`).setTitle("Rename Ticket Channel");
        const name = new TextInputBuilder().setCustomId("name").setLabel("New Channel Name").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50);
        modal.addComponents(new ActionRowBuilder().addComponents(name));
        await interaction.showModal(modal);
      } catch {
        await safeReply(interaction, { content: "Failed to open rename modal.", ephemeral: true });
      }
    }, { prefix: true })
  );

  disposers.push(
    interactions.registerModal(moduleName, "tickets:control:renameModal:", async (interaction) => {
      try {
        const ticketId = interaction.customId.split(":")[3];
        const name = interaction.fields.getTextInputValue("name")?.trim()?.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 50);
        const ticket = await updateTicket(ctx, interaction.guildId, ticketId, {}); // fetch latest
        if (!ticket) return safeReply(interaction, { content: "Ticket not found.", ephemeral: true });

        const channel = await interaction.client.channels.fetch(ticket.channelId).catch(() => null);
        if (channel && channel.manageable) {
          await channel.setName(name || channel.name, "Ticket rename");
          await sendLog(ctx, interaction.guildId, {
            title: "Ticket Renamed",
            description: `Renamed by <@${interaction.user.id}> to ${name}`,
            color: 0x5865f2,
            ticket: { channelId: ticket.channelId, ticketId: ticket.ticketId },
          });
          await safeReply(interaction, { content: "Channel renamed.", ephemeral: true });
        } else {
          await safeReply(interaction, { content: "Cannot rename channel.", ephemeral: true });
        }
      } catch {
        await safeReply(interaction, { content: "Rename failed.", ephemeral: true });
      }
    }, { prefix: true })
  );

  // Transcript on demand
  disposers.push(
    interactions.registerButton(moduleName, "tickets:control:transcript:", async (interaction) => {
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const ticket = await getTicketByChannel(ctx, interaction.guildId, interaction.channelId);
        if (!ticket) return safeReply(interaction, { content: "Not a ticket channel.", ephemeral: true });

        const transcript = await generateTranscriptAndUpload(ctx, interaction.guildId, ticket.channelId);
        if (transcript?.url) {
          await sendLog(ctx, interaction.guildId, {
            title: "Transcript Generated",
            description: `Requested by <@${interaction.user.id}>`,
            color: 0x5865f2,
            fields: [{ name: "URL", value: transcript.url }],
            ticket: { channelId: ticket.channelId, ticketId: ticket.ticketId },
          });

          // Optional metrics: transcript generated
          try {
            const mod = await import("../../../core/reporting.js").catch(() => null);
            const report = mod?.report;
            if (typeof report === "function") {
              report("tickets.transcript_generated", {
                guildId: interaction.guildId,
                channelId: ticket.channelId,
                ticketId: ticket.ticketId,
                url: transcript.url,
              });
            }
          } catch (err) { void err; }

          await safeReply(interaction, { content: `Transcript generated: ${transcript.url}`, ephemeral: true });
        } else {
          await safeReply(interaction, { content: "Transcript generated but no URL available.", ephemeral: true });
        }
      } catch {
        await safeReply(interaction, { content: "Transcript generation failed.", ephemeral: true });
      }
    }, { prefix: true })
  );

  // Add/Remove user: simplified modal with user ID input for now
  disposers.push(
    interactions.registerButton(moduleName, "tickets:control:addUser:", async (interaction) => {
      ctx.logger.debug("[Tickets] addUser button handler entry", {
        customId: interaction.customId,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user?.id,
        member: interaction.member,
        clientUserId: interaction.client?.user?.id
      });
      try {
        ctx.logger.debug("[Tickets] addUser before assertInGuild/requireManageGuild");
        assertInGuild(interaction); requireManageGuild(interaction);
        ctx.logger.debug("[Tickets] addUser before getTicketByChannel", { guildId: interaction.guildId, channelId: interaction.channelId });
        const ticket = await getTicketByChannel(ctx, interaction.guildId, interaction.channelId);
        ctx.logger.debug("[Tickets] addUser after getTicketByChannel", { ticket });
        if (!ticket) {
          ctx.logger.warn("[Tickets] addUser: not a ticket channel", { guildId: interaction.guildId, channelId: interaction.channelId });
          return safeReply(interaction, { content: "Not a ticket channel.", ephemeral: true });
        }
        ctx.logger.debug("[Tickets] addUser before UserSelectMenuBuilder", { ticketId: ticket.ticketId });
        const row = new ActionRowBuilder().addComponents(
          new (await import('discord.js')).UserSelectMenuBuilder()
            .setCustomId(`tickets:control:addUserSelect:${ticket.ticketId}`)
            .setPlaceholder("Select a member to add")
            .setMinValues(1)
            .setMaxValues(1)
        );
        ctx.logger.debug("[Tickets] addUser before safeReply", { row });
        await safeReply(interaction, { content: "Select a member to add to the ticket:", components: [row], ephemeral: true });
        ctx.logger.debug("[Tickets] addUser after safeReply");
      } catch (e) {
        ctx.logger.error("[Tickets] addUser error", { error: e?.message, stack: e?.stack });
        await safeReply(interaction, { content: "Failed to open add user select.", ephemeral: true });
      }
    }, { prefix: true })
  );

  disposers.push(
    interactions.registerModal(moduleName, "tickets:control:addUserModal:", async (_interaction) => {
      // Remove modal handler for add user
    }, { prefix: true })
  );

  disposers.push(
    interactions.registerButton(moduleName, "tickets:control:removeUser:", async (interaction) => {
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const ticket = await getTicketByChannel(ctx, interaction.guildId, interaction.channelId);
        if (!ticket) return safeReply(interaction, { content: "Not a ticket channel.", ephemeral: true });

        const modal = new ModalBuilder().setCustomId(`tickets:control:removeUserModal:${ticket.ticketId}`).setTitle("Remove User from Ticket");
        const userId = new TextInputBuilder().setCustomId("userId").setLabel("User ID").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(25);
        modal.addComponents(new ActionRowBuilder().addComponents(userId));
        await interaction.showModal(modal);
      } catch {
        await safeReply(interaction, { content: "Failed to open remove user modal.", ephemeral: true });
      }
    }, { prefix: true })
  );

  disposers.push(
    interactions.registerModal(moduleName, "tickets:control:removeUserModal:", async (interaction) => {
      try {
        const [, , , , ticketId] = interaction.customId.split(":");
        const uid = interaction.fields.getTextInputValue("userId")?.trim();
        const ticket = await updateTicket(ctx, interaction.guildId, ticketId, {}); // fetch latest
        if (!ticket) return safeReply(interaction, { content: "Ticket not found.", ephemeral: true });

        const channel = await interaction.client.channels.fetch(ticket.channelId).catch(() => null);
        if (!channel) return safeReply(interaction, { content: "Channel not found.", ephemeral: true });

        await removeParticipant(ctx, interaction.guildId, ticket.ticketId, uid);
        await channel.permissionOverwrites.delete(uid).catch(() => {});

        await sendLog(ctx, interaction.guildId, {
          title: "User Removed from Ticket",
          description: `Removed <@${uid}> by <@${interaction.user.id}>`,
          color: 0xed4245,
          ticket: { channelId: ticket.channelId, ticketId: ticket.ticketId },
        });
        // DM the removed user if enabled
        try {
          const settings = await getGuildSettings(ctx, interaction.guildId);
          if (settings?.dmNotifications?.userRemoved) {
            const removedUser = await interaction.client.users.fetch(uid).catch(() => null);
            if (removedUser) {
              const embed = new EmbedBuilder()
                .setTitle("Ticket Update")
                .setColor(0xed4245)
                .addFields(
                  { name: "Ticket", value: `<#${ticket.channelId}> · ID: ${ticket.ticketId}`, inline: false },
                  { name: "Action", value: `You were removed from the ticket`, inline: true },
                  { name: "Server", value: `${interaction.guild?.name || interaction.guildId}`, inline: true },
                  { name: "Performed By", value: `<@${interaction.user.id}>`, inline: true },
                )
                .setTimestamp(new Date());
              await removedUser.send({ embeds: [embed] }).catch((err) => {
                ctx.logger?.warn?.("[Tickets] DM userRemoved failed", {
                  error: err?.message,
                  code: err?.code,
                  guildId: interaction.guildId,
                  ticketId: ticket.ticketId,
                  channelId: ticket.channelId,
                  userId: uid
                });
              });
            }
          }
        } catch (e) {
          ctx.logger?.warn?.("[Tickets] userRemoved DM error", { error: e?.message });
        }
        await safeReply(interaction, { content: "User removed.", ephemeral: true });
      } catch {
        await safeReply(interaction, { content: "Failed to remove user.", ephemeral: true });
      }
    }, { prefix: true })
  );

  // Transfer (store assignee only)
  disposers.push(
    interactions.registerButton(moduleName, "tickets:control:transfer:", async (interaction) => {
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const ticket = await getTicketByChannel(ctx, interaction.guildId, interaction.channelId);
        if (!ticket) return safeReply(interaction, { content: "Not a ticket channel.", ephemeral: true });

        // Show member select menu
        const row = new ActionRowBuilder().addComponents(
          new (await import('discord.js')).UserSelectMenuBuilder()
            .setCustomId(`tickets:control:transferSelect:${ticket.ticketId}`)
            .setPlaceholder("Select a member to transfer to")
            .setMinValues(1)
            .setMaxValues(1)
        );
        await safeReply(interaction, { content: "Select a member to transfer the ticket to:", components: [row], ephemeral: true });
      } catch {
        await safeReply(interaction, { content: "Failed to open transfer select.", ephemeral: true });
      }
    }, { prefix: true })
  );

  // Removed duplicate debug modal and redundant handler registrations

  // Assign to Me
  disposers.push(
    interactions.registerButton(moduleName, "tickets:control:assignSelf:", async (interaction) => {
      try {
        assertInGuild(interaction);
        const guild = interaction.guild;
        const member = interaction.member;
        const meUserId = interaction.user.id;
        const ticket = await getTicketByChannel(ctx, interaction.guildId, interaction.channelId);
        if (!ticket) return safeReply(interaction, { content: "Not a ticket channel.", ephemeral: true });

        // Permission: support role OR ManageGuild OR guild owner
        const settings = await getGuildSettings(ctx, interaction.guildId);
        const supportRoleIds = settings?.supportRoleIds || [];
        const hasSupportRole = Array.isArray(member?.roles?.cache)
          ? member.roles.cache.some(r => supportRoleIds.includes(r.id))
          : (member?.roles?.cache?.some?.(r => supportRoleIds.includes(r.id)) ?? false);
        const isManager = interaction.memberPermissions?.has?.("ManageGuild");
        const isOwner = guild?.ownerId === meUserId;
        if (!hasSupportRole && !isManager && !isOwner) {
          return safeReply(interaction, { content: "You cannot assign this ticket to yourself.", ephemeral: true });
        }

        const currentAssignee = ticket.assigneeId || null;
        // Reassignment rules: permitted if no assignee OR you are current assignee OR ManageGuild OR owner
        const canReassign = !currentAssignee || currentAssignee === meUserId || isManager || isOwner;
        if (!canReassign) {
          return safeReply(interaction, { content: "Only the current assignee, administrators, or the server owner can reassign this ticket.", ephemeral: true });
        }

        const updated = await updateTicket(ctx, interaction.guildId, ticket.ticketId, { assigneeId: meUserId });
        const _newDoc = updated?.value || updated; // handle findOneAndUpdate return vs doc
        // Update recent bot embeds to reflect assignee like transfer flow
        try {
          const channel = await interaction.client.channels.fetch(ticket.channelId).catch(() => null);
          if (channel) {
            const messages = await channel.messages.fetch({ limit: 20 });
            const botMessages = messages.filter(m => m.author.id === interaction.client.user.id && m.embeds?.length);
            const toUpdate = Array.from(botMessages.values()).slice(0, 2);
            for (const msg of toUpdate) {
              const embed = msg.embeds[0];
              if (embed) {
                const newEmbed = EmbedBuilder.from(embed);
                const fields = newEmbed.data.fields || [];
                let found = false;
                for (let f of fields) {
                  if (f.name.toLowerCase().includes("owner") || f.name.toLowerCase().includes("assignee")) {
                    f.value = `<@${meUserId}>`;
                    found = true;
                  }
                }
                if (!found) {
                  fields.push({ name: "Assignee", value: `<@${meUserId}>`, inline: true });
                }
                newEmbed.setFields(fields);
                await msg.edit({ embeds: [newEmbed] });
              }
            }
          }
        } catch (e) {
          logger.warn("[Tickets] assignSelf: failed to update embeds after assignment", { error: e?.message });
        }

        // Audit log
        await sendLog(ctx, interaction.guildId, {
          title: currentAssignee && currentAssignee !== meUserId ? "Ticket Reassigned" : "Ticket Assigned",
          description: `Assigned to <@${meUserId}> by <@${interaction.user.id}>`,
          color: 0x5865f2,
          ticket: { channelId: ticket.channelId, ticketId: ticket.ticketId },
        });
        // DM the new assignee (self) if enabled to mirror transfer flow
        try {
          const settings = await getGuildSettings(ctx, interaction.guildId);
          if (settings?.dmNotifications?.assign) {
            const userToDM = await interaction.client.users.fetch(meUserId).catch(() => null);
            if (userToDM) {
              const embed = new EmbedBuilder()
                .setTitle("Ticket Update")
                .setColor(0x5865f2)
                .addFields(
                  { name: "Ticket", value: `<#${ticket.channelId}> · ID: ${ticket.ticketId}`, inline: false },
                  { name: "Action", value: `Assigned to you`, inline: true },
                  { name: "Server", value: `${interaction.guild?.name || interaction.guildId}`, inline: true },
                  { name: "Performed By", value: `<@${interaction.user.id}>`, inline: true },
                )
                .setTimestamp(new Date());
              await userToDM.send({ embeds: [embed] }).catch((err) => {
                logger?.warn?.("[Tickets] DM assignSelf failed", {
                  error: err?.message,
                  code: err?.code,
                  guildId: interaction.guildId,
                  ticketId: ticket.ticketId,
                  channelId: ticket.channelId,
                  userId: meUserId
                });
              });
            }
          }
        } catch (e) {
          logger?.warn?.("[Tickets] assignSelf DM error", { error: e?.message });
        }

        await safeReply(interaction, { content: "Assigned to you.", ephemeral: true });
      } catch (e) {
        logger.error("[Tickets] assignSelf error", { error: e?.message, stack: e?.stack });
        await safeReply(interaction, { content: "Failed to assign the ticket.", ephemeral: true });
      }
    }, { prefix: true })
  );

  // Reopen
  disposers.push(
    interactions.registerButton(moduleName, "tickets:control:reopen:", async (interaction) => {
      try {
        assertInGuild(interaction);
        const ticket = await getTicketByChannel(ctx, interaction.guildId, interaction.channelId);
        if (!ticket) return safeReply(interaction, { content: "Not a ticket channel.", ephemeral: true });
        // Only opener or Manage Guild can reopen
        const isOpener = ticket.openerId === interaction.user.id;
        const isManager = interaction.memberPermissions?.has?.("ManageGuild");
        if (!isOpener && !isManager) {
          return safeReply(interaction, { content: "You cannot reopen this ticket.", ephemeral: true });
        }

        await reopenTicket(ctx, interaction.guildId, ticket.ticketId);
        await sendLog(ctx, interaction.guildId, {
          title: "Ticket Reopened",
          description: `Reopened by <@${interaction.user.id}>`,
          color: 0x57f287,
          ticket: { channelId: ticket.channelId, ticketId: ticket.ticketId },
        });

        // Optional metrics: ticket reopened
        try {
          const mod = await import("../../../core/reporting.js").catch(() => null);
          const report = mod?.report;
          if (typeof report === "function") {
            report("tickets.ticket_reopened", {
              guildId: interaction.guildId,
              ticketId: ticket.ticketId,
              userId: interaction.user.id,
            });
          }
        } catch (err) { void err; }

        await safeReply(interaction, { content: "Ticket reopened. Channel will be restored by staff flow.", ephemeral: true });
      } catch (e) {
        await safeReply(interaction, { content: e?.message || "Cannot reopen ticket.", ephemeral: true });
      }
    }, { prefix: true })
  );

  lifecycle.addDisposable(() => {
    for (const d of disposers) {
      try { d?.(); } catch (err) { void err; }
    }
  });

  return () => {
    for (const d of disposers) {
      try { d?.(); } catch (err) { void err; }
    }
  };
}
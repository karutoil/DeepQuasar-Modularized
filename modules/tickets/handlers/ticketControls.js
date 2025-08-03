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
  PermissionFlagsBits,
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
      const [, , , , ticketId] = interaction.customId.split(":");
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
        const ticketId = parts[4];
        const reason = parts[5] ? Buffer.from(parts[5], "base64url").toString("utf8") : "";
        const guildId = interaction.guildId;

        const ticket = await updateTicket(ctx, guildId, ticketId, {}); // fetch latest
        if (!ticket) return safeReply(interaction, { content: "Ticket not found.", ephemeral: true });

        await beginClosing(ctx, guildId, ticketId);

        // Transcript
        let transcript = null;
        try {
          transcript = await generateTranscriptAndUpload(ctx, guildId, ticket.channelId);
        } catch (e) {
          logger.warn("[Tickets] transcript failure on close", { error: e?.message });
        }

        // Finalize closed
        await finalizeClosed(ctx, guildId, ticketId, { reason: reason || "Closed by staff/user", transcript });

        // DM opener if configured
        try {
          const settings = await getGuildSettings(ctx, guildId);
          if (settings?.transcript?.dmUser) {
            const user = await client.users.fetch(ticket.openerId).catch(() => null);
            if (user) {
              const msg = transcript?.url
                ? `Your ticket has been closed.\nReason: ${reason || "No reason provided"}\nTranscript: ${transcript.url}`
                : `Your ticket has been closed.\nReason: ${reason || "No reason provided"}`;
              await user.send(msg).catch(() => {});
            }
          }
        } catch {}

        // Log
        await sendLog(ctx, guildId, {
          title: "Ticket Closed",
          description: `Ticket ${ticket.ticketId} closed by <@${interaction.user.id}>.\nReason: ${reason || "N/A"}`,
          color: 0xed4245,
          fields: [{ name: "Channel", value: `<#${ticket.channelId}>` }],
        });

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
        } catch {}

        // Delete channel then archive
        const channel = await interaction.client.channels.fetch(ticket.channelId).catch(() => null);
        if (channel && channel.deletable) {
          await channel.delete("Ticket closed");
        }
        await archiveTicket(ctx, guildId, ticketId);

        await safeReply(interaction, { content: "Ticket closed.", ephemeral: true });
      } catch (e) {
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
          const allow = new PermissionsBitField(o.allow || 0).toArray().reduce((acc, k) => ({ ...acc, [k]: true }), {});
          const deny = new PermissionsBitField(o.deny || 0).toArray().reduce((acc, k) => ({ ...acc, [k]: false }), {});
          await channel.permissionOverwrites.edit(o.id, { ...allow, ...deny }).catch(() => {});
        }
        await setLocked(ctx, interaction.guildId, ticket.ticketId, true);

        await sendLog(ctx, interaction.guildId, {
          title: "Ticket Locked",
          description: `Locked by <@${interaction.user.id}>`,
          color: 0xf1c40f,
        });
        await safeReply(interaction, { content: "Ticket locked.", ephemeral: true });
      } catch {
        await safeReply(interaction, { content: "Lock failed.", ephemeral: true });
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
          const allow = new PermissionsBitField(o.allow || 0).toArray().reduce((acc, k) => ({ ...acc, [k]: true }), {});
          const deny = new PermissionsBitField(o.deny || 0).toArray().reduce((acc, k) => ({ ...acc, [k]: false }), {});
          await channel.permissionOverwrites.edit(o.id, { ...allow, ...deny }).catch(() => {});
        }
        await setLocked(ctx, interaction.guildId, ticket.ticketId, false);

        await sendLog(ctx, interaction.guildId, {
          title: "Ticket Unlocked",
          description: `Unlocked by <@${interaction.user.id}>`,
          color: 0x57f287,
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
        const [, , , , ticketId] = interaction.customId.split(":");
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
          } catch {}

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
      try {
        assertInGuild(interaction); requireManageGuild(interaction);
        const ticket = await getTicketByChannel(ctx, interaction.guildId, interaction.channelId);
        if (!ticket) return safeReply(interaction, { content: "Not a ticket channel.", ephemeral: true });

        const modal = new ModalBuilder().setCustomId(`tickets:control:addUserModal:${ticket.ticketId}`).setTitle("Add User to Ticket");
        const userId = new TextInputBuilder().setCustomId("userId").setLabel("User ID").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(25);
        modal.addComponents(new ActionRowBuilder().addComponents(userId));
        await interaction.showModal(modal);
      } catch {
        await safeReply(interaction, { content: "Failed to open add user modal.", ephemeral: true });
      }
    }, { prefix: true })
  );

  disposers.push(
    interactions.registerModal(moduleName, "tickets:control:addUserModal:", async (interaction) => {
      try {
        const [, , , , ticketId] = interaction.customId.split(":");
        const uid = interaction.fields.getTextInputValue("userId")?.trim();
        const ticket = await updateTicket(ctx, interaction.guildId, ticketId, {}); // fetch latest
        if (!ticket) return safeReply(interaction, { content: "Ticket not found.", ephemeral: true });

        const channel = await interaction.client.channels.fetch(ticket.channelId).catch(() => null);
        if (!channel) return safeReply(interaction, { content: "Channel not found.", ephemeral: true });

        await addParticipant(ctx, interaction.guildId, ticket.ticketId, uid);
        await channel.permissionOverwrites.edit(uid, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        }).catch(() => {});

        await sendLog(ctx, interaction.guildId, {
          title: "User Added to Ticket",
          description: `Added <@${uid}> by <@${interaction.user.id}>`,
          color: 0x57f287,
        });
        await safeReply(interaction, { content: "User added.", ephemeral: true });
      } catch {
        await safeReply(interaction, { content: "Failed to add user.", ephemeral: true });
      }
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
        });
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

        const modal = new ModalBuilder().setCustomId(`tickets:control:transferModal:${ticket.ticketId}`).setTitle("Transfer Ticket");
        const userId = new TextInputBuilder().setCustomId("assigneeId").setLabel("Assignee User ID").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(25);
        modal.addComponents(new ActionRowBuilder().addComponents(userId));
        await interaction.showModal(modal);
      } catch {
        await safeReply(interaction, { content: "Failed to open transfer modal.", ephemeral: true });
      }
    }, { prefix: true })
  );

  disposers.push(
    interactions.registerModal(moduleName, "tickets:control:transferModal:", async (interaction) => {
      try {
        const [, , , , ticketId] = interaction.customId.split(":");
        const assigneeId = interaction.fields.getTextInputValue("assigneeId")?.trim();
        const ticket = await updateTicket(ctx, interaction.guildId, ticketId, { assigneeId });
        if (!ticket) return safeReply(interaction, { content: "Ticket not found.", ephemeral: true });

        await sendLog(ctx, interaction.guildId, {
          title: "Ticket Transferred",
          description: `Assigned to <@${assigneeId}> by <@${interaction.user.id}>`,
          color: 0x5865f2,
        });
        await safeReply(interaction, { content: "Ticket transferred.", ephemeral: true });
      } catch {
        await safeReply(interaction, { content: "Transfer failed.", ephemeral: true });
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
        } catch {}

        await safeReply(interaction, { content: "Ticket reopened. Channel will be restored by staff flow.", ephemeral: true });
      } catch (e) {
        await safeReply(interaction, { content: e?.message || "Cannot reopen ticket.", ephemeral: true });
      }
    }, { prefix: true })
  );

  lifecycle.addDisposable(() => {
    for (const d of disposers) {
      try { d?.(); } catch {}
    }
  });

  return () => {
    for (const d of disposers) {
      try { d?.(); } catch {}
    }
  };
}
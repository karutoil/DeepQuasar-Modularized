// UI factories for Tickets module: embeds, buttons, selects, modals
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
import { ControlIds } from "./ids.js";

export function ticketControlEmbed({ ticketId, openerTag, typeName, status, createdAt }) {
  const e = new EmbedBuilder()
    .setTitle("Ticket Controls")
    .setColor(0x5865f2)
    .setDescription("Use the buttons below to manage this ticket.")
    .addFields(
      { name: "Ticket ID", value: ticketId, inline: true },
      { name: "Status", value: status || "open", inline: true },
      { name: "Opener", value: openerTag || "Unknown", inline: true },
      ...(typeName ? [{ name: "Type", value: typeName, inline: true }] : []),
      ...(createdAt ? [{ name: "Created", value: `<t:${Math.floor(createdAt / 1000)}:R>`, inline: true }] : []),
    );
  return e;
}

export function ticketControlRows(ticketId, { locked = false } = {}) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(ControlIds.Close(ticketId)).setLabel("Close").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(ControlIds.Transcript(ticketId)).setLabel("Transcript").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(ControlIds.Rename(ticketId)).setLabel("Rename").setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(ControlIds.AddUser(ticketId)).setLabel("Add User").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(ControlIds.RemoveUser(ticketId)).setLabel("Remove User").setStyle(ButtonStyle.Secondary),
    locked
      ? new ButtonBuilder().setCustomId(ControlIds.Unlock(ticketId)).setLabel("Unlock").setStyle(ButtonStyle.Success)
      : new ButtonBuilder().setCustomId(ControlIds.Lock(ticketId)).setLabel("Lock").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(ControlIds.Transfer(ticketId)).setLabel("Transfer").setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2];
}

export function renameModal(ticketId) {
  const modal = new ModalBuilder().setCustomId(`tickets:control:rename:${ticketId}`).setTitle("Rename Ticket");
  const input = new TextInputBuilder()
    .setCustomId("name")
    .setLabel("New channel name")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

export function closeReasonModal(ticketId) {
  const modal = new ModalBuilder().setCustomId(`tickets:control:close:${ticketId}`).setTitle("Close Ticket");
  const input = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("Reason for closing")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

export function addUserSelect(ticketId) {
  const sel = new StringSelectMenuBuilder()
    .setCustomId(`tickets:control:addUser:${ticketId}`)
    .setPlaceholder("Select a user by ID (enter via modal in future)")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions([{ label: "Enter user ID via modal (not implemented)", value: "noop" }]);
  return new ActionRowBuilder().addComponents(sel);
}

export function roleTransferSelect(ticketId) {
  // In practice, use RoleSelect; we use RoleSelectMenuBuilder
  const sel = new RoleSelectMenuBuilder()
    .setCustomId(`tickets:control:transfer:${ticketId}`)
    .setPlaceholder("Select a support role to transfer ownership visibility");
  return new ActionRowBuilder().addComponents(sel);
}

export function categorySelectForSetup() {
  return new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("tickets:general:selectCategory")
      .setPlaceholder("Select Ticket Category")
      .addChannelTypes(ChannelType.GuildCategory)
  );
}

export function logChannelSelectForSetup() {
  return new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("tickets:general:selectLog")
      .setPlaceholder("Select Log Channel")
      .addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread)
  );
}

export function supportRolesSelectForSetup() {
  return new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("tickets:general:selectRoles")
      .setPlaceholder("Select Support Roles")
  );
}
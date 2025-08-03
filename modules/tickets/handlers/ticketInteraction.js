// User-facing ticket creation flow: Create Ticket button and modal + channel creation
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CategoryChannel,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { getGuildSettings } from "../services/settingsService.js";
import { createTicketDoc } from "../services/ticketService.js";
import { ticketControlEmbed, ticketControlRows, closeReasonModal } from "../utils/components.js";

export async function registerTicketInteractionHandlers(ctx) {
  const { logger, lifecycle, client, interactions } = ctx;
  const moduleName = "tickets";
  const disposers = [];

  if (!interactions) {
    logger.warn("[Tickets] interactions registrar not available for ticket interaction handlers");
    return () => {};
  }

  // Prefix handler for user panel buttons: tickets:user:create:{typeId}
  disposers.push(
    interactions.registerButton(moduleName, "tickets:user:create:", async (interaction) => {
      try {
        const { assertInGuild } = await import("../utils/validators.js");
        assertInGuild(interaction);
        const [, , , typeId] = interaction.customId.split(":"); // tickets:user:create:{typeId}
        // Open a modal to collect title and description
        const modal = new ModalBuilder().setCustomId(`tickets:user:createModal:${typeId}`).setTitle("Create Ticket");

      const title = new TextInputBuilder()
        .setCustomId("title")
        .setLabel("Title")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      const desc = new TextInputBuilder()
        .setCustomId("description")
        .setLabel("Describe your issue")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1800);

      modal.addComponents(
        new ActionRowBuilder().addComponents(title),
        new ActionRowBuilder().addComponents(desc),
      );

      await interaction.showModal(modal);
      } catch (e) {
        const { safeReply } = await import("../utils/validators.js");
        await safeReply(interaction, { content: "Ticket creation is only available in servers.", ephemeral: true });
      }
    }, { prefix: true })
  );

  // Modal submit -> create channel under configured category and post initial/control embeds
  disposers.push(
    interactions.registerModal(moduleName, "tickets:user:createModal:", async (interaction) => {
      const { assertInGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction);
        const [, , , , typeId] = interaction.customId.split(":"); // tickets:user:createModal:{typeId}
        const guild = interaction.guild;
        const user = interaction.user;
        const guildId = interaction.guildId;

              const title = interaction.fields.getTextInputValue("title")?.trim()?.slice(0, 100);
              const description = interaction.fields.getTextInputValue("description")?.trim()?.slice(0, 1800);

        // Load settings for category and support roles
        const settings = await getGuildSettings(ctx, guildId);
        if (!settings.ticketCategoryId) {
          return safeReply(interaction, { content: "Ticket category is not configured by admins yet.", ephemeral: true });
        }

      // Create channel name safe
      const base = (title || "ticket").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "ticket";
      const channelName = `ticket-${base}`;

      // Compute permission overwrites using centralized helper for consistency
      const { buildBaseOverwrites } = await import("../utils/permissions.js");
      const me = guild.members.me || (await guild.members.fetch(client.user.id).catch(() => null));
      const overwrites = buildBaseOverwrites({
        everyoneId: guild.roles.everyone?.id,
        openerId: user.id,
        supportRoleIds: settings.supportRoleIds || [],
        botId: me?.id,
      });

      // Create channel under category
      let channel = null;
      try {
        channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: settings.ticketCategoryId,
          permissionOverwrites: overwrites,
          reason: `Ticket for ${user.tag} (${user.id})`,
        });
      } catch (e) {
        logger.error("[Tickets] Channel creation failed", { guildId, error: e?.message });
        return interaction.reply({ content: "Failed to create ticket channel. Please contact an admin.", ephemeral: true });
      }

      // Persist ticket
      const doc = await createTicketDoc(ctx, {
        guildId,
        openerId: user.id,
        typeId,
        channelId: channel.id,
        assigneeId: null,
        participantIds: [user.id],
      });

      // Fetch type to use welcome message and ping roles
      let typeDoc = null;
      try {
        const { getType } = await import("../services/typeService.js");
        typeDoc = await getType(ctx, guildId, typeId);
      } catch {}

      // Initial message in ticket channel
      const intro = new EmbedBuilder()
        .setTitle(title || "New Ticket")
        .setDescription(
          (typeDoc?.welcomeMessage ? `${typeDoc.welcomeMessage}\n\n` : "") +
          (description || "No description provided.")
        )
        .setColor(0x2f3136)
        .addFields(
          { name: "Opened by", value: `${user.tag} (${user.id})`, inline: true },
          { name: "Type", value: (typeDoc?.name || typeId || "default"), inline: true },
        );

      const controls = ticketControlEmbed({
        ticketId: doc.ticketId,
        openerTag: user.tag,
        typeName: typeDoc?.name || typeId || "default",
        status: "open",
        createdAt: Date.now(),
      });

      const controlRows = ticketControlRows(doc.ticketId, { locked: false });

      // Mentions: guild-level support roles + type-specific ping roles
      const mentions = [
        ...(settings.supportRoleIds || []).map((rid) => `<@&${rid}>`),
        ...(typeDoc?.pingRoleIds || []).map((rid) => `<@&${rid}>`),
      ].filter(Boolean);

      await channel.send({ content: mentions.length ? mentions.join(" ") : null, embeds: [intro] }).catch(() => {});
      await channel.send({ embeds: [controls], components: controlRows });

      // Optional metrics: ticket created
      try {
        const mod = await import("../../../core/reporting.js").catch(() => null);
        const report = mod?.report;
        if (typeof report === "function") {
          report("tickets.ticket_created", {
            guildId,
            ticketId: doc.ticketId,
            openerId: user.id,
            typeId: typeId || null,
          });
        }
      } catch {}

      // Acknowledge creation to the user
      await safeReply(interaction, { content: `Ticket created: <#${channel.id}>`, ephemeral: true });
    } catch (e) {
      await safeReply(interaction, { content: "Failed to create ticket.", ephemeral: true });
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
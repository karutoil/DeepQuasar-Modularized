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
        const customIdParts = interaction.customId.split(":");
        const [, , , typeId] = customIdParts; // tickets:user:create:{typeId}
        // Log panel button press with typeId and panelId (if available)
        const panelId = interaction.message?.interaction?.customId?.split(":")[3] || null;
        logger.info("[Tickets] Panel button pressed", {
          customId: interaction.customId,
          customIdParts,
          typeId,
          panelId,
          channelId: interaction.channelId,
          userId: interaction.user?.id
        });

        // Open a modal to collect title and description
        const modalCustomId = `tickets:user:createModal:${typeId}`;
        logger.info("[Tickets] Creating modal", { modalCustomId, typeId });
        const modal = new ModalBuilder().setCustomId(modalCustomId).setTitle("Create Ticket");

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

  // ...existing code...

  // Handler for ticket close button: tickets:control:close:ticketId=xxx
  disposers.push(
    interactions.registerButton(moduleName, "tickets:control:close:", async (interaction) => {
      try {
        const customIdParts = interaction.customId.split(":");
        // Example: tickets:control:close:ticketId=mdwb5uur-x5k8mj
        const ticketId = customIdParts[3]?.replace("ticketId=", "");
        logger.info("[Tickets] Close button pressed", {
          customId: interaction.customId,
          customIdParts,
          ticketId,
          channelId: interaction.channelId,
          userId: interaction.user?.id
        });

        // Attempt to close the ticket (replace with your actual close logic)
        const { closeTicket } = await import("../services/ticketService.js");
        let result = null;
        try {
          result = await closeTicket(ctx, ticketId, interaction.channelId, interaction.user?.id);
          logger.info("[Tickets] closeTicket result", { ticketId, result });
        } catch (err) {
          logger.error("[Tickets] closeTicket error", { ticketId, error: err?.message, stack: err?.stack });
          await interaction.reply({ content: "Failed to close ticket.", ephemeral: true });
          return;
        }

        // Success response (customize as needed)
        await interaction.reply({ content: "Ticket closed successfully.", ephemeral: true });
      } catch (e) {
        logger.error("[Tickets] Close button handler error", { error: e?.message, stack: e?.stack });
        await interaction.reply({ content: "Failed to close ticket.", ephemeral: true });
      }
    }, { prefix: true })
  );
  disposers.push(
    interactions.registerModal(moduleName, "tickets:user:createModal:", async (interaction) => {
      const { assertInGuild, safeReply } = await import("../utils/validators.js");
      try {
        assertInGuild(interaction);
        const customIdParts = interaction.customId.split(":");
        const [, , , typeId] = customIdParts; // tickets:user:createModal:{typeId}
        logger.info("[Tickets] Modal submitted", {
          customId: interaction.customId,
          customIdParts,
          typeId,
          channelId: interaction.channelId,
          userId: interaction.user?.id
        });
        const guild = interaction.guild;
        const user = interaction.user;
        const guildId = interaction.guildId;

        // Title is now informational only; does not affect channel name
        const title = interaction.fields.getTextInputValue("title")?.trim()?.slice(0, 100);
        const description = interaction.fields.getTextInputValue("description")?.trim()?.slice(0, 1800);

        // Load settings for category and support roles
        const settings = await getGuildSettings(ctx, guildId);
        if (!settings.ticketCategoryId) {
          return safeReply(interaction, { content: "Ticket category is not configured by admins yet.", ephemeral: true });
        }

        // Compute channel name from global format, ignoring modal title
        function pad2(n) { return String(n).padStart(2, "0"); }
        function sanitizeChannelName(s) {
          return (s || "ticket")
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 100) || "ticket";
        }
        async function nextTicketCount(ctx, guildId) {
          try {
            const db = await ctx.mongo.getDb();
            const res = await db.collection("guild_ticket_counters").findOneAndUpdate(
              { guildId },
              { $inc: { count: 1 }, $setOnInsert: { guildId, createdAt: new Date() } },
              { upsert: true, returnDocument: "after" }
            );
            // driver returns {value} sometimes; normalize
            return (res?.value?.count) || res?.count || 1;
          } catch {
            return 1;
          }
        }
        function formatTicketName(fmt, ctxObj) {
          const now = new Date();
          const yyyy = String(now.getFullYear());
          const mm = pad2(now.getMonth() + 1);
          const dd = pad2(now.getDate());
          const HH = pad2(now.getHours());
          const MM = pad2(now.getMinutes());
          const SS = pad2(now.getSeconds());
          const shortdate = `${mm}${dd}`;
          const ts = Math.floor(now.getTime() / 1000);
          let out = String(fmt || "ticket-{userid}-{shortdate}");
          out = out.replace(/\{username\}/g, ctxObj.username || "");
          out = out.replace(/\{user_tag\}/g, ctxObj.user_tag || "");
          out = out.replace(/\{userid\}/g, ctxObj.userid || "");
          out = out.replace(/\{type\}/g, ctxObj.type || "");
          out = out.replace(/\{count\}/g, String(ctxObj.count ?? ""));
          out = out.replace(/\{date\}/g, `${yyyy}-${mm}-${dd}`);
          out = out.replace(/\{time\}/g, `${HH}-${MM}-${SS}`);
          out = out.replace(/\{shortdate\}/g, shortdate);
          out = out.replace(/\{timestamp\}/g, String(ts));
          out = out.replace(/\{server\}/g, ctxObj.server || "");
          out = out.replace(/\{channel_id\}/g, ctxObj.channel_id || "");
          out = out.replace(/\{ticket_id\}/g, ctxObj.ticket_id || "");
          return out;
        }
        const count = await nextTicketCount(ctx, guildId);
        const provisional = sanitizeChannelName(
          formatTicketName(
            (settings.ticketNameFormat || "ticket-{userid}-{shortdate}").replace(/\{channel_id\}/g, ""), // strip channel_id for provisional
            {
              username: user.username,
              user_tag: `${user.username}${user.discriminator ? "#" + user.discriminator : ""}`,
              userid: user.id,
              type: "", // resolved after getType below
              count,
              server: guild?.name || "",
              ticket_id: "pending",
            }
          )
        );
        let channelName = provisional || "ticket";

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
        // Explicitly log typeId value and type before ticket doc creation
        logger.info("[Tickets] Pre-ticket doc typeId debug", {
          typeId,
          type: typeof typeId,
          customIdParts
        });
        logger.info("[Tickets] Creating ticket doc", {
          args: {
            guildId,
            openerId: user.id,
            typeId,
            channelId: channel.id,
            assigneeId: null,
            participantIds: [user.id],
          }
        });
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
        // Explicitly log typeId value and type before getType call
        logger.info("[Tickets] Pre-getType typeId debug", {
          typeId,
          type: typeof typeId,
          customIdParts
        });
        try {
          const { getType, listTypes } = await import("../services/typeService.js");
          logger.info("[Tickets] getType call", { ctxType: typeof ctx, guildId, typeId });
          typeDoc = await getType(ctx, guildId, typeId);
          logger.info("[Tickets] getType result", { typeId, typeDoc });
          if (!typeDoc) {
            // Orphaned typeId detected, warn admins in the ticket channel
            const allTypes = await listTypes(ctx, guildId);
            const validTypeIds = allTypes.map(t => t.typeId);
            await channel.send({
              content: `:warning: This ticket was created with a typeId (\u001b[1m${typeId}\u001b[0m) that does not exist. Valid typeIds: ${validTypeIds.join(", ")}. Please update your panel buttons.`,
              allowedMentions: { parse: [] }
            });
          }
        } catch (e) {
          logger.warn("[Tickets] getType error", { typeId, error: e?.message });
        }

        // After type resolved, possibly rename with full format including type/channel_id/ticket_id
        try {
          const fullNameRaw = formatTicketName(settings.ticketNameFormat || "ticket-{userid}-{shortdate}", {
            username: user.username,
            user_tag: `${user.username}${user.discriminator ? "#" + user.discriminator : ""}`,
            userid: user.id,
            type: typeDoc?.name || (typeDoc === null ? "Unknown Type" : typeId || "default"),
            count,
            server: guild?.name || "",
            channel_id: channel.id,
            ticket_id: doc.ticketId,
          });
          const fullName = sanitizeChannelName(fullNameRaw);
          if (fullName && fullName !== channel.name && channel.manageable) {
            await channel.setName(fullName, "Apply configured ticket naming format");
          }
          try {
            const { sendLog } = await import("../services/loggingService.js");
            await sendLog(ctx, guildId, {
              title: "Ticket Channel Named",
              description: `Generated by configured format`,
              color: 0x2f3136,
              fields: [
                { name: "Result", value: `\`${fullName}\``, inline: true },
                { name: "Format", value: `\`${settings.ticketNameFormat || "ticket-{userid}-{shortdate}"}\``, inline: false },
              ],
              ticket: { channelId: channel.id, ticketId: doc.ticketId },
            });
          } catch (err) { void err; }
        } catch (err) { void err; }
        // Initial message in ticket channel
        const typeLabel = typeDoc?.name || (typeDoc === null ? "Unknown Type" : typeId || "default");
        const intro = new EmbedBuilder()
          .setTitle(title || "New Ticket")
          .setDescription(
            (typeDoc?.welcomeMessage ? `${typeDoc.welcomeMessage}\n\n` : "") +
            (description || "No description provided.")
          )
          .setColor(0x2f3136)
          .addFields(
            { name: "Opened by", value: `${user.tag} (${user.id})`, inline: true },
            { name: "Type", value: typeLabel, inline: true },
          );

        const controls = ticketControlEmbed({
          ticketId: doc.ticketId,
          openerTag: user.tag,
          typeName: typeLabel,
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
        } catch (err) { void err; }

        // Acknowledge creation to the user
        await safeReply(interaction, { content: `Ticket created: <#${channel.id}>`, ephemeral: true });
    } catch (e) {
      await safeReply(interaction, { content: "Failed to create ticket.", ephemeral: true });
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
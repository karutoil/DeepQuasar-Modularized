import { createInteractionCommand } from "../../../core/builders.js";
import { ChannelType, PermissionsBitField, EmbedBuilder } from "discord.js";
import { createPaginatedEmbed, createForm, parseModal, createMultiSelectMenu } from "../../../core/ui.js";
import { getGuildSettings, getUserSettings, updateUserSettings } from "../services/settingsService.js";
import { createTempVc, getTempVcByChannelId, getTempVcByOwnerId, updateTempVc, deleteTempVc, addTempVcMember, removeTempVcMember } from "../services/tempvcService.js";

const MODULE_NAME = "tempvc";

export function registerVoiceStateListener(ctx, moduleName) {
  const { client, events, logger, dsl, embed } = ctx;

  const builder = createInteractionCommand()
    .setName("tempvc_user_panel") // Dummy command name for builder's customId generation
    .setDescription("Internal command for TempVC user panel");

  // Map to store message IDs of user panels to their associated temp VC channel ID
  const userPanelMessages = new Map(); // messageId -> tempVcChannelId

  const disposeListener = events.on(moduleName, "voiceStateUpdate", dsl.withTryCatch(async (oldState, newState) => {
    // User joined a channel
    if (!oldState.channelId && newState.channelId) {
      await handleUserJoin(newState);
    }
    // User left a channel
    else if (oldState.channelId && !newState.channelId) {
      await handleUserLeave(oldState);
    }
    // User moved channels
    else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      await handleUserLeave(oldState);
      await handleUserJoin(newState);
    }
  }));

  async function handleUserJoin(newState) {
    const { guild, member, channel } = newState;
    if (!guild || !member || !channel || member.user.bot) return;

    const guildSettings = await getGuildSettings(ctx, guild.id);
    const creationChannels = guildSettings.creationChannels || [];

    // Check if the joined channel is a designated creation channel
    if (creationChannels.includes(channel.id)) {
      logger.info(`User ${member.user.tag} joined a creation channel: ${channel.name}`);

      // Check if user already owns a temp VC
      const existingTempVc = await getTempVcByOwnerId(ctx, guild.id, member.id);
      if (existingTempVc) {
        logger.info(`User ${member.user.tag} already owns a temp VC: ${existingTempVc.channelId}. Moving them there.`);
        try {
          await member.voice.setChannel(existingTempVc.channelId);
          await sendUserPanel(member, existingTempVc.channelId, existingTempVc.ownerId);
        } catch (error) {
          logger.error(`Failed to move user to existing temp VC: ${error.message}`);
          await member.send({ embeds: [embed.error({ description: `Failed to move you to your existing temporary channel. Please try again.` })] }).catch(() => {});
        }
        return;
      }

      // Create new temp VC
      try {
        const userSettings = await getUserSettings(ctx, guild.id, member.id);
        const channelName = guildSettings.nameTemplate?.replace("{username}", member.user.username) || `${member.user.username}'s VC`;
        const defaultLimit = userSettings.userLimit ?? guildSettings.defaultLimit ?? 0;
        const defaultBitrate = userSettings.bitrate ?? guildSettings.defaultBitrate ?? guild.features.includes('VIP_REGIONS') ? 128000 : 64000; // Default to 64kbps, 128kbps for VIP guilds
        const defaultPermissions = userSettings.permissions ?? guildSettings.defaultPermissions ?? [];

        const newChannel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildVoice,
          parent: guildSettings.categoryId || null,
          userLimit: defaultLimit,
          bitrate: defaultBitrate,
          permissionOverwrites: [
            { id: guild.id, deny: [PermissionsBitField.Flags.Connect] }, // Deny everyone by default
            { id: member.id, allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.MuteMembers, PermissionsBitField.Flags.DeafenMembers, PermissionsBitField.Flags.MoveMembers] }, // Owner permissions
            ...defaultPermissions.map(p => ({ id: guild.id, allow: [p] })) // Apply default permissions
          ],
        });

        await createTempVc(ctx, {
          guildId: guild.id,
          channelId: newChannel.id,
          ownerId: member.id,
          userLimit: defaultLimit,
          bitrate: defaultBitrate,
          isLocked: true, // Default to locked
          isPublic: false, // Default to private
        });

        logger.info(`Created new temp VC ${newChannel.name} for ${member.user.tag}`);
        await member.voice.setChannel(newChannel.id);
        await sendUserPanel(member, newChannel.id, member.id);
      } catch (error) {
        logger.error(`Failed to create temp VC for ${member.user.tag}: ${error.message}`);
        await member.send({ embeds: [embed.error({ description: `Failed to create your temporary channel. Please try again.` })] }).catch(() => {});
      }
    }
  }

  async function handleUserLeave(oldState) {
    const { guild, member, channel } = oldState;
    if (!guild || !member || !channel || member.user.bot) return;

    const tempVc = await getTempVcByChannelId(ctx, channel.id);
    if (tempVc && tempVc.ownerId === member.id) {
      // Owner left the channel
      logger.info(`Owner ${member.user.tag} left their temp VC: ${channel.name}`);

      // Check if channel is empty
      if (channel.members.size === 0) {
        logger.info(`Temp VC ${channel.name} is empty. Deleting...`);
        try {
          await channel.delete();
          await deleteTempVc(ctx, channel.id);
          // Remove user panel message
          for (const [msgId, vcId] of userPanelMessages.entries()) {
            if (vcId === channel.id) {
              const msg = await member.user.dmChannel?.messages.fetch(msgId).catch(() => null);
              if (msg) await msg.delete().catch(() => {});
              userPanelMessages.delete(msgId);
              break;
            }
          }
        } catch (error) {
          logger.error(`Failed to delete empty temp VC: ${error.message}`);
        }
      } else {
        // Transfer ownership if other members are present
        const newOwner = channel.members.first();
        if (newOwner) {
          logger.info(`Transferring ownership of ${channel.name} to ${newOwner.user.tag}`);
          await updateTempVc(ctx, channel.id, { ownerId: newOwner.id });
          await newOwner.send({ embeds: [embed.info({ description: `You are now the owner of ${channel.name}.` })] }).catch(() => {});
          await sendUserPanel(newOwner, channel.id, newOwner.id);
        }
      }
    } else if (tempVc) {
      // A non-owner member left a temp VC
      await removeTempVcMember(ctx, channel.id, member.id);
    }
  }

  async function sendUserPanel(member, tempVcChannelId, ownerId) {
    const tempVc = await getTempVcByChannelId(ctx, tempVcChannelId);
    if (!tempVc) return;

    const guildSettings = await getGuildSettings(ctx, tempVc.guildId);
    const userSettings = await getUserSettings(ctx, tempVc.guildId, member.id);

    const channel = await client.channels.fetch(tempVcChannelId);
    if (!channel) return;

    const embedDescription = `Manage your temporary voice channel: <#${tempVcChannelId}>

` +
      `**Current Settings:**
` +
      `User Limit: ${tempVc.userLimit === 0 ? 'Unlimited' : tempVc.userLimit}
` +
      `Bitrate: ${tempVc.bitrate / 1000} kbps
` +
      `Locked: ${tempVc.isLocked ? 'Yes' : 'No'}
` +
      `Public: ${tempVc.isPublic ? 'Yes' : 'No'}
` +
      `Owner: <@${tempVc.ownerId}>`;

    const userPanelEmbed = embed.info({
      title: "Your Temporary Voice Channel Panel",
      description: embedDescription,
    });

    const selectOptions = [
      { label: "Set User Limit", value: "set_user_limit" },
      { label: "Set Bitrate", value: "set_bitrate" },
    ];

    if (guildSettings.publicPrivateEnabled) {
      selectOptions.push({ label: "Toggle Public/Private", value: "toggle_public_private" });
    }
    if (guildSettings.kickBanEnabled) {
      selectOptions.push({ label: "Kick User", value: "kick_user" });
      selectOptions.push({ label: "Ban User", value: "ban_user" });
    }
    if (guildSettings.transferOwnershipEnabled) {
      selectOptions.push({ label: "Transfer Ownership", value: "transfer_ownership" });
    }
    selectOptions.push({ label: "Rename Channel", value: "rename_channel" });
    selectOptions.push({ label: "Delete Channel", value: "delete_channel" });

    const selectMenu = builder.select(ctx, MODULE_NAME, "user_panel_select", "Select an action...", selectOptions);

    // Payload for both DM fallback and integrated voice text chat
    const messagePayload = {
      embeds: [userPanelEmbed],
      components: [{ type: 1, components: [selectMenu] }],
    };

    // 1) Try to send to the voice channel's integrated text chat
    let controlMessage = null;
    try {
      controlMessage = await channel.send({
        content: `🎙️ Welcome to your temporary voice channel, <@${tempVc.ownerId}>! Use the controls below to manage your channel.`,
        ...messagePayload
      });
      logger.info(`Sent TempVC control panel to voice channel text chat for ${member.user.tag}`);
    } catch (e) {
      logger.warn(`Failed to send control panel to voice text chat: ${e.message}. Will try DM fallback.`);
    }

    // 2) DM fallback if channel.send failed
    if (!controlMessage) {
      try {
        const dmPayload = { ...messagePayload, ephemeral: true };
        controlMessage = await member.send(dmPayload);
        logger.info(`Sent TempVC control panel via DM to ${member.user.tag}`);
      } catch (e) {
        logger.error(`Failed to send user panel to ${member.user.tag}: ${e.message}`);
      }
    }

    if (controlMessage) {
      userPanelMessages.set(controlMessage.id, tempVcChannelId);
    }
  }

  // User panel select menu handler
  // Do NOT defer here because some branches invoke showModal; showModal fails after deferReply.
  builder.onSelect("user_panel_select", dsl.withTryCatch(async (interaction) => {
    const [selectedOption] = interaction.values;
    const { guild, member, channel } = interaction;
    const tempVc = await getTempVcByOwnerId(ctx, guild.id, member.id);

    if (!tempVc || tempVc.channelId !== channel.id) {
      await interaction.editReply?.({ embeds: [embed.error({ description: "You are not the owner of this temporary channel or you are not in your temporary channel." })], components: [] }).catch(() => {});
      return;
    }

    const guildSettings = await getGuildSettings(ctx, guild.id);

    switch (selectedOption) {
      case "set_user_limit":
        await handleSetUserLimit(interaction, tempVc); // opens modal
        break;
      case "set_bitrate":
        await handleSetBitrate(interaction, tempVc); // opens modal
        break;
      case "toggle_public_private":
        if (guildSettings.publicPrivateEnabled) await handleTogglePublicPrivate(interaction, tempVc);
        else await interaction.editReply?.({ embeds: [embed.error({ description: "This feature is disabled by the server administrator." })], components: [] }).catch(() => {});
        break;
      case "kick_user":
        if (guildSettings.kickBanEnabled) await handleKickBanUser(interaction, tempVc);
        else await interaction.editReply?.({ embeds: [embed.error({ description: "This feature is disabled by the server administrator." })], components: [] }).catch(() => {});
        break;
      case "ban_user":
        if (guildSettings.kickBanEnabled) await handleBanUser(interaction, tempVc);
        else await interaction.editReply?.({ embeds: [embed.error({ description: "This feature is disabled by the server administrator." })], components: [] }).catch(() => {});
        break;
      case "transfer_ownership":
        if (guildSettings.transferOwnershipEnabled) await handleTransferOwnership(interaction, tempVc);
        else await interaction.editReply?.({ embeds: [embed.error({ description: "This feature is disabled by the server administrator." })], components: [] }).catch(() => {});
        break;
      case "rename_channel":
        await handleRenameChannel(interaction, tempVc); // opens modal
        break;
      case "delete_channel":
        await handleDeleteChannel(interaction, tempVc);
        break;
      default:
        await interaction.editReply?.({ content: "Unknown action.", ephemeral: true }).catch(() => {});
        break;
    }
    // Re-send the panel after action where applicable (modal flows will update on submit)
    if (!["set_user_limit","set_bitrate","rename_channel"].includes(selectedOption)) {
      await sendUserPanel(member, tempVc.channelId, tempVc.ownerId);
    }
  }));

  // Modals for user panel
  // Important: ModalSubmit interactions have not been deferred/replied yet.
  // Use interaction.reply() first, then followUp/edit as needed.
  builder.onModal("set_user_limit_modal", dsl.withTryCatch(async (interaction) => {
    const { limit } = parseModal(interaction);
    const parsedLimit = parseInt(limit, 10);
    const tempVc = await getTempVcByOwnerId(ctx, interaction.guild.id, interaction.member.id);

    if (!tempVc) {
      await interaction.reply({ embeds: [embed.error({ description: "Could not find your temporary channel." })], ephemeral: true });
      return;
    }

    if (isNaN(parsedLimit) || parsedLimit < 0 || parsedLimit > 99) {
      await interaction.reply({ embeds: [embed.error({ description: "Invalid limit. Must be a number between 0 and 99." })], ephemeral: true });
      return;
    }

    const channel = await client.channels.fetch(tempVc.channelId);
    if (channel) {
      await channel.setUserLimit(parsedLimit);
      await updateTempVc(ctx, tempVc.channelId, { userLimit: parsedLimit });
      await updateUserSettings(ctx, interaction.guild.id, interaction.member.id, { userLimit: parsedLimit });
      await interaction.reply({ embeds: [embed.success({ description: `User limit set to \`${parsedLimit}\`.` })], ephemeral: true });
    }
    await sendUserPanel(interaction.member, tempVc.channelId, tempVc.ownerId);
  }));

  builder.onModal("set_bitrate_modal", dsl.withTryCatch(async (interaction) => {
    const { bitrate } = parseModal(interaction);
    const parsedBitrate = parseInt(bitrate, 10);
    const tempVc = await getTempVcByOwnerId(ctx, interaction.guild.id, interaction.member.id);

    if (!tempVc) {
      await interaction.reply({ embeds: [embed.error({ description: "Could not find your temporary channel." })], ephemeral: true });
      return;
    }

    if (isNaN(parsedBitrate) || parsedBitrate < 8 || parsedBitrate > 128) {
      await interaction.reply({ embeds: [embed.error({ description: "Invalid bitrate. Must be a number between 8 and 128 (in kbps)." })], ephemeral: true });
      return;
    }

    const channel = await client.channels.fetch(tempVc.channelId);
    if (channel) {
      await channel.setBitrate(parsedBitrate * 1000); // Convert to bps
      await updateTempVc(ctx, tempVc.channelId, { bitrate: parsedBitrate * 1000 });
      await updateUserSettings(ctx, interaction.guild.id, interaction.member.id, { bitrate: parsedBitrate * 1000 });
      await interaction.reply({ embeds: [embed.success({ description: `Bitrate set to \`${parsedBitrate} kbps\`.` })], ephemeral: true });
    }
    await sendUserPanel(interaction.member, tempVc.channelId, tempVc.ownerId);
  }));

  builder.onModal("rename_channel_modal", dsl.withTryCatch(async (interaction) => {
    const { new_name } = parseModal(interaction);
    const tempVc = await getTempVcByOwnerId(ctx, interaction.guild.id, interaction.member.id);

    if (!tempVc) {
      await interaction.reply({ embeds: [embed.error({ description: "Could not find your temporary channel." })], ephemeral: true });
      return;
    }

    const channel = await client.channels.fetch(tempVc.channelId);
    if (channel) {
      await channel.setName(new_name);
      await interaction.reply({ embeds: [embed.success({ description: `Channel renamed to ${new_name}.` })], ephemeral: true });
    }
    await sendUserPanel(interaction.member, tempVc.channelId, tempVc.ownerId);
  }));

  // Handlers for user panel actions
  async function handleSetUserLimit(interaction, tempVc) {
    // Build a modal whose customId matches the onModal local name: "set_user_limit_modal"
    const modal = builder.modal(ctx, MODULE_NAME, "set_user_limit_modal", "Set User Limit");
    const limitId = `${MODULE_NAME}:${builder._name}:field:limit`;
    const { ActionRowBuilder } = await import("discord.js");
    const limitInput = builder.textInput(limitId, "User Limit (0-99, 0 for unlimited)", 1, true);
    const row = new ActionRowBuilder().addComponents(limitInput);
    modal.addComponents(row);
    await interaction.showModal(modal);
  }

  async function handleSetBitrate(interaction, tempVc) {
    // Build a modal whose customId matches the onModal local name: "set_bitrate_modal"
    const modal = builder.modal(ctx, MODULE_NAME, "set_bitrate_modal", "Set Bitrate");
    const bitrateId = `${MODULE_NAME}:${builder._name}:field:bitrate`;
    const { ActionRowBuilder } = await import("discord.js");
    const bitrateInput = builder.textInput(bitrateId, "Bitrate in kbps (8-128)", 1, true);
    const row = new ActionRowBuilder().addComponents(bitrateInput);
    modal.addComponents(row);
    await interaction.showModal(modal);
  }

  async function handleTogglePublicPrivate(interaction, tempVc) {
    const channel = await client.channels.fetch(tempVc.channelId);
    if (!channel) {
      await interaction.editReply({ embeds: [embed.error({ description: "Could not find your temporary channel." })], components: [] });
      return;
    }

    const isPublic = !tempVc.isPublic;
    await channel.permissionOverwrites.edit(channel.guild.id, {
      Connect: isPublic ? PermissionsBitField.Flags.Connect : PermissionsBitField.Flags.ViewChannel,
    });
    await updateTempVc(ctx, tempVc.channelId, { isPublic });
    await interaction.editReply({ embeds: [embed.success({ description: `Channel is now ${isPublic ? 'Public' : 'Private'}.` })], components: [] });
  }

  async function handleKickBanUser(interaction, tempVc) {
    const channel = await client.channels.fetch(tempVc.channelId);
    if (!channel) {
      await interaction.editReply({ embeds: [embed.error({ description: "Could not find your temporary channel." })], components: [] });
      return;
    }

    const membersInVc = channel.members.filter(m => m.id !== interaction.member.id).map(m => ({ label: m.user.tag, value: m.id }));
    if (membersInVc.length === 0) {
      await interaction.editReply({ embeds: [embed.warn({ description: "No other users to kick/ban in your channel." })], components: [] });
      return;
    }

    const { message, dispose } = ctx.v2.ui.createMultiSelectMenu(ctx, builder, MODULE_NAME, membersInVc, async (i, values) => {
      const [userId] = values;
                  const targetMember = await interaction.guild.members.fetch(userId);
      if (!targetMember) {
        await i.editReply({ embeds: [embed.error({ description: "User not found." })], components: [] });
        return;
      }

      const kickBanOptions = [
        { label: `Kick ${targetMember.user.tag}`, value: `kick_${userId}` },
        { label: `Ban ${targetMember.user.tag}`, value: `ban_${userId}` },
      ];

      const { message: kickBanMessage, dispose: kickBanDispose } = ctx.v2.ui.createMultiSelectMenu(ctx, builder, MODULE_NAME, kickBanOptions, async (subI, subValues) => {
        const [action] = subValues;
        if (action.startsWith("kick")) {
          await targetMember.voice.disconnect("Kicked from temporary voice channel").catch(e => logger.error(`Failed to kick user: ${e.message}`));
          await i.editReply({ embeds: [embed.success({ description: `Kicked ${targetMember.user.tag} from the channel.` })], components: [] });
        } else if (action.startsWith("ban")) {
          await channel.permissionOverwrites.edit(targetMember.id, { Connect: false });
          await targetMember.voice.disconnect("Banned from temporary voice channel").catch(e => logger.error(`Failed to ban user: ${e.message}`));
          await i.editReply({ embeds: [embed.success({ description: `Banned ${targetMember.user.tag} from the channel.` })], components: [] });
        }
        kickBanDispose();
        await sendUserPanel(interaction.member, tempVc.channelId, tempVc.ownerId);
      }, { maxValues: 1, placeholder: "Select action" });

      await i.editReply(kickBanMessage);
      ctx.lifecycle.addDisposable(kickBanDispose);

    }, { maxValues: 1, placeholder: "Select a user to kick/ban" });

    await interaction.editReply(message);
    ctx.lifecycle.addDisposable(dispose);
  }

  async function handleTransferOwnership(interaction, tempVc) {
    const channel = await client.channels.fetch(tempVc.channelId);
    if (!channel) {
      await interaction.editReply({ embeds: [embed.error({ description: "Could not find your temporary channel." })], components: [] });
      return;
    }

    const membersInVc = channel.members.filter(m => m.id !== interaction.member.id).map(m => ({ label: m.user.tag, value: m.id }));
    if (membersInVc.length === 0) {
      await interaction.editReply({ embeds: [embed.warn({ description: "No other users in your channel to transfer ownership to." })], components: [] });
      return;
    }

    const { message, dispose } = ctx.v2.ui.createMultiSelectMenu(ctx, builder, MODULE_NAME, membersInVc, async (i, values) => {
      const [newOwnerId] = values;
      await updateTempVc(ctx, tempVc.channelId, { ownerId: newOwnerId });
      await channel.permissionOverwrites.edit(interaction.member.id, { Connect: false, ManageChannels: false, MuteMembers: false, DeafenMembers: false, MoveMembers: false });
      await channel.permissionOverwrites.edit(newOwnerId, { Connect: true, ManageChannels: true, MuteMembers: true, DeafenMembers: true, MoveMembers: true });
      await i.editReply({ embeds: [embed.success({ description: `Ownership transferred to <@${newOwnerId}>.` })], components: [] });
      dispose();
      await sendUserPanel(interaction.member, tempVc.channelId, tempVc.ownerId); // Update current owner's panel
      const newOwnerMember = await interaction.guild.members.fetch(newOwnerId);
      if (newOwnerMember) {
        await sendUserPanel(newOwnerMember, tempVc.channelId, newOwnerId); // Send new panel to new owner
      }
    }, { maxValues: 1, placeholder: "Select a user to transfer ownership to" });

    await interaction.editReply(message);
    ctx.lifecycle.addDisposable(dispose);
  }

  async function handleRenameChannel(interaction, tempVc) {
    // Build a modal whose customId matches the onModal local name: "rename_channel_modal"
    const modal = builder.modal(ctx, MODULE_NAME, "rename_channel_modal", "Rename Channel");
    const nameId = `${MODULE_NAME}:${builder._name}:field:new_name`;
    const { ActionRowBuilder } = await import("discord.js");
    const nameInput = builder.textInput(nameId, "New Channel Name", 1, true);
    const row = new ActionRowBuilder().addComponents(nameInput);
    modal.addComponents(row);
    await interaction.showModal(modal);
  }

  async function handleDeleteChannel(interaction, tempVc) {
    const channel = await client.channels.fetch(tempVc.channelId);
    if (!channel) {
      await interaction.editReply({ embeds: [embed.error({ description: "Could not find your temporary channel." })], components: [] });
      return;
    }

    const { message, dispose } = ctx.v2.ui.createConfirmationDialog(ctx, builder, MODULE_NAME, "Are you sure you want to delete your temporary channel?", async (i) => {
      try {
        await channel.delete();
        await deleteTempVc(ctx, tempVc.channelId);
        await i.editReply({ embeds: [embed.success({ description: "Your temporary channel has been deleted." })], components: [] });
        // Remove user panel message
        for (const [msgId, vcId] of userPanelMessages.entries()) {
          if (vcId === tempVc.channelId) {
            const msg = await interaction.member.user.dmChannel?.messages.fetch(msgId).catch(() => null);
            if (msg) await msg.delete().catch(() => {});
            userPanelMessages.delete(msgId);
            break;
          }
        }
      } catch (error) {
        logger.error(`Failed to delete temp VC: ${error.message}`);
        await i.editReply({ embeds: [embed.error({ description: `Failed to delete your temporary channel: ${error.message}` })], components: [] });
      }
      dispose();
    }, async (i) => {
      await i.editReply({ embeds: [embed.info({ description: "Channel deletion cancelled." })], components: [] });
      dispose();
    }, { ephemeral: true });

    await interaction.editReply(message);
    ctx.lifecycle.addDisposable(dispose);
  }

  // Register the builder with the core system
  ctx.v2.register(builder);

  return disposeListener;
}

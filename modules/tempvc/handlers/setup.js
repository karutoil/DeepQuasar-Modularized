import { createInteractionCommand } from "../../../core/builders.js";
import { createPaginatedEmbed, createForm, parseModal, createMultiSelectMenu } from "../../../core/ui.js";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { getGuildSettings, updateGuildSettings } from "../services/settingsService.js";

const COMMAND_NAME = "tempvc";

export function registerSetupCommand(ctx, moduleName) {
  const { dsl, embed, logger } = ctx;

  const builder = createInteractionCommand()
    .setName(COMMAND_NAME)
    .setDescription("Manage temporary voice channel settings.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addOption((opt) =>
      opt
        .addSubcommand((sub) =>
          sub.setName("setup").setDescription("Configure TempVC module settings.")
        )
    )
    .onExecute(dsl.withDeferredReply(dsl.withTryCatch(async (interaction) => {
      if (interaction.options.getSubcommand() === "setup") {
        await showSetupMenu(interaction);
      }
    })))
    // Important: Only defer when NOT opening a modal; otherwise call showModal directly.
    .onSelect("setup_menu", dsl.withTryCatch(async (interaction) => {
      const [selectedOption] = interaction.values;
      const guildId = interaction.guild.id;

      // Options that open a modal must NOT be deferred; call handlers directly.
      const opensModal = ["name_template", "default_limit", "default_bitrate", "inactivity_timeout"].includes(selectedOption);

      if (!opensModal) {
        // Defer for non-modal branches so editReply works.
        try { if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ ephemeral: true }); } catch {}
      }

      switch (selectedOption) {
        case "creation_channels":
          await handleCreationChannels(interaction, guildId);
          break;
        case "category":
          await handleCategory(interaction, guildId);
          break;
        case "name_template":
          await handleNameTemplate(interaction, guildId); // showModal
          break;
        case "default_limit":
          await handleDefaultLimit(interaction, guildId); // showModal
          break;
        case "default_bitrate":
          await handleDefaultBitrate(interaction, guildId); // showModal
          break;
        case "permissions":
          await handlePermissions(interaction, guildId);
          break;
        case "inactivity_timeout":
          await handleInactivityTimeout(interaction, guildId); // showModal
          break;
        case "user_mod_enabled":
          await handleUserModEnabled(interaction, guildId);
          break;
        case "kick_ban_enabled":
          await handleKickBanEnabled(interaction, guildId);
          break;
        case "transfer_ownership_enabled":
          await handleTransferOwnershipEnabled(interaction, guildId);
          break;
        case "public_private_enabled":
          await handlePublicPrivateEnabled(interaction, guildId);
          break;
        default:
          try { await interaction.editReply?.({ content: "Unknown option selected.", ephemeral: true }); } catch {}
          break;
      }
    }))
    .onModal("set_name_template", dsl.withDeferredReply(dsl.withTryCatch(async (interaction) => {
      const { template } = parseModal(interaction);
      const guildId = interaction.guild.id;
      await updateGuildSettings(ctx, guildId, { nameTemplate: template });
      await interaction.editReply({ embeds: [embed.success({ description: `Name template set to 
${template}
.` })], components: [] });
      await showSetupMenu(interaction);
    })))
    .onModal("set_default_limit", dsl.withDeferredReply(dsl.withTryCatch(async (interaction) => {
      const { limit } = parseModal(interaction);
      const guildId = interaction.guild.id;
      const parsedLimit = parseInt(limit, 10);
      if (isNaN(parsedLimit) || parsedLimit < 0 || parsedLimit > 99) {
        await interaction.editReply({ embeds: [embed.error({ description: "Invalid limit. Must be a number between 0 and 99." })], components: [] });
      } else {
        await updateGuildSettings(ctx, guildId, { defaultLimit: parsedLimit });
        await interaction.editReply({ embeds: [embed.success({ description: `Default user limit set to 
${parsedLimit}
.` })], components: [] });
      }
      await showSetupMenu(interaction);
    })))
    .onModal("set_default_bitrate", dsl.withDeferredReply(dsl.withTryCatch(async (interaction) => {
      const { bitrate } = parseModal(interaction);
      const guildId = interaction.guild.id;
      const parsedBitrate = parseInt(bitrate, 10);
      if (isNaN(parsedBitrate) || parsedBitrate < 8 || parsedBitrate > 128) {
        await interaction.editReply({ embeds: [embed.error({ description: "Invalid bitrate. Must be a number between 8 and 128 (in kbps)." })], components: [] });
      } else {
        await updateGuildSettings(ctx, guildId, { defaultBitrate: parsedBitrate * 1000 }); // Convert to bps
        await interaction.editReply({ embeds: [embed.success({ description: `Default bitrate set to 
${parsedBitrate} kbps
.` })], components: [] });
      }
      await showSetupMenu(interaction);
    })))
    .onModal("set_inactivity_timeout", dsl.withDeferredReply(dsl.withTryCatch(async (interaction) => {
      const { timeout } = parseModal(interaction);
      const guildId = interaction.guild.id;
      const parsedTimeout = parseInt(timeout, 10);
      if (isNaN(parsedTimeout) || parsedTimeout < 1) {
        await interaction.editReply({ embeds: [embed.error({ description: "Invalid timeout. Must be a number greater than 0 (in minutes)." })], components: [] });
      } else {
        await updateGuildSettings(ctx, guildId, { inactivityTimeout: parsedTimeout * 60 * 1000 }); // Convert to ms
        await interaction.editReply({ embeds: [embed.success({ description: `Inactivity timeout set to 
${parsedTimeout} minutes
.` })], components: [] });
      }
      await showSetupMenu(interaction);
    })))
    .onSelect("set_creation_channels", dsl.withDeferredReply(dsl.withTryCatch(async (interaction) => {
      const guildId = interaction.guild.id;
      await updateGuildSettings(ctx, guildId, { creationChannels: interaction.values });
      await interaction.editReply({ embeds: [embed.success({ description: "Creation channels updated." })], components: [] });
      await showSetupMenu(interaction);
    })))
    .onSelect("set_category", dsl.withDeferredReply(dsl.withTryCatch(async (interaction) => {
      const guildId = interaction.guild.id;
      const [categoryId] = interaction.values;
      await updateGuildSettings(ctx, guildId, { categoryId: categoryId === "none" ? null : categoryId });
      await interaction.editReply({ embeds: [embed.success({ description: `Category set to ${categoryId === "none" ? "None" : `<#${categoryId}>`}.` })], components: [] });
      await showSetupMenu(interaction);
    })))
    .onSelect("set_permissions", dsl.withDeferredReply(dsl.withTryCatch(async (interaction) => {
      const guildId = interaction.guild.id;
      const values = interaction.values || [];
      await updateGuildSettings(ctx, guildId, { defaultPermissions: values.map(v => parseInt(v, 10)).filter(n => !Number.isNaN(n)) });
      await interaction.editReply({ embeds: [embed.success({ description: "Default permissions updated." })], components: [] });
      await showSetupMenu(interaction);
    })))
    .onSelect("set_user_mod_enabled", dsl.withDeferredReply(dsl.withTryCatch(async (interaction) => {
      const guildId = interaction.guild.id;
      const [value] = interaction.values;
      await updateGuildSettings(ctx, guildId, { userModEnabled: value === "true" });
      await interaction.editReply({ embeds: [embed.success({ description: `User modification enabled: ${value}.` })], components: [] });
      await showSetupMenu(interaction);
    })))
    .onSelect("set_kick_ban_enabled", dsl.withDeferredReply(dsl.withTryCatch(async (interaction) => {
      const guildId = interaction.guild.id;
      const [value] = interaction.values;
      await updateGuildSettings(ctx, guildId, { kickBanEnabled: value === "true" });
      await interaction.editReply({ embeds: [embed.success({ description: `Kick/Ban enabled: ${value}.` })], components: [] });
      await showSetupMenu(interaction);
    })))
    .onSelect("set_transfer_ownership_enabled", dsl.withDeferredReply(dsl.withTryCatch(async (interaction) => {
      const guildId = interaction.guild.id;
      const [value] = interaction.values;
      await updateGuildSettings(ctx, guildId, { transferOwnershipEnabled: value === "true" });
      await interaction.editReply({ embeds: [embed.success({ description: `Transfer ownership enabled: ${value}.` })], components: [] });
      await showSetupMenu(interaction);
    })))
    .onSelect("set_public_private_enabled", dsl.withDeferredReply(dsl.withTryCatch(async (interaction) => {
      const guildId = interaction.guild.id;
      const [value] = interaction.values;
      await updateGuildSettings(ctx, guildId, { publicPrivateEnabled: value === "true" });
      await interaction.editReply({ embeds: [embed.success({ description: `Public/Private toggle enabled: ${value}.` })], components: [] });
      await showSetupMenu(interaction);
    })));

  async function showSetupMenu(interaction) {
    const guildId = interaction.guild.id;
    const settings = await getGuildSettings(ctx, guildId);

    const pages = [
      embed.info({
        title: "TempVC Setup - General Settings",
        description: "Configure the core behavior of temporary voice channels.",
        fields: [
          { name: "Creation Channels", value: settings.creationChannels?.map(id => `<#${id}>`).join(", ") || "None", inline: true },
          { name: "Category", value: settings.categoryId ? `<#${settings.categoryId}>` : "None", inline: true },
          { name: "Name Template", value: settings.nameTemplate || "{username}'s VC", inline: true },
          { name: "Default User Limit", value: settings.defaultLimit?.toString() || "Unlimited", inline: true },
          { name: "Default Bitrate", value: settings.defaultBitrate ? `${settings.defaultBitrate / 1000} kbps` : "Default", inline: true },
          { name: "Inactivity Timeout", value: settings.inactivityTimeout ? `${settings.inactivityTimeout / (60 * 1000)} minutes` : "None", inline: true },
        ],
      }),
      embed.info({
        title: "TempVC Setup - User Permissions & Features",
        description: "Control what users can do with their temporary voice channels.",
        fields: [
          { name: "Default Channel Permissions", value: settings.defaultPermissions?.length ? settings.defaultPermissions.map(p => `
${p}
`).join(", ") : "None", inline: false },
          { name: "Allow User Channel Modification", value: settings.userModEnabled ? "Yes" : "No", inline: true },
          { name: "Allow Kick/Ban", value: settings.kickBanEnabled ? "Yes" : "No", inline: true },
          { name: "Allow Ownership Transfer", value: settings.transferOwnershipEnabled ? "Yes" : "No", inline: true },
          { name: "Allow Public/Private Toggle", value: settings.publicPrivateEnabled ? "Yes" : "No", inline: true },
        ],
      }),
    ];

    const selectOptions = [
      { label: "Set Creation Channels", value: "creation_channels" },
      { label: "Set Category", value: "category" },
      { label: "Set Name Template", value: "name_template" },
      { label: "Set Default User Limit", value: "default_limit" },
      { label: "Set Default Bitrate", value: "default_bitrate" },
      { label: "Set Default Channel Permissions", value: "permissions" },
      { label: "Set Inactivity Timeout", value: "inactivity_timeout" },
      { label: "Toggle User Channel Modification", value: "user_mod_enabled" },
      { label: "Toggle Kick/Ban", value: "kick_ban_enabled" },
      { label: "Toggle Ownership Transfer", value: "transfer_ownership_enabled" },
      { label: "Toggle Public/Private Toggle", value: "public_private_enabled" },
    ];

    const { message, dispose } = createPaginatedEmbed(ctx, builder, moduleName, pages, { ephemeral: true });
    const selectMenu = builder.select(ctx, moduleName, "setup_menu", "Select a setting to configure", selectOptions);
    message.components.push({ type: 1, components: [selectMenu] });

    await interaction.editReply(message);
    ctx.lifecycle.addDisposable(dispose);
  }

  async function handleCreationChannels(interaction, guildId) {
    const channels = interaction.guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice).map(c => ({ label: c.name, value: c.id }));
    const { message, dispose } = createMultiSelectMenu(ctx, builder, moduleName, channels, async (i, values) => {
      await updateGuildSettings(ctx, guildId, { creationChannels: values });
      await i.update({ embeds: [embed.success({ description: `Creation channels updated.
` })], components: [] });
      await showSetupMenu(i);
    }, { placeholder: "Select channels", maxValues: channels.length });
    await interaction.editReply(message);
    ctx.lifecycle.addDisposable(dispose);
  }

  async function handleCategory(interaction, guildId) {
    const categories = interaction.guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).map(c => ({ label: c.name, value: c.id }));
    categories.unshift({ label: "None (create in root)", value: "none" });
    const { message, dispose } = createMultiSelectMenu(ctx, builder, moduleName, categories, async (i, values) => {
      const [categoryId] = values;
      await updateGuildSettings(ctx, guildId, { categoryId: categoryId === "none" ? null : categoryId });
      await i.update({ embeds: [embed.success({ description: `Category set to ${categoryId === "none" ? "None" : `<#${categoryId}>
`}.` })], components: [] });
      await showSetupMenu(i);
    }, { maxValues: 1, placeholder: "Select a category" });
    await interaction.editReply(message);
    ctx.lifecycle.addDisposable(dispose);
  }

  async function handleNameTemplate(interaction, guildId) {
    const form = createForm(ctx, builder, moduleName, {
      title: "Set Name Template",
      fields: [
        { name: "template", label: "Channel Name Template", style: "short", required: true }
      ]
    });
    await form.open(interaction);
  }

  async function handleDefaultLimit(interaction, guildId) {
    const form = createForm(ctx, builder, moduleName, {
      title: "Set Default User Limit",
      fields: [
        { name: "limit", label: "User Limit (0-99, 0 for unlimited)", style: "short", required: true }
      ]
    });
    await form.open(interaction);
  }

  async function handleDefaultBitrate(interaction, guildId) {
    const form = createForm(ctx, builder, moduleName, {
      title: "Set Default Bitrate",
      fields: [
        { name: "bitrate", label: "Bitrate in kbps (8-128)", style: "short", required: true }
      ]
    });
    await form.open(interaction);
  }

  async function handlePermissions(interaction, guildId) {
    const allPermissions = Object.keys(PermissionFlagsBits).filter(key => typeof PermissionFlagsBits[key] === 'number');
    const permissionOptions = allPermissions.map(p => ({ label: p, value: PermissionFlagsBits[p].toString() }));

    const { message, dispose } = createMultiSelectMenu(ctx, builder, moduleName, permissionOptions, async (i, values) => {
      await updateGuildSettings(ctx, guildId, { defaultPermissions: values.map(v => parseInt(v, 10)) });
      await i.update({ embeds: [embed.success({ description: `Default permissions updated.
` })], components: [] });
      await showSetupMenu(i);
    }, { placeholder: "Select default permissions", maxValues: permissionOptions.length });
    await interaction.editReply(message);
    ctx.lifecycle.addDisposable(dispose);
  }

  async function handleInactivityTimeout(interaction, guildId) {
    const form = createForm(ctx, builder, moduleName, {
      title: "Set Inactivity Timeout",
      fields: [
        { name: "timeout", label: "Timeout in minutes (0 for none)", style: "short", required: true }
      ]
    });
    await form.open(interaction);
  }

  async function handleUserModEnabled(interaction, guildId) {
    const { message, dispose } = createMultiSelectMenu(ctx, builder, moduleName, [
      { label: "Enable", value: "true" },
      { label: "Disable", value: "false" }
    ], async (i, values) => {
      const [value] = values;
      await updateGuildSettings(ctx, guildId, { userModEnabled: value === "true" });
      await i.update({ embeds: [embed.success({ description: `User modification enabled: 
${value}
.` })], components: [] });
      await showSetupMenu(i);
    }, { maxValues: 1, placeholder: "Enable/Disable" });
    await interaction.editReply(message);
    ctx.lifecycle.addDisposable(dispose);
  }

  async function handleKickBanEnabled(interaction, guildId) {
    const { message, dispose } = createMultiSelectMenu(ctx, builder, moduleName, [
      { label: "Enable", value: "true" },
      { label: "Disable", value: "false" }
    ], async (i, values) => {
      const [value] = values;
      await updateGuildSettings(ctx, guildId, { kickBanEnabled: value === "true" });
      await i.update({ embeds: [embed.success({ description: `Kick/Ban enabled: 
${value}
.` })], components: [] });
      await showSetupMenu(i);
    }, { maxValues: 1, placeholder: "Enable/Disable" });
    await interaction.editReply(message);
    ctx.lifecycle.addDisposable(dispose);
  }

  async function handleTransferOwnershipEnabled(interaction, guildId) {
    const { message, dispose } = createMultiSelectMenu(ctx, builder, moduleName, [
      { label: "Enable", value: "true" },
      { label: "Disable", value: "false" }
    ], async (i, values) => {
      const [value] = values;
      await updateGuildSettings(ctx, guildId, { transferOwnershipEnabled: value === "true" });
      await i.update({ embeds: [embed.success({ description: `Transfer ownership enabled: 
${value}
.` })], components: [] });
      await showSetupMenu(i);
    }, { maxValues: 1, placeholder: "Enable/Disable" });
    await interaction.editReply(message);
    ctx.lifecycle.addDisposable(dispose);
  }

  async function handlePublicPrivateEnabled(interaction, guildId) {
    const { message, dispose } = createMultiSelectMenu(ctx, builder, moduleName, [
      { label: "Enable", value: "true" },
      { label: "Disable", value: "false" }
    ], async (i, values) => {
      const [value] = values;
      await updateGuildSettings(ctx, guildId, { publicPrivateEnabled: value === "true" });
      await i.update({ embeds: [embed.success({ description: `Public/Private toggle enabled: 
${value}
.` })], components: [] });
      await showSetupMenu(i);
    }, { maxValues: 1, placeholder: "Enable/Disable" });
    await interaction.editReply(message);
    ctx.lifecycle.addDisposable(dispose);
  }

  return builder;
}

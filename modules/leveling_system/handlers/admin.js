import { PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } from 'discord.js';
import { getGuildSettings, upsertGuildSettings, addXpToUser, removeXpFromUser, setUserLevel, resetUser, exportGuildData } from '../services/levelService.js';

const moduleName = 'leveling_system';

function buildMainEmbed(settings, ctx) {
  return new EmbedBuilder()
    .setTitle('Leveling Admin')
    .setDescription('Navigate settings: use the buttons to switch pages. All actions require Manage Guild permission.')
    .addFields(
      { name: 'Enabled', value: settings.enabled === false ? 'Off' : 'On', inline: true },
      { name: 'XP per message', value: String(settings.xpPerMessage ?? ctx.config.get('LEVELING_XP_PER_MESSAGE') ?? 0), inline: true },
      { name: 'Message cooldown (s)', value: String(settings.messageCooldown ?? ctx.config.get('LEVELING_MESSAGE_COOLDOWN') ?? 60), inline: true }
    )
    .setColor(0x5865f2);
}

function buildNavRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('lvl_page_main').setLabel('Home').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('lvl_page_xp').setLabel('XP Settings').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('lvl_page_roles').setLabel('Level Roles').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('lvl_page_manage').setLabel('Manage User').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('lvl_export').setLabel('Export').setStyle(ButtonStyle.Secondary)
  );
}

export default function createHandler(ctx) {
  return async function handler(interaction) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }
    if (!interaction.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) {
      await interaction.reply({ content: 'You need Manage Guild permission to use this.', ephemeral: true });
      return;
    }

    const guildId = interaction.guildId;
    const settings = await getGuildSettings(ctx, guildId) || {};

    const embed = buildMainEmbed(settings, ctx);
    const nav = buildNavRow();

  // Make the admin message non-ephemeral so we can update it in-place after modal submits
  await interaction.reply({ embeds: [embed], components: [nav] });

  // Register interactions once per process
    try {
      if (!ctx._leveling_admin_registered) {
  const { interactions, lifecycle } = ctx;
    // Session store for intermediate selections keyed by `${action}:${adminId}`
    if (!ctx._leveling_admin_sessions) ctx._leveling_admin_sessions = new Map();

        // Page navigation handler
        const offNav = interactions.registerButton(moduleName, 'lvl_page_main', async (btn) => {
          if (!btn.inCachedGuild()) return;
          if (!btn.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return btn.reply({ content: 'Missing permission.', ephemeral: true });
          const s = await getGuildSettings(ctx, btn.guildId) || {};
          await btn.update({ embeds: [buildMainEmbed(s, ctx)], components: [buildNavRow()] });
        });
        lifecycle.addDisposable(offNav);

        const offXpPage = interactions.registerButton(moduleName, 'lvl_page_xp', async (btn) => {
          if (!btn.inCachedGuild()) return;
          if (!btn.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return btn.reply({ content: 'Missing permission.', ephemeral: true });
          const s = await getGuildSettings(ctx, btn.guildId) || {};
          const embed = new EmbedBuilder()
            .setTitle('XP Settings')
            .addFields(
              { name: 'XP per Message', value: String(s.xpPerMessage ?? ctx.config.get('LEVELING_XP_PER_MESSAGE') ?? 0), inline: true },
              { name: 'Message Cooldown (s)', value: String(s.messageCooldown ?? ctx.config.get('LEVELING_MESSAGE_COOLDOWN') ?? 60), inline: true },
              { name: 'Voice XP', value: String(s.voiceXpPerInterval ?? ctx.config.get('LEVELING_VOICE_XP') ?? 0), inline: true },
              { name: 'Voice Interval (s)', value: String(s.voiceIntervalSeconds ?? ctx.config.get('LEVELING_VOICE_INTERVAL') ?? 60), inline: true },
              { name: 'Prestige Enabled', value: s.prestigeEnabled ? 'Yes' : 'No', inline: true },
              { name: 'Prestige Cap', value: String(s.prestigeCap ?? ctx.config.get('LEVELING_PRESTIGE_CAP') ?? 100), inline: true }
            )
            .setColor(0x2b2d31);

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('lvl_edit_xp').setLabel('Edit XP/Timers').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('lvl_toggle_prestige').setLabel(s.prestigeEnabled ? 'Disable Prestige' : 'Enable Prestige').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('lvl_set_prestige_cap').setLabel('Set Prestige Cap').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('lvl_back').setLabel('Back').setStyle(ButtonStyle.Secondary)
          );
          await btn.update({ embeds: [embed], components: [buildNavRow(), row] });
        });
        lifecycle.addDisposable(offXpPage);

        // Toggle prestige
        const offTogglePrestige = interactions.registerButton(moduleName, 'lvl_toggle_prestige', async (btn) => {
          if (!btn.inCachedGuild()) return;
          if (!btn.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return btn.reply({ content: 'Missing permission.', ephemeral: true });
          const s = await getGuildSettings(ctx, btn.guildId) || {};
          s.prestigeEnabled = !s.prestigeEnabled;
          await upsertGuildSettings(ctx, btn.guildId, s);
          const updated = await getGuildSettings(ctx, btn.guildId) || {};
          const embed = new EmbedBuilder().setTitle('XP Settings Updated').addFields(
            { name: 'Prestige Enabled', value: updated.prestigeEnabled ? 'Yes' : 'No', inline: true },
            { name: 'Prestige Cap', value: String(updated.prestigeCap ?? ctx.config.get('LEVELING_PRESTIGE_CAP') ?? 100), inline: true }
          ).setColor(0x2b2d31);
          try { await btn.update({ embeds: [embed], components: [buildNavRow()] }); } catch (e) { try { await btn.reply({ content: 'Failed to update.', ephemeral: true }); } catch { void e; } }
        });
        lifecycle.addDisposable(offTogglePrestige);

        // Set prestige cap (open modal)
        const offSetPrestigeCap = interactions.registerButton(moduleName, 'lvl_set_prestige_cap', async (btn) => {
          if (!btn.inCachedGuild()) return;
          if (!btn.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return btn.reply({ content: 'Missing permission.', ephemeral: true });
          // store admin message id so modal can edit it
          try { ctx._leveling_admin_sessions.set(`set_prestige_msg:${btn.user.id}`, { messageId: btn.message?.id }); } catch (e) { void e; }
          const modal = new ModalBuilder().setCustomId('lvl_modal_set_prestige_cap').setTitle('Set Prestige Cap');
          const capInput = new TextInputBuilder().setCustomId('prestige_cap').setLabel('Prestige Cap (integer)').setStyle(TextInputStyle.Short).setRequired(true);
          modal.addComponents({ type: 1, components: [capInput] });
          try { await btn.showModal(modal); } catch (e) { try { await btn.reply({ content: 'Failed to open modal.', ephemeral: true }); } catch { void e; } }
        });
        lifecycle.addDisposable(offSetPrestigeCap);

        const offPrestigeCapModal = interactions.registerModal(moduleName, 'lvl_modal_set_prestige_cap', async (modal) => {
          if (!modal.inCachedGuild()) return;
          if (!modal.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return modal.reply({ content: 'Missing permission.', ephemeral: true });
          try {
            const guildId = modal.guildId;
            const cap = Number(modal.fields.getTextInputValue('prestige_cap'));
            if (!Number.isFinite(cap) || cap <= 0) return modal.reply({ content: 'Invalid cap value.', ephemeral: true });
            const s = await getGuildSettings(ctx, guildId) || {};
            s.prestigeCap = Math.floor(cap);
            await upsertGuildSettings(ctx, guildId, s);
            const session = ctx._leveling_admin_sessions.get(`set_prestige_msg:${modal.user.id}`) || {};
            const adminMsgId = session.messageId;
            // edit original admin message to reflect new cap
            const updated = await getGuildSettings(ctx, guildId) || {};
            const embed = new EmbedBuilder().setTitle('Prestige Cap Updated').addFields(
              { name: 'Prestige Enabled', value: updated.prestigeEnabled ? 'Yes' : 'No', inline: true },
              { name: 'Prestige Cap', value: String(updated.prestigeCap ?? ctx.config.get('LEVELING_PRESTIGE_CAP') ?? 100), inline: true }
            ).setColor(0x2b2d31);
            try {
              await modal.deferReply({ ephemeral: true });
              if (adminMsgId && modal.channel) {
                const msg = await modal.channel.messages.fetch(adminMsgId).catch(() => null);
                if (msg) await msg.edit({ embeds: [embed], components: [buildNavRow()] }).catch(() => null);
              }
              await modal.editReply({ content: 'Updated.', ephemeral: true });
            } catch (e) { ctx.logger?.warn?.('[Leveling] set prestige cap edit failed', { error: e?.message }); try { await modal.reply({ content: 'Failed to update admin message.', ephemeral: true }); } catch { void e; } }
          } catch (e) { ctx.logger?.warn?.('[Leveling] set prestige cap failed', { error: e?.message }); try { await modal.reply({ content: 'Failed.', ephemeral: true }); } catch { void e; } }
        });
        lifecycle.addDisposable(offPrestigeCapModal);

        // Edit XP modal
        const offEditXp = interactions.registerButton(moduleName, 'lvl_edit_xp', async (btn) => {
          if (!btn.inCachedGuild()) return;
          if (!btn.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return btn.reply({ content: 'Missing permission.', ephemeral: true });
          const s = await getGuildSettings(ctx, btn.guildId) || {};
          // store the admin message id so modal handler can edit the original message later
          try { ctx._leveling_admin_sessions.set(`edit_xp_msg:${btn.user.id}`, { messageId: btn.message?.id }); } catch (e) { void e; }
          const modal = new ModalBuilder().setCustomId('lvl_modal_edit_xp').setTitle('Edit XP Settings');
          const xpInput = new TextInputBuilder().setCustomId('xp_per_message').setLabel('XP per Message').setStyle(TextInputStyle.Short).setPlaceholder(String(s.xpPerMessage ?? ctx.config.get('LEVELING_XP_PER_MESSAGE') ?? 0)).setRequired(true);
          const cdInput = new TextInputBuilder().setCustomId('message_cooldown').setLabel('Message Cooldown (s)').setStyle(TextInputStyle.Short).setPlaceholder(String(s.messageCooldown ?? ctx.config.get('LEVELING_MESSAGE_COOLDOWN') ?? 60)).setRequired(true);
          const vXp = new TextInputBuilder().setCustomId('voice_xp').setLabel('Voice XP per Interval').setStyle(TextInputStyle.Short).setPlaceholder(String(s.voiceXpPerInterval ?? ctx.config.get('LEVELING_VOICE_XP') ?? 0)).setRequired(true);
          const vInt = new TextInputBuilder().setCustomId('voice_interval').setLabel('Voice Interval (s)').setStyle(TextInputStyle.Short).setPlaceholder(String(s.voiceIntervalSeconds ?? ctx.config.get('LEVELING_VOICE_INTERVAL') ?? 60)).setRequired(true);
          modal.addComponents(
            { type: 1, components: [xpInput] },
            { type: 1, components: [cdInput] },
            { type: 1, components: [vXp] },
            { type: 1, components: [vInt] }
          );
          try { await btn.showModal(modal); } catch (e) { try { await btn.reply({ content: 'Failed to open modal.', ephemeral: true }); } catch { void e; } }
        });
        lifecycle.addDisposable(offEditXp);

        const offModalSave = interactions.registerModal(moduleName, 'lvl_modal_edit_xp', async (modal) => {
          if (!modal.inCachedGuild()) return;
          if (!modal.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return modal.reply({ content: 'Missing permission.', ephemeral: true });
          try {
            const guildId = modal.guildId;
            const xp = Number(modal.fields.getTextInputValue('xp_per_message'));
            const cd = Number(modal.fields.getTextInputValue('message_cooldown'));
            const vxp = Number(modal.fields.getTextInputValue('voice_xp'));
            const vint = Number(modal.fields.getTextInputValue('voice_interval'));
            if (!Number.isFinite(xp) || xp < 0) return modal.reply({ content: 'Invalid XP value.', ephemeral: true });
            if (!Number.isFinite(cd) || cd < 0) return modal.reply({ content: 'Invalid cooldown.', ephemeral: true });
            const s = await getGuildSettings(ctx, guildId) || {};
            s.xpPerMessage = Math.floor(xp);
            s.messageCooldown = Math.floor(cd);
            s.voiceXpPerInterval = Math.floor(vxp);
            s.voiceIntervalSeconds = Math.floor(vint);
            await upsertGuildSettings(ctx, guildId, s);
            // Visual confirmation: show updated XP settings
            const xpSavedEmbed = new EmbedBuilder()
              .setTitle('XP Settings Saved')
              .addFields(
                { name: 'XP per Message', value: String(s.xpPerMessage ?? ctx.config.get('LEVELING_XP_PER_MESSAGE') ?? 0), inline: true },
                { name: 'Message Cooldown (s)', value: String(s.messageCooldown ?? ctx.config.get('LEVELING_MESSAGE_COOLDOWN') ?? 60), inline: true },
                { name: 'Voice XP', value: String(s.voiceXpPerInterval ?? ctx.config.get('LEVELING_VOICE_XP') ?? 0), inline: true },
                { name: 'Voice Interval (s)', value: String(s.voiceIntervalSeconds ?? ctx.config.get('LEVELING_VOICE_INTERVAL') ?? 60), inline: true }
              )
              .setColor(0x2b2d31);
            await modal.reply({ embeds: [xpSavedEmbed], components: [buildNavRow()], ephemeral: true });
          } catch (e) { ctx.logger?.warn?.('[Leveling] save xp modal failed', { error: e?.message }); try { await modal.reply({ content: 'Failed to save.', ephemeral: true }); } catch { void e; } }
        });
        lifecycle.addDisposable(offModalSave);

        // Roles page
        const offRoles = interactions.registerButton(moduleName, 'lvl_page_roles', async (btn) => {
          if (!btn.inCachedGuild()) return;
          if (!btn.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return btn.reply({ content: 'Missing permission.', ephemeral: true });
          const s = await getGuildSettings(ctx, btn.guildId) || {};
          const roles = s.levelRoles || {};
          const lines = Object.keys(roles).sort((a,b)=>Number(a)-Number(b)).map(l=>`${l}: <@&${roles[l]}>`).join('\n') || 'No level roles configured.';
          const embed = new EmbedBuilder().setTitle('Level Roles').setDescription(lines).setColor(0x2b2d31);
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('lvl_add_role').setLabel('Add Role').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('lvl_remove_role').setLabel('Remove Role').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('lvl_back').setLabel('Back').setStyle(ButtonStyle.Secondary)
          );
          await btn.update({ embeds: [embed], components: [buildNavRow(), row] });
        });
        lifecycle.addDisposable(offRoles);

        // Add role modal
        // Add Role: present a Role select, then prompt for level via modal
        const offAddRole = interactions.registerButton(moduleName, 'lvl_add_role', async (btn) => {
          if (!btn.inCachedGuild()) return;
          if (!btn.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return btn.reply({ content: 'Missing permission.', ephemeral: true });
          const menu = new RoleSelectMenuBuilder().setCustomId('lvl_select_add_role').setPlaceholder('Choose a role to assign').setMinValues(1).setMaxValues(1);
          const row = new ActionRowBuilder().addComponents(menu);
          await btn.update({ content: 'Select the role to assign for a level', embeds: [], components: [buildNavRow(), row] });
        });
        lifecycle.addDisposable(offAddRole);

        const offSelectAddRole = interactions.registerSelect(moduleName, 'lvl_select_add_role', async (sel) => {
          if (!sel.inCachedGuild()) return;
          if (!sel.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return sel.reply({ content: 'Missing permission.', ephemeral: true });
          const chosen = sel.values?.[0];
          if (!chosen) return sel.reply({ content: 'No role selected.', ephemeral: true });
          // Store selection keyed by admin user id
          // Store selection and the admin message id so modal can update the original message
          ctx._leveling_admin_sessions.set(`add_role:${sel.user.id}`, { roleId: chosen, messageId: sel.message?.id });
          // Ask for the level via modal
          const modal = new ModalBuilder().setCustomId('lvl_modal_add_role').setTitle('Add Level Role - Level Input');
          const levelInput = new TextInputBuilder().setCustomId('add_level').setLabel('Level (integer)').setStyle(TextInputStyle.Short).setRequired(true);
          modal.addComponents({ type:1, components: [levelInput] });
          try { await sel.showModal(modal); } catch (e) { try { await sel.reply({ content: 'Failed to open modal.', ephemeral: true }); } catch { void e; } }
        });
        lifecycle.addDisposable(offSelectAddRole);

        const offSaveAddRole = interactions.registerModal(moduleName, 'lvl_modal_add_role', async (modal) => {
          if (!modal.inCachedGuild()) return;
          if (!modal.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return modal.reply({ content: 'Missing permission.', ephemeral: true });
          try {
            const guildId = modal.guildId;
            const lvl = Number(modal.fields.getTextInputValue('add_level'));
            if (!Number.isFinite(lvl) || lvl < 0) return modal.reply({ content: 'Invalid level.', ephemeral: true });
            const session = ctx._leveling_admin_sessions.get(`add_role:${modal.user.id}`) || {};
            const roleId = session.roleId;
            const adminMsgId = session.messageId;
            if (!roleId) return modal.reply({ content: 'Role selection expired. Re-run Add Role.', ephemeral: true });
            const s = await getGuildSettings(ctx, guildId) || {};
            s.levelRoles = s.levelRoles || {};
            s.levelRoles[String(Math.floor(lvl))] = roleId;
            await upsertGuildSettings(ctx, guildId, s);
            ctx._leveling_admin_sessions.delete(`add_role:${modal.user.id}`);
            // Visual confirmation: edit the original admin message in-place
            const roles = s.levelRoles || {};
            const lines = Object.keys(roles).sort((a,b)=>Number(a)-Number(b)).map(l=>`${l}: <@&${roles[l]}>`).join('\n') || 'No level roles configured.';
            const rolesEmbed = new EmbedBuilder().setTitle('Level Roles Updated').setDescription(lines).setColor(0x2b2d31);
            try {
              await modal.deferReply({ ephemeral: true });
              if (adminMsgId && modal.channel) {
                const msg = await modal.channel.messages.fetch(adminMsgId).catch(() => null);
                if (msg) await msg.edit({ embeds: [rolesEmbed], components: [buildNavRow()] }).catch(() => null);
              }
              await modal.editReply({ content: 'Updated.', ephemeral: true });
            } catch (e) { ctx.logger?.warn?.('[Leveling] add role edit failed', { error: e?.message }); try { await modal.reply({ content: 'Failed to update admin message.', ephemeral: true }); } catch { void e; } }
          } catch (e) { ctx.logger?.warn?.('[Leveling] add role failed', { error: e?.message }); try { await modal.reply({ content: 'Failed to add role.', ephemeral: true }); } catch { void e; } }
        });
        lifecycle.addDisposable(offSaveAddRole);

        // Remove role modal
        const offRemoveRole = interactions.registerButton(moduleName, 'lvl_remove_role', async (btn) => {
          if (!btn.inCachedGuild()) return;
          if (!btn.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return btn.reply({ content: 'Missing permission.', ephemeral: true });
          const s = await getGuildSettings(ctx, btn.guildId) || {};
          const roles = s.levelRoles || {};
          const options = Object.keys(roles).sort((a,b)=>Number(a)-Number(b)).map(l=>({ label: `Level ${l}`, value: String(l) }));
          if (options.length === 0) return btn.reply({ content: 'No configured roles to remove.', ephemeral: true });
          const menu = new StringSelectMenuBuilder().setCustomId('lvl_select_remove').setPlaceholder('Select level to remove').setMinValues(1).setMaxValues(1).addOptions(options);
          const row = new ActionRowBuilder().addComponents(menu);
          await btn.update({ content: 'Choose a level to remove', embeds: [], components: [buildNavRow(), row] });
        });
        lifecycle.addDisposable(offRemoveRole);

        const offSelectRemove = interactions.registerSelect(moduleName, 'lvl_select_remove', async (sel) => {
          if (!sel.inCachedGuild()) return;
          if (!sel.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return sel.reply({ content: 'Missing permission.', ephemeral: true });
          const lvl = sel.values?.[0];
          if (!lvl) return sel.reply({ content: 'No level chosen.', ephemeral: true });
          try {
            const s = await getGuildSettings(ctx, sel.guildId) || {};
            if (s.levelRoles && s.levelRoles[lvl]) delete s.levelRoles[lvl];
            await upsertGuildSettings(ctx, sel.guildId, s);
            // Show updated roles page after removal
            const updated = await getGuildSettings(ctx, sel.guildId) || {};
            const updatedRoles = updated.levelRoles || {};
            const updatedLines = Object.keys(updatedRoles).sort((a,b)=>Number(a)-Number(b)).map(l=>`${l}: <@&${updatedRoles[l]}>`).join('\n') || 'No level roles configured.';
            const updatedEmbed = new EmbedBuilder().setTitle('Level Roles Updated').setDescription(updatedLines).setColor(0x2b2d31);
            await sel.update({ embeds: [updatedEmbed], components: [buildNavRow()] });
          } catch (e) { ctx.logger?.warn?.('[Leveling] remove role failed', { error: e?.message }); try { await sel.reply({ content: 'Failed to remove role.', ephemeral: true }); } catch { void e; } }
        });
        lifecycle.addDisposable(offSelectRemove);

        // Manage user page
        const offManage = interactions.registerButton(moduleName, 'lvl_page_manage', async (btn) => {
          if (!btn.inCachedGuild()) return;
          if (!btn.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return btn.reply({ content: 'Missing permission.', ephemeral: true });
          const embed = new EmbedBuilder().setTitle('Manage User').setDescription('Use buttons to add/remove XP, set level, or reset user data').setColor(0x2b2d31);
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('lvl_mod_add_xp').setLabel('Add XP').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('lvl_mod_remove_xp').setLabel('Remove XP').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('lvl_mod_set_level').setLabel('Set Level').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('lvl_mod_reset').setLabel('Reset User').setStyle(ButtonStyle.Danger)
          );
          await btn.update({ embeds: [embed], components: [buildNavRow(), row] });
        });
        lifecycle.addDisposable(offManage);

  // User management flows: present a User select first, then modal for amounts/levels
  // Use distinct select menu IDs per flow so handlers don't conflict.
  const userSelectRowAdd = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('lvl_select_user_add').setPlaceholder('Select a user').setMinValues(1).setMaxValues(1));
  const userSelectRowRemove = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('lvl_select_user_remove').setPlaceholder('Select a user').setMinValues(1).setMaxValues(1));
  const userSelectRowSet = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('lvl_select_user_set').setPlaceholder('Select a user').setMinValues(1).setMaxValues(1));
  const userSelectRowReset = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('lvl_select_user_reset').setPlaceholder('Select a user').setMinValues(1).setMaxValues(1));

        const offAddXpBtn = interactions.registerButton(moduleName, 'lvl_mod_add_xp', async (btn) => {
          if (!btn.inCachedGuild()) return;
          if (!btn.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return btn.reply({ content: 'Missing permission.', ephemeral: true });
          // update the admin message to ask for a user (in-place)
          await btn.update({ content: 'Select a user to add XP to', embeds: [], components: [buildNavRow(), userSelectRowAdd] });
        });
        lifecycle.addDisposable(offAddXpBtn);

  const offAddUserSelect = interactions.registerSelect(moduleName, 'lvl_select_user_add', async (sel) => {
          if (!sel.inCachedGuild()) return;
          if (!sel.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return sel.reply({ content: 'Missing permission.', ephemeral: true });
          const userId = sel.values?.[0];
          if (!userId) return sel.reply({ content: 'No user selected.', ephemeral: true });
          // store session for add xp flow (include admin message id)
          ctx._leveling_admin_sessions.set(`add_xp:${sel.user.id}`, { userId, messageId: sel.message?.id });
          const modal = new ModalBuilder().setCustomId('lvl_modal_add_xp').setTitle('Add XP - Amount');
          const amount = new TextInputBuilder().setCustomId('amount').setLabel('Amount').setStyle(TextInputStyle.Short).setRequired(true);
          modal.addComponents({ type:1, components: [amount] });
          try { await sel.showModal(modal); } catch (e) { try { await sel.reply({ content: 'Failed to open modal.', ephemeral: true }); } catch { void e; } }
        });
        lifecycle.addDisposable(offAddUserSelect);

        const offAddXpModal = interactions.registerModal(moduleName, 'lvl_modal_add_xp', async (modal) => {
          if (!modal.inCachedGuild()) return;
          if (!modal.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return modal.reply({ content: 'Missing permission.', ephemeral: true });
          try {
            const guildId = modal.guildId;
            const session = ctx._leveling_admin_sessions.get(`add_xp:${modal.user.id}`) || {};
            const userId = session.userId;
            const adminMsgId = session.messageId;
            const amt = Number(modal.fields.getTextInputValue('amount'));
            if (!userId || !Number.isFinite(amt)) return modal.reply({ content: 'Invalid input.', ephemeral: true });
            await addXpToUser(ctx, guildId, userId, Math.floor(amt));
            ctx._leveling_admin_sessions.delete(`add_xp:${modal.user.id}`);
            const confirmAdd = new EmbedBuilder().setTitle('XP Added').setDescription(`Added **${Math.floor(amt)}** XP to <@${userId}>.`).setColor(0x00ff00);
            try {
              await modal.deferReply({ ephemeral: true });
              if (adminMsgId && modal.channel) {
                const msg = await modal.channel.messages.fetch(adminMsgId).catch(() => null);
                if (msg) await msg.edit({ embeds: [confirmAdd], components: [buildNavRow()] }).catch(() => null);
              }
              await modal.editReply({ content: 'Updated.', ephemeral: true });
            } catch (e) { ctx.logger?.warn?.('[Leveling] add xp edit failed', { error: e?.message }); try { await modal.reply({ content: 'Failed to update admin message.', ephemeral: true }); } catch { void e; } }
          } catch (e) { ctx.logger?.warn?.('[Leveling] add xp modal failed', { error: e?.message }); try { await modal.reply({ content: 'Failed.', ephemeral: true }); } catch { void e; } }
        });
        lifecycle.addDisposable(offAddXpModal);

        const offRemoveXpBtn = interactions.registerButton(moduleName, 'lvl_mod_remove_xp', async (btn) => {
          if (!btn.inCachedGuild()) return;
          if (!btn.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return btn.reply({ content: 'Missing permission.', ephemeral: true });
          await btn.update({ content: 'Select a user to remove XP from', embeds: [], components: [buildNavRow(), userSelectRowRemove] });
        });
        lifecycle.addDisposable(offRemoveXpBtn);

  const offRemoveUserSelect = interactions.registerSelect(moduleName, 'lvl_select_user_remove', async (sel) => {
          // This handler intentionally shares the same customId as other user flows; we branch by session presence
          if (!sel.inCachedGuild()) return;
          if (!sel.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return sel.reply({ content: 'Missing permission.', ephemeral: true });
          const userId = sel.values?.[0];
          if (!userId) return sel.reply({ content: 'No user selected.', ephemeral: true });
          // store session for remove xp flow (include admin message id)
          ctx._leveling_admin_sessions.set(`remove_xp:${sel.user.id}`, { userId, messageId: sel.message?.id });
          const modal = new ModalBuilder().setCustomId('lvl_modal_remove_xp').setTitle('Remove XP - Amount');
          const amount = new TextInputBuilder().setCustomId('amount').setLabel('Amount').setStyle(TextInputStyle.Short).setRequired(true);
          modal.addComponents({ type:1, components: [amount] });
          try { await sel.showModal(modal); } catch (e) { try { await sel.reply({ content: 'Failed to open modal.', ephemeral: true }); } catch { void e; } }
        });
        lifecycle.addDisposable(offRemoveUserSelect);

        const offRemoveXpModal = interactions.registerModal(moduleName, 'lvl_modal_remove_xp', async (modal) => {
          if (!modal.inCachedGuild()) return;
          if (!modal.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return modal.reply({ content: 'Missing permission.', ephemeral: true });
          try {
            const guildId = modal.guildId;
            const session = ctx._leveling_admin_sessions.get(`remove_xp:${modal.user.id}`) || {};
            const userId = session.userId;
            const adminMsgId = session.messageId;
            const amt = Number(modal.fields.getTextInputValue('amount'));
            if (!userId || !Number.isFinite(amt)) return modal.reply({ content: 'Invalid input.', ephemeral: true });
            await removeXpFromUser(ctx, guildId, userId, Math.floor(amt));
            ctx._leveling_admin_sessions.delete(`remove_xp:${modal.user.id}`);
            const confirmRemove = new EmbedBuilder().setTitle('XP Removed').setDescription(`Removed **${Math.floor(amt)}** XP from <@${userId}>.`).setColor(0xff9900);
            try {
              await modal.deferReply({ ephemeral: true });
              if (adminMsgId && modal.channel) {
                const msg = await modal.channel.messages.fetch(adminMsgId).catch(() => null);
                if (msg) await msg.edit({ embeds: [confirmRemove], components: [buildNavRow()] }).catch(() => null);
              }
              await modal.editReply({ content: 'Updated.', ephemeral: true });
            } catch (e) { ctx.logger?.warn?.('[Leveling] remove xp edit failed', { error: e?.message }); try { await modal.reply({ content: 'Failed to update admin message.', ephemeral: true }); } catch { void e; } }
          } catch (e) { ctx.logger?.warn?.('[Leveling] remove xp modal failed', { error: e?.message }); try { await modal.reply({ content: 'Failed.', ephemeral: true }); } catch { void e; } }
        });
        lifecycle.addDisposable(offRemoveXpModal);

        const offSetLevelBtn = interactions.registerButton(moduleName, 'lvl_mod_set_level', async (btn) => {
          if (!btn.inCachedGuild()) return;
          if (!btn.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return btn.reply({ content: 'Missing permission.', ephemeral: true });
          await btn.update({ content: 'Select a user to set level for', embeds: [], components: [buildNavRow(), userSelectRowSet] });
        });
        lifecycle.addDisposable(offSetLevelBtn);

  const offSetUserSelect = interactions.registerSelect(moduleName, 'lvl_select_user_set', async (sel) => {
          if (!sel.inCachedGuild()) return;
          if (!sel.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return sel.reply({ content: 'Missing permission.', ephemeral: true });
          const userId = sel.values?.[0];
          if (!userId) return sel.reply({ content: 'No user selected.', ephemeral: true });
          ctx._leveling_admin_sessions.set(`set_level:${sel.user.id}`, { userId, messageId: sel.message?.id });
          const modal = new ModalBuilder().setCustomId('lvl_modal_set_level').setTitle('Set Level - Input');
          const lvlInput = new TextInputBuilder().setCustomId('level').setLabel('Level').setStyle(TextInputStyle.Short).setRequired(true);
          modal.addComponents({ type:1, components: [lvlInput] });
          try { await sel.showModal(modal); } catch (e) { try { await sel.reply({ content: 'Failed to open modal.', ephemeral: true }); } catch { void e; } }
        });
        lifecycle.addDisposable(offSetUserSelect);

        const offSetLevelModal = interactions.registerModal(moduleName, 'lvl_modal_set_level', async (modal) => {
          if (!modal.inCachedGuild()) return;
          if (!modal.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return modal.reply({ content: 'Missing permission.', ephemeral: true });
          try {
            const guildId = modal.guildId;
            const session = ctx._leveling_admin_sessions.get(`set_level:${modal.user.id}`) || {};
            const userId = session.userId;
            const adminMsgId = session.messageId;
            const lvl = Number(modal.fields.getTextInputValue('level'));
            if (!userId || !Number.isFinite(lvl)) return modal.reply({ content: 'Invalid input.', ephemeral: true });
            await setUserLevel(ctx, guildId, userId, Math.floor(lvl));
            ctx._leveling_admin_sessions.delete(`set_level:${modal.user.id}`);
            const confirmSet = new EmbedBuilder().setTitle('Level Updated').setDescription(`<@${userId}>'s level set to **${Math.floor(lvl)}**.`).setColor(0x00ff00);
            try {
              await modal.deferReply({ ephemeral: true });
              if (adminMsgId && modal.channel) {
                const msg = await modal.channel.messages.fetch(adminMsgId).catch(() => null);
                if (msg) await msg.edit({ embeds: [confirmSet], components: [buildNavRow()] }).catch(() => null);
              }
              await modal.editReply({ content: 'Updated.', ephemeral: true });
            } catch (e) { ctx.logger?.warn?.('[Leveling] set level edit failed', { error: e?.message }); try { await modal.reply({ content: 'Failed to update admin message.', ephemeral: true }); } catch { void e; } }
          } catch (e) { ctx.logger?.warn?.('[Leveling] set level modal failed', { error: e?.message }); try { await modal.reply({ content: 'Failed.', ephemeral: true }); } catch { void e; } }
        });
        lifecycle.addDisposable(offSetLevelModal);

        const offResetBtn = interactions.registerButton(moduleName, 'lvl_mod_reset', async (btn) => {
          if (!btn.inCachedGuild()) return;
          if (!btn.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return btn.reply({ content: 'Missing permission.', ephemeral: true });
          await btn.update({ content: 'Select a user to reset', embeds: [], components: [buildNavRow(), userSelectRowReset] });
        });
        lifecycle.addDisposable(offResetBtn);

  const offResetUserSelect = interactions.registerSelect(moduleName, 'lvl_select_user_reset', async (sel) => {
          if (!sel.inCachedGuild()) return;
          if (!sel.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return sel.reply({ content: 'Missing permission.', ephemeral: true });
          const userId = sel.values?.[0];
          if (!userId) return sel.reply({ content: 'No user selected.', ephemeral: true });
          try {
            await resetUser(ctx, sel.guildId, userId);
            const resetEmbed = new EmbedBuilder().setTitle('User Reset').setDescription(`User <@${userId}>'s data has been reset.`).setColor(0xff0000);
            await sel.update({ embeds: [resetEmbed], components: [buildNavRow()] });
          } catch (e) { ctx.logger?.warn?.('[Leveling] reset user failed', { error: e?.message }); try { await sel.reply({ content: 'Failed to reset user.', ephemeral: true }); } catch { void e; } }
        });
        lifecycle.addDisposable(offResetUserSelect);

        // Export button
        const offExport = interactions.registerButton(moduleName, 'lvl_export', async (btn) => {
          if (!btn.inCachedGuild()) return;
          if (!btn.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return btn.reply({ content: 'Missing permission.', ephemeral: true });
          try {
            const data = await exportGuildData(ctx, btn.guildId);
            const buf = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
            const att = new AttachmentBuilder(buf, { name: `leveling-${btn.guildId}.json` });
            await btn.reply({ content: 'Exported data:', files: [att], ephemeral: true });
          } catch (e) { ctx.logger?.warn?.('[Leveling] export failed', { error: e?.message }); try { await btn.reply({ content: 'Export failed.', ephemeral: true }); } catch { void e; } }
        });
        lifecycle.addDisposable(offExport);

        // Back button
        const offBack = interactions.registerButton(moduleName, 'lvl_back', async (btn) => {
          if (!btn.inCachedGuild()) return;
          if (!btn.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return btn.reply({ content: 'Missing permission.', ephemeral: true });
          const s = await getGuildSettings(ctx, btn.guildId) || {};
          try { await btn.update({ embeds: [buildMainEmbed(s, ctx)], components: [buildNavRow()] }); } catch (e) { try { await btn.reply({ content: 'Failed to go back.', ephemeral: true }); } catch { void e; } }
        });
        lifecycle.addDisposable(offBack);

        ctx._leveling_admin_registered = true;
      }
    } catch (e) {
      ctx.logger?.warn?.('[Leveling] admin interaction registration failed', { error: e?.message });
    }
  };
}

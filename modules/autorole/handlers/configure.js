import {
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  getGuildSettings,
  setGuildSettings,
  validateRoleAssignable,
} from '../services/settings.js';

/**
 * Registers the /autorole command using v2 InteractionCommandBuilder.
 * Single-level command "autorole" that opens an interactive config UI.
 *
 * Fix: Maintain in-memory session state per message to avoid losing the role selection
 * when pressing other buttons. Previously, the embed field was the only state source,
 * which desynced when components updated. We now keep a Map keyed by message.id to
 * hold the current edited settings snapshot until Save/Cancel.
 */
export function createConfigureCommand(ctx) {
  const { v2, lifecycle, logger, interactions } = ctx;
  const moduleName = 'autorole';

  // In-memory per-message session state for config editing
  // key: messageId -> { guildId, roleId, delaySeconds, ignoreBots, minAccountAgeDays }
  const session = new Map();
  const getSession = (messageId) => session.get(messageId);
  const setSession = (messageId, data) => session.set(messageId, data);
  const clearSession = (messageId) => session.delete(messageId);

  // Define a single-level /autorole command
  const cmd = v2
    .createInteractionCommand()
    .setName('autorole')
    .setDescription('Open autorole configuration')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild) // already set
    .addPrecondition(async (interaction) => {
      const has = interaction.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)
      if (!has) return 'You need Manage Guild permission to use this command.';
      return true;
    })
    .onExecute(async (interaction) => {
      try {
        if (!interaction.guildId) {
          await interaction.reply({
            content: 'This command can only be used in a server.',
            ephemeral: true,
          });
          return;
        }
        const base = await getGuildSettings(ctx, interaction.guildId);
        const snapshot = {
          guildId: interaction.guildId,
          roleId: base.roleId ?? null,
          delaySeconds: Number(base.delaySeconds || 0),
          ignoreBots: Boolean(base.ignoreBots),
          minAccountAgeDays: base.minAccountAgeDays == null ? null : Number(base.minAccountAgeDays),
        };
        const view = buildConfigEmbed(interaction.guild, snapshot);
        await interaction.reply({
          embeds: [view.embed],
          components: view.components,
          ephemeral: true,
        });

        // Store session state for this message
        const msg = await interaction.fetchReply();
        setSession(msg.id, snapshot);
        lifecycle.addDisposable(() => {
          try {
            clearSession(msg.id);
          } catch (err) { void err; }
        });
      } catch (e) {
        logger.warn('[Autorole] open configure failed', { error: e?.message || e });
        try {
          await interaction.reply({ content: 'Error opening configuration.', ephemeral: true });
        } catch (err) { void err; }
      }
    });

  const off = v2.register(cmd);
  lifecycle.addDisposable(() => {
    try {
      off?.();
    } catch (err) { void err; }
  });

  // Component handlers via core interactions

  // Role select: update session and view
  const offRole = interactions.registerSelect(moduleName, 'ar_role_select', async (interaction) => {
    if (!interaction.inCachedGuild()) return;
    if (!interaction.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: 'Missing permission.', ephemeral: true });
    }
    const msgId = interaction.message?.id;
    const cur = getSession(msgId);
    if (!cur) {
      return interaction.reply({ content: 'Session expired. Re-run /autorole.', ephemeral: true });
    }

    const chosenRoleId = interaction.values?.[0] || null;
    if (chosenRoleId) {
      const v = validateRoleAssignable(interaction.guild, chosenRoleId);
      if (!v.ok) {
        return interaction.reply({
          content: `Cannot assign that role: ${v.reason}`,
          ephemeral: true,
        });
      }
    }

    const next = { ...cur, roleId: chosenRoleId };
    setSession(msgId, next);
    await updateView(interaction, interaction.guild, next);
  });
  lifecycle.addDisposable(offRole);

  const buttonIds = [
    'ar_delay_none',
    'ar_delay_10s',
    'ar_delay_60s',
    'ar_delay_5m',
    'ar_delay_custom',
    'ar_toggle_ignore_bots',
    'ar_toggle_age_gate',
    'ar_age_days_custom',
    'ar_save',
    'ar_cancel',
  ];
  for (const id of buttonIds) {
    const offBtn = interactions.registerButton(moduleName, id, async (interaction) => {
      try {
        if (!interaction.inCachedGuild()) return;
        if (!interaction.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) {
          return interaction.reply({ content: 'Missing permission.', ephemeral: true });
        }

        const msgId = interaction.message?.id;
        const cur = getSession(msgId);
        if (!cur) {
          return interaction.reply({
            content: 'Session expired. Re-run /autorole.',
            ephemeral: true,
          });
        }

        // Handle button actions mutating session snapshot
        if (id.startsWith('ar_delay_')) {
          if (id === 'ar_delay_none') {
            const next = { ...cur, delaySeconds: 0 };
            setSession(msgId, next);
            return updateView(interaction, interaction.guild, next);
          }
          if (id === 'ar_delay_10s') {
            const next = { ...cur, delaySeconds: 10 };
            setSession(msgId, next);
            return updateView(interaction, interaction.guild, next);
          }
          if (id === 'ar_delay_60s') {
            const next = { ...cur, delaySeconds: 60 };
            setSession(msgId, next);
            return updateView(interaction, interaction.guild, next);
          }
          if (id === 'ar_delay_5m') {
            const next = { ...cur, delaySeconds: 5 * 60 };
            setSession(msgId, next);
            return updateView(interaction, interaction.guild, next);
          }
          if (id === 'ar_delay_custom') {
            const modal = new ModalBuilder()
              .setTitle('Custom Delay (seconds)')
              .setCustomId('ar_modal_delay');
            const input = new TextInputBuilder()
              .setCustomId('ar_modal_delay_input')
              .setLabel('Delay in seconds (0-86400)')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('e.g., 30')
              .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
          }
        }

        if (id === 'ar_toggle_ignore_bots') {
          const next = { ...cur, ignoreBots: !cur.ignoreBots };
          setSession(msgId, next);
          return updateView(interaction, interaction.guild, next);
        }

        if (id === 'ar_toggle_age_gate') {
          const wasEnabled =
            cur.minAccountAgeDays != null && Number.isFinite(cur.minAccountAgeDays);
          const next = { ...cur, minAccountAgeDays: wasEnabled ? null : 7 };
          setSession(msgId, next);
          return updateView(interaction, interaction.guild, next);
        }

        if (id === 'ar_age_days_custom') {
          const modal = new ModalBuilder()
            .setTitle('Minimum Account Age (days)')
            .setCustomId('ar_modal_age_days');
          const input = new TextInputBuilder()
            .setCustomId('ar_modal_age_days_input')
            .setLabel('Days (>= 0)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., 3')
            .setRequired(true);
          modal.addComponents(new ActionRowBuilder().addComponents(input));
          return interaction.showModal(modal);
        }

        if (id === 'ar_save') {
          // Validate against session snapshot (not the embed text)
          if (!cur.roleId) {
            return interaction.reply({
              content: 'Please select a role before saving.',
              ephemeral: true,
            });
          }
          const v = validateRoleAssignable(interaction.guild, cur.roleId);
          if (!v.ok) {
            return interaction.reply({ content: `Cannot save: ${v.reason}`, ephemeral: true });
          }
          const toSave = {
            enabled: true,
            roleId: cur.roleId,
            delaySeconds: cur.delaySeconds,
            ignoreBots: cur.ignoreBots,
            minAccountAgeDays: cur.minAccountAgeDays,
          };
          await setGuildSettings(ctx, cur.guildId, toSave);
          try {
            ctx.autorole?.invalidate?.(cur.guildId);
          } catch (err) { void err; }
          const savedView = buildConfigEmbed(interaction.guild, { ...toSave });
          // Clear session on save
          clearSession(msgId);
          return interaction.update({
            embeds: [savedView.embed.setFooter({ text: 'Saved ✔' })],
            components: savedView.components,
          });
        }

        if (id === 'ar_cancel') {
          clearSession(msgId);
          try {
            await interaction.update({
              content: 'Configuration closed.',
              embeds: [],
              components: [],
            });
          } catch {
            await interaction.reply({ content: 'Configuration closed.', ephemeral: true });
          }
          return;
        }
      } catch (e) {
        logger.warn('[Autorole] button handler error', { error: e?.message || e });
        if (interaction.isRepliable?.()) {
          try {
            await interaction.reply({ content: 'Interaction failed.', ephemeral: true });
          } catch (err) { void err; }
        }
      }
    });
    lifecycle.addDisposable(offBtn);
  }

  // Modal handlers
  const offModalDelay = interactions.registerModal(
    moduleName,
    'ar_modal_delay',
    async (interaction) => {
      if (!interaction.inCachedGuild()) return;
      if (!interaction.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: 'Missing permission.', ephemeral: true });
      }
      const msgId = interaction.message?.id;
      const cur = getSession(msgId);
      if (!cur) {
        return interaction.reply({
          content: 'Session expired. Re-run /autorole.',
          ephemeral: true,
        });
      }
      const raw = interaction.fields.getTextInputValue('ar_modal_delay_input');
      const secs = Number(raw);
      if (!Number.isFinite(secs) || secs < 0 || secs > 86400) {
        return interaction.reply({
          content: 'Invalid delay. Enter a number between 0 and 86400.',
          ephemeral: true,
        });
      }
      const next = { ...cur, delaySeconds: Math.floor(secs) };
      setSession(msgId, next);
      const view = buildConfigEmbed(interaction.guild, next);
      await interaction.update({ embeds: [view.embed], components: view.components });
    }
  );
  lifecycle.addDisposable(offModalDelay);

  const offModalAge = interactions.registerModal(
    moduleName,
    'ar_modal_age_days',
    async (interaction) => {
      if (!interaction.inCachedGuild()) return;
      if (!interaction.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: 'Missing permission.', ephemeral: true });
      }
      const msgId = interaction.message?.id;
      const cur = getSession(msgId);
      if (!cur) {
        return interaction.reply({
          content: 'Session expired. Re-run /autorole.',
          ephemeral: true,
        });
      }
      const raw = interaction.fields.getTextInputValue('ar_modal_age_days_input');
      const days = Number(raw);
      if (!Number.isFinite(days) || days < 0) {
        return interaction.reply({
          content: 'Invalid number of days. Provide an integer >= 0.',
          ephemeral: true,
        });
      }
      const next = { ...cur, minAccountAgeDays: Math.floor(days) };
      setSession(msgId, next);
      const view = buildConfigEmbed(interaction.guild, next);
      await interaction.update({ embeds: [view.embed], components: view.components });
    }
  );
  lifecycle.addDisposable(offModalAge);

  return { name: 'autorole (v2)' };
}

function buildConfigEmbed(guild, settings) {
  const role = settings.roleId ? guild.roles.cache.get(settings.roleId) : null;
  const delayText = settings.delaySeconds > 0 ? `${settings.delaySeconds}s` : 'No delay';
  const ageGateEnabled =
    settings.minAccountAgeDays != null && Number.isFinite(settings.minAccountAgeDays);
  const ageGateText = ageGateEnabled ? `${settings.minAccountAgeDays} day(s)` : 'Disabled';

  const embed = new EmbedBuilder()
    .setTitle('Autorole Configuration')
    .setDescription(
      'Configure the role assignment behavior for new members.\nOnly users with Manage Guild can use this.'
    )
    .addFields(
      { name: 'Role', value: role ? `<@&${role.id}>` : 'Not set', inline: true },
      { name: 'Delay', value: delayText, inline: true },
      { name: 'Ignore Bots', value: settings.ignoreBots ? 'On' : 'Off', inline: true },
      { name: 'Account Age Gate', value: ageGateText, inline: true }
    )
    .setColor(0x2b2d31);

  const roleRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('ar_role_select')
      .setPlaceholder('Select a role to assign')
      .setMinValues(0)
      .setMaxValues(1)
  );

  const delayRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ar_delay_none')
      .setLabel('No Delay')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ar_delay_10s').setLabel('10s').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ar_delay_60s').setLabel('60s').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ar_delay_5m').setLabel('5m').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ar_delay_custom')
      .setLabel('Custom…')
      .setStyle(ButtonStyle.Primary)
  );

  const togglesRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ar_toggle_ignore_bots')
      .setLabel(`Ignore Bots: ${settings.ignoreBots ? 'On' : 'Off'}`)
      .setStyle(settings.ignoreBots ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ar_toggle_age_gate')
      .setLabel(`Age Gate: ${ageGateEnabled ? 'On' : 'Off'}`)
      .setStyle(ageGateEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ar_age_days_custom')
      .setLabel('Set Age Days…')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!ageGateEnabled)
  );

  const actionsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ar_save').setLabel('Save').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ar_cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
  );

  return {
    embed,
    components: [roleRow, delayRow, togglesRow, actionsRow],
  };
}

async function updateView(interaction, guild, snapshot) {
  const view = buildConfigEmbed(guild, snapshot);
  await interaction.update({ embeds: [view.embed], components: view.components });
}

// Retained for completeness, but no longer used for Save, since we rely on session state.
// Keeping it here in case we want a fallback in the future.
function parseEmbedState(message) {
  const embed = message.embeds?.[0];
  const fields = embed?.data?.fields || embed?.fields || [];
  const map = {};
  for (const f of fields) {
    map[f.name] = typeof f.value === 'string' ? f.value : `${f.value}`;
  }
  let roleId = null;
  const roleField = map['Role'] || '';
  const m = roleField.match(/<@&(\d+)>/);
  if (m) roleId = m[1];

  let delaySeconds = 0;
  const delayField = map['Delay'] || 'No delay';
  if (/^\d+s$/.test(delayField.trim())) {
    delaySeconds = parseInt(delayField, 10);
  }

  const ignoreBots = (map['Ignore Bots'] || 'On').trim().toLowerCase() === 'on';

  let minAccountAgeDays = null;
  const ageField = map['Account Age Gate'] || 'Disabled';
  if (/^\d+\s*day/i.test(ageField)) {
    const v = parseInt(ageField, 10);
    if (Number.isFinite(v)) minAccountAgeDays = v;
  }

  return { roleId, delaySeconds, ignoreBots, minAccountAgeDays };
}

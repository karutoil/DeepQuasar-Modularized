import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, PermissionsBitField, SelectMenuBuilder, ChannelType } from 'discord.js';
import { validateConfigPatch } from '../utils/validators.js';

async function buildConfigEmbed(core, cfg, guild) {
  const embed = new EmbedBuilder()
    .setTitle(`Leveling Configuration — ${guild?.name || cfg.guildId}`)
    .addFields(
      { name: 'xpPerMessage', value: String(cfg.xpPerMessage ?? 'n/a'), inline: true },
      { name: 'cooldownSeconds', value: String(cfg.cooldownSeconds ?? 'n/a'), inline: true },
      { name: 'formula', value: cfg.formula?.type || 'linear', inline: true },
      { name: 'roleRewards', value: String((cfg.roleRewards || []).length), inline: true },
      { name: 'exclusions', value: `${(cfg.exclusions?.channels || []).length} channels, ${(cfg.exclusions?.roles || []).length} roles`, inline: true },
      { name: 'toggles', value: JSON.stringify(cfg.toggles || {}), inline: false }
    )
    .setFooter({ text: `Version: ${cfg.version || 1} • Last updated: ${cfg.lastUpdated || 'never'}` });
  return embed;
}

async function ensureManageGuild(interaction) {
  if (!interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild)) {
    await interaction.reply({ content: 'You need Manage Guild to configure leveling.', ephemeral: true });
    return false;
  }
  return true;
}

export default {
  async execute(interaction, core, levelService) {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.options.getSubcommand() !== 'config') return;
    if (!ensureManageGuild(interaction)) return;
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;
    const cfg = await levelService.loadConfig(guild.id);
    const embed = await buildConfigEmbed(core, cfg, guild);

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('lv_edit_general').setLabel('Edit General').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('lv_manage_roles').setLabel('Manage Roles').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('lv_exclusions').setLabel('Channel Exclusions').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('lv_import').setLabel('Import').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('lv_export').setLabel('Export').setStyle(ButtonStyle.Success)
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('lv_close').setLabel('Close').setStyle(ButtonStyle.Danger)
    );

    const msg = await interaction.editReply({ embeds: [embed], components: [row1, row2] });

    const collector = msg.createMessageComponentCollector({ time: 10 * 60 * 1000 });
    collector.on('collect', async (i) => {
      try {
        if (i.user.id !== interaction.user.id) return i.reply({ content: 'Only the command user may interact with this UI.', ephemeral: true });
        if (i.customId === 'lv_select_channels') {
          // Toggle selected channels in exclusions
          const selected = i.values || [];
          const existing = new Set(cfg.exclusions?.channels || []);
          for (const cid of selected) {
            if (existing.has(cid)) existing.delete(cid);
            else existing.add(cid);
          }
          const newCfg = { ...cfg, exclusions: { ...(cfg.exclusions || {}), channels: Array.from(existing) } };
          const updated = await levelService.saveConfig(guild.id, newCfg, interaction.user.id);
          await i.reply({ content: `Updated excluded channels: ${updated.exclusions.channels.length}`, ephemeral: true });
        } else if (i.customId === 'lv_edit_general') {
          const modal = new ModalBuilder().setCustomId('lv_modal_general').setTitle('Edit General');
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('xpPerMessage').setLabel('XP per message').setStyle(TextInputStyle.Short).setPlaceholder(String(cfg.xpPerMessage || 15)).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cooldownSeconds').setLabel('Cooldown seconds').setStyle(TextInputStyle.Short).setPlaceholder(String(cfg.cooldownSeconds || 60)).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('xpCapPerWindow').setLabel('XP cap per window').setStyle(TextInputStyle.Short).setPlaceholder(String(cfg.xpCapPerWindow || 300)).setRequired(false))
          );
          await i.showModal(modal);
          const sub = await i.awaitModalSubmit({ time: 120000 }).catch(() => null);
          if (!sub) return;
          const patch = {};
          if (sub.fields.getTextInputValue('xpPerMessage')) patch.xpPerMessage = Number(sub.fields.getTextInputValue('xpPerMessage'));
          if (sub.fields.getTextInputValue('cooldownSeconds')) patch.cooldownSeconds = Number(sub.fields.getTextInputValue('cooldownSeconds'));
          if (sub.fields.getTextInputValue('xpCapPerWindow')) patch.xpCapPerWindow = Number(sub.fields.getTextInputValue('xpCapPerWindow'));
          const valid = validateConfigPatch(patch);
          const updated = await levelService.saveConfig(guild.id, { ...cfg, ...valid }, interaction.user.id);
          await sub.reply({ content: 'General settings updated.', ephemeral: true });
          const newEmbed = await buildConfigEmbed(core, updated, guild);
          await interaction.editReply({ embeds: [newEmbed] });
        } else if (i.customId === 'lv_manage_roles') {
          // Show role reward list with options to add
          const rewards = cfg.roleRewards || [];
          const list = rewards.map((r, idx) => `${idx+1}. <@&${r.roleId}> at level ${r.level}${r.temporaryDays?` (temp ${r.temporaryDays}d)`:''}`).join('\n') || 'No rewards configured';
          await i.reply({ content: `Role rewards:\n${list}`, ephemeral: true });
        } else if (i.customId === 'lv_exclusions') {
          // open channel multi-select
          const select = new SelectMenuBuilder().setCustomId('lv_select_channels').setPlaceholder('Select channels to toggle exclusion').setMinValues(1).setMaxValues(10).addOptions(
            ...(guild.channels.cache.filter(c => c.type === ChannelType.GuildText).map(c => ({ label: c.name, value: c.id })) )
          );
          const rowSel = new ActionRowBuilder().addComponents(select);
          await i.reply({ content: 'Choose channels to toggle exclusion (selected entries will be toggled)', components: [rowSel], ephemeral: true });
        } else if (i.customId === 'lv_export') {
          const exported = JSON.stringify(cfg, null, 2);
          await i.reply({ content: 'Config export attached.', files: [{ attachment: Buffer.from(exported, 'utf8'), name: `leveling-config-${guild.id}.json` }], ephemeral: true });
        } else if (i.customId === 'lv_import') {
          const modal = new ModalBuilder().setCustomId('lv_modal_import').setTitle('Import Leveling Config');
          modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('importJson').setLabel('Paste JSON config').setStyle(TextInputStyle.Paragraph).setRequired(true)));
          await i.showModal(modal);
          const sub = await i.awaitModalSubmit({ time: 120000 }).catch(() => null);
          if (!sub) return;
          const raw = sub.fields.getTextInputValue('importJson');
          try {
            const parsed = JSON.parse(raw);
            // basic schema checks
            const patch = {};
            if (parsed.xpPerMessage !== undefined) patch.xpPerMessage = Number(parsed.xpPerMessage);
            if (parsed.cooldownSeconds !== undefined) patch.cooldownSeconds = Number(parsed.cooldownSeconds);
            if (parsed.formula) patch.formula = parsed.formula;
            if (Array.isArray(parsed.roleRewards)) patch.roleRewards = parsed.roleRewards;
            if (parsed.exclusions) patch.exclusions = parsed.exclusions;
            if (parsed.toggles) patch.toggles = parsed.toggles;
            const valid = validateConfigPatch(patch);
            const updated = await levelService.saveConfig(guild.id, { ...cfg, ...valid }, interaction.user.id);
            await sub.reply({ content: 'Imported settings applied.', ephemeral: true });
            const newEmbed = await buildConfigEmbed(core, updated, guild);
            await interaction.editReply({ embeds: [newEmbed] });
          } catch (err) {
            await sub.reply({ content: `Import failed: ${err?.message}`, ephemeral: true });
          }
        } else if (i.customId === 'lv_close') {
          collector.stop('closed');
          await i.update({ components: [] });
        }
      } catch (err) {
        core.logger.error('[leveling.admin] interaction error', { err: err?.message, stack: err?.stack });
      }
    });

    collector.on('end', async () => {
      try {
        await interaction.editReply({ components: [] });
      } catch (e) {
        core.logger.warn('[leveling.admin] failed editReply on collector end', { err: e?.message });
      }
    });
  }
};

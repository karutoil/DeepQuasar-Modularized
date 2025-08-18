import { PermissionsBitField } from 'discord.js';
import { getSettings, setSettings } from '../services/settingsService.js';

export default function(mod, _helpers) {
  const { v2, _lifecycle, embed } = mod;
  const _moduleName = 'music';

  const cmd = v2.createInteractionCommand()
    .setName('settings')
    .setDescription('Music module settings (Administrator only)')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addPrecondition(async (interaction) => {
      const has = interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
      return has ? true : 'You need Administrator permission to use this command.';
    });

  cmd.addOption((root) => {
    root.addSubcommand((sub) =>
      sub
        .setName('get')
        .setDescription('Show music settings for this server')
    );

    root.addSubcommand((sub) =>
      sub
        .setName('set-volume')
        .setDescription('Set default volume (0-100)')
        .addIntegerOption(opt => opt.setName('amount').setDescription('Volume 0-100').setRequired(true))
    );

    root.addSubcommand((sub) =>
      sub
        .setName('persistent-panel')
        .setDescription('Enable or disable the persistent queue panel for the server')
        .addStringOption(opt => opt.setName('action').setDescription('enable|disable').setRequired(true)
          .addChoices({ name: 'Enable', value: 'enable' }, { name: 'Disable', value: 'disable' }))
    );
  });

  cmd.onExecute(async (interaction) => {
    if (!interaction.guildId) return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'get') {
        const s = await getSettings(mod, interaction.guildId);
        const fields = [
          { name: 'Default volume', value: s.defaultVolume == null ? 'unset' : String(s.defaultVolume), inline: true },
          { name: 'Persistent queue panel', value: s.persistentQueuePanel?.enabled ? `enabled (channel: ${s.persistentQueuePanel.channelId || 'unknown'})` : 'disabled', inline: true },
        ];
        const em = embed.info({ title: 'Music settings', fields });
        return interaction.reply({ embeds: [em], ephemeral: true });
      }

      if (sub === 'set-volume') {
        const amt = interaction.options.getInteger('amount');
        if (isNaN(amt) || amt < 0 || amt > 100) return interaction.reply({ content: 'Volume must be 0-100.', ephemeral: true });
        const s = await setSettings(mod, interaction.guildId, { defaultVolume: amt });
        return interaction.reply({ content: `Default volume set to ${s.defaultVolume}.`, ephemeral: true });
      }

      if (sub === 'persistent-panel') {
        const action = (interaction.options.getString('action') || '').toLowerCase();
        if (action === 'enable') {
          // enable persistent panel; channel will be the channel where the player is first created
          const _updated = await setSettings(mod, interaction.guildId, { persistentQueuePanel: { enabled: true, channelId: null } });
          return interaction.reply({ content: `Persistent queue panel enabled; it will be created in the channel where the player is first spawned.`, ephemeral: true });
        }
        if (action === 'disable') {
          const _updated = await setSettings(mod, interaction.guildId, { persistentQueuePanel: { enabled: false, channelId: null } });
          return interaction.reply({ content: `Persistent queue panel disabled.`, ephemeral: true });
        }
        return interaction.reply({ content: 'Invalid action. Use enable|disable', ephemeral: true });
      }
    } catch (err) {
      return interaction.reply({ content: `Error: ${err?.message || err}`, ephemeral: true });
    }
  });

  // Return the command builder; registration is handled by the module index loader
  return cmd;
}

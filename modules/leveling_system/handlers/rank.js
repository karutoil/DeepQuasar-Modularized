import { EmbedBuilder } from 'discord.js';
import { getUserProfile } from '../services/levelService.js';

export default function createHandler(ctx) {
  return async function handler(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }
    const target = interaction.options.getUser('user') || interaction.user;
    try {
      const profile = await getUserProfile(ctx, guildId, target.id);
      if (!profile) {
        await interaction.reply({ content: 'No leveling data for that user.', ephemeral: true });
        return;
      }
      const progress = Math.min(1, (profile.xp || 0) / Math.max(1, profile.next || 1));
      const barLen = 20;
      const filled = Math.round(progress * barLen);
      const bar = '[' + '#'.repeat(filled) + '-'.repeat(barLen - filled) + ']';

      const embed = new EmbedBuilder()
        .setTitle(`${target.username}#${target.discriminator}`)
        .setThumbnail(target.displayAvatarURL?.({ extension: 'png' }))
        .addFields(
          { name: 'Level', value: String(profile.level), inline: true },
          { name: 'Prestige', value: String(profile.prestige || 0), inline: true },
          { name: 'XP', value: `${profile.xp}/${profile.next}`, inline: true },
          { name: 'Progress', value: bar, inline: false }
        )
        .setColor(0x4a90e2);

      await interaction.reply({ embeds: [embed], ephemeral: false });
    } catch (e) {
      ctx.logger?.warn?.('[Leveling] rank handler error', { error: e?.message });
      await interaction.reply({ content: 'Failed to fetch profile.', ephemeral: true });
    }
  };
}

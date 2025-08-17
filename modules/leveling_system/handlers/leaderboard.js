import { getLeaderboard } from '../services/levelService.js';
import { EmbedBuilder } from 'discord.js';

export default function createHandler(ctx) {
  return async function handler(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }
    const limit = interaction.options.getInteger('limit') || 10;
    try {
      const rows = await getLeaderboard(ctx, guildId, { limit });
      if (!rows || rows.length === 0) {
        await interaction.reply({ content: 'No leveling data available for this server.', ephemeral: true });
        return;
      }
  const lines = rows.map((r, idx) => `**${idx + 1}.** <@${r.id}> — Level ${r.level}${r.prestige ? ` (Prestige ${r.prestige})` : ''} (${r.xp} XP)`).join('\n');
      const embed = new EmbedBuilder().setTitle('Leveling Leaderboard').setDescription(lines).setColor(0x2b2d31);
      await interaction.reply({ embeds: [embed] });
    } catch (e) {
      ctx.logger?.warn?.('[Leveling] leaderboard handler error', { error: e?.message });
      await interaction.reply({ content: 'Failed to fetch leaderboard.', ephemeral: true });
    }
  };
}

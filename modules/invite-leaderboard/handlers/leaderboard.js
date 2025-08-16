import { getLeaderboard } from '../services/inviteService.js';

export default function createHandler(ctx) {
  return async function handler(interaction) {
    const { logger, embed } = ctx;
    const guildId = interaction.guildId;
    const limit = interaction.options.getInteger('limit') || 10;

    if (!guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    try {
      const rows = await getLeaderboard(ctx, guildId, { limit });
      if (!rows || rows.length === 0) {
        await interaction.reply({ content: 'No invite data available for this server.', ephemeral: true });
        return;
      }

      const lines = rows.map((r, idx) => {
        const display = r.who === 'UNKNOWN' ? 'Unknown' : `<@${r.who}>`;
        return `**${idx + 1}.** ${display} — **${r.count}**`;
      }).join('\n');

      const title = 'Invite Leaderboard';
      const description = lines;

      try {
        const msgEmbed = embed?.info ? embed.info({ title, description }) : { title, description };
        await interaction.reply({ embeds: [msgEmbed], ephemeral: false });
      } catch (err) {
        // Fallback to plain text if embed fails
        await interaction.reply({ content: `Top inviters:\n${lines}`, ephemeral: false });
      }
    } catch (err) {
      logger?.warn?.('[InviteLeaderboard] leaderboard handler error', { error: err?.message });
      await interaction.reply({ content: 'Failed to fetch leaderboard.', ephemeral: true });
    }
  };
}

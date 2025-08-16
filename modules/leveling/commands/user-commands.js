import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

function build() {
  const profile = new SlashCommandBuilder()
    .setName('level')
    .setDescription('Leveling user commands')
    .addSubcommand((s) => s.setName('profile').setDescription('Show profile').addUserOption(o=>o.setName('user').setDescription('User')))
    .addSubcommand((s) => s.setName('leaderboard').setDescription('Show leaderboard').addIntegerOption(o=>o.setName('page').setDescription('Page')))
    .addSubcommand((s) => s.setName('xp').setDescription('Show your xp'))
    .addSubcommand((s) => s.setName('optin').setDescription('Opt in to leveling'))
    .addSubcommand((s) => s.setName('optout').setDescription('Opt out of leveling'))
    .toJSON();
  return [profile];
}

async function registerHandlers(core, levelService) {
  const ch = core.commands;
  ch.v2RegisterExecute('level', async (interaction) => {
    await execute(interaction, core, levelService);
  });
}

async function execute(interaction, core, levelService) {
  if (!interaction.isChatInputCommand()) return;
  const sub = interaction.options.getSubcommand();
  if (sub === 'profile') {
    const user = interaction.options.getUser('user') || interaction.user;
    await interaction.deferReply({ ephemeral: false });
    const profile = await levelService.getProfile({ guildId: interaction.guildId, userId: user.id });
    const embed = new EmbedBuilder().setTitle(`${user.username}#${user.discriminator} — Level ${profile.level}`).addFields(
      { name: 'XP', value: String(profile.xp), inline: true },
      { name: 'Next level', value: String(profile.nextLevelXP), inline: true },
      { name: 'Rank', value: `Global: ${profile.globalRank} • Local: ${profile.localRank}`, inline: true }
    );
    // try rank card
    const buf = await levelService.renderRankCard({ guildId: interaction.guildId, userId: user.id });
    if (buf) {
      await interaction.editReply({ embeds: [embed], files: [{ attachment: buf, name: 'rank.png' }] });
    } else {
      await interaction.editReply({ embeds: [embed] });
    }
  } else if (sub === 'leaderboard') {
    await interaction.deferReply();
    const page = interaction.options.getInteger('page') || 0;
    const lb = await levelService.getLeaderboard({ guildId: interaction.guildId, page, limit: 10 });
    const lines = lb.entries.map(e => `${e.rank}. <@${e.userId}> — ${e.xp} xp (lvl ${e.level})`);
    const embed = new EmbedBuilder().setTitle('Leaderboard').setDescription(lines.join('\n'));
    await interaction.editReply({ embeds: [embed] });
  } else if (sub === 'xp') {
    await interaction.deferReply({ ephemeral: true });
    const profile = await levelService.getProfile({ guildId: interaction.guildId, userId: interaction.user.id });
    await interaction.editReply({ content: `You are level ${profile.level} with ${profile.xp} XP.` });
  } else if (sub === 'optout' || sub === 'optin') {
    const coll = await levelService.core.mongo.getCollection('leveling_members');
    await coll.updateOne({ guildId: interaction.guildId, userId: interaction.user.id }, { $set: { optedOut: sub === 'optout' } }, { upsert: true });
    await interaction.reply({ content: `Your opting status updated: ${sub === 'optout' ? 'opted out' : 'opted in'}`, ephemeral: true });
  }
}

export default { build, registerHandlers, execute };

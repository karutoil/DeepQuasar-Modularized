export default function(mod, helpers) {
  const { v2, dsl, embed } = mod;
  const { ensureRainlink, formatDuration } = helpers;

  return v2.createInteractionCommand()
    .setName("queue")
    .setDescription("Show the queue")
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) { await interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true }); return; }
      const current = player.queue.current;
      const upcoming = player.queue.slice(0, 25);
      const fields = [];
      if (current) {
        fields.push({ name: 'Now Playing', value: `${current.title}\n${current.author} • ${formatDuration(current.duration)}`, inline: false });
      }
      if (upcoming.length) {
        const list = upcoming.map((t, i) => `${i + 1}. ${t.title} — ${t.author} (${formatDuration(t.duration)})`).join('\n');
        fields.push({ name: `Upcoming (${player.queue.totalSize - (current ? 1 : 0)})`, value: list, inline: false });
      }
      const total = player.queue.totalSize ?? (upcoming.length + (current ? 1 : 0));
      const qEmbed = embed.info({ title: `Queue (${total})`, description: '\u200b', fields });
      if (current?.artworkUrl) qEmbed.setThumbnail(current.artworkUrl);
      await interaction.reply({ embeds: [qEmbed] });
    }));
}

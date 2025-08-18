export default function(mod, helpers) {
  const { v2, dsl, embed } = mod;
  const { ensureRainlink } = helpers;

  return v2.createInteractionCommand()
    .setName("shuffle")
    .setDescription("Shuffle the queue")
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) return interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true });
      player.queue.shuffle();
      await interaction.reply({ embeds: [embed.success({ title: "Queue shuffled." })] });
    }));
}

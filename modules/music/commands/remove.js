export default function(mod, helpers) {
  const { v2, dsl, embed } = mod;
  const { ensureRainlink } = helpers;

  return v2.createInteractionCommand()
    .setName("remove")
    .setDescription("Remove a track from the queue by index (1-based)")
    .addIntegerOption(opt => opt.setName("index").setDescription("1-based index").setRequired(true))
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const idx = interaction.options.getInteger("index");
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) return interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true });
      try {
        player.queue.remove(idx - 1);
        await interaction.reply({ embeds: [embed.success({ title: `Removed track at ${idx}` })] });
      } catch (err) {
        await interaction.reply({ embeds: [embed.error({ title: "Remove failed.", description: err?.message })], ephemeral: true });
      }
    }));
}

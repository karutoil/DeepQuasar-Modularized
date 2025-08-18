export default function(mod, helpers) {
  const { v2, dsl, embed } = mod;
  const { ensureRainlink } = helpers;

  return v2.createInteractionCommand()
    .setName("jump")
    .setDescription("Jump to queue position (1-based)")
    .addIntegerOption(opt => opt.setName("index").setDescription("1-based index").setRequired(true))
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const idx = interaction.options.getInteger("index");
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) return interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true });
      try {
        const track = player.queue[idx - 1];
        if (!track) throw new Error('No track at that position');
        await player.play(track, { replaceCurrent: true });
        await interaction.reply({ embeds: [embed.success({ title: `Jumped to ${idx}: ${track.title}` })] });
      } catch (err) {
        await interaction.reply({ embeds: [embed.error({ title: "Jump failed.", description: err?.message })], ephemeral: true });
      }
    }));
}

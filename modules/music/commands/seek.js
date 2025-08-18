export default function(mod, helpers) {
  const { v2, dsl, embed } = mod;
  const { ensureRainlink } = helpers;

  return v2.createInteractionCommand()
    .setName("seek")
    .setDescription("Seek to position (ms)")
    .addIntegerOption(opt => opt.setName("position").setDescription("Position in milliseconds").setRequired(true))
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const pos = interaction.options.getInteger("position");
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) return interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true });
      try {
        await player.seek(pos);
        await interaction.reply({ embeds: [embed.success({ title: `Seeked to ${pos}ms` })] });
      } catch (err) {
        await interaction.reply({ embeds: [embed.error({ title: "Seek failed.", description: err?.message })], ephemeral: true });
      }
    }));
}

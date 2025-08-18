export default function(mod, helpers) {
  const { v2, dsl, embed } = mod;
  const { ensureRainlink } = helpers;

  return v2.createInteractionCommand()
    .setName("loop")
    .setDescription("Set loop mode: none|song|queue")
    .addStringOption(opt => opt.setName("mode").setDescription("none|song|queue").setRequired(true))
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const mode = interaction.options.getString("mode");
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) return interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true });
      if (!helpers.state.loopEnum) return interaction.reply({ embeds: [embed.error({ title: "Loop enum not available." })], ephemeral: true });
      const map = { none: helpers.state.loopEnum.NONE ?? 'none', song: helpers.state.loopEnum.SONG ?? 'song', queue: helpers.state.loopEnum.QUEUE ?? 'queue' };
      const chosen = map[mode];
      if (!chosen) return interaction.reply({ embeds: [embed.error({ title: "Invalid loop mode." })], ephemeral: true });
      player.setLoop(chosen);
      await interaction.reply({ embeds: [embed.success({ title: `Loop set to ${mode}` })] });
    }));
}

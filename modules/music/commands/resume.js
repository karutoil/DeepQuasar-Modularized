export default function(mod, helpers) {
  const { v2, dsl, embed } = mod;
  const { ensureRainlink } = helpers;

  return v2.createInteractionCommand()
    .setName("resume")
    .setDescription("Resume playback")
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) { await interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true }); return; }
      player.pause(false);
      await interaction.reply({ embeds: [embed.success({ title: "Resumed." })] });
    }));
}

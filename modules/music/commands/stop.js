export default function(mod, helpers) {
  const { v2, dsl, embed } = mod;
  const { ensureRainlink } = helpers;

  return v2.createInteractionCommand()
    .setName("stop")
    .setDescription("Stop playback and clear queue")
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) { await interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true }); return; }
      player.queue.clear();
      await player.destroy();
      await interaction.reply({ embeds: [embed.success({ title: "Stopped and disconnected." })] });
    }));
}

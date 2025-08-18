export default function(mod, helpers) {
  const { v2, dsl, embed } = mod;
  const { ensureRainlink } = helpers;

  return v2.createInteractionCommand()
    .setName("skip")
    .setDescription("Skip the current track")
    .onExecute(dsl.withTryCatch(async (interaction) => {
      try {
        const rainlink = ensureRainlink();
        const player = rainlink.players.get(interaction.guild.id);
        if (!player) { await interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true }); return; }
        player.stop();
        await interaction.reply({ embeds: [embed.success({ title: "Skipped." })] });
      } catch (err) { await interaction.reply({ embeds: [embed.error({ title: "Error skipping.", description: err?.message })], ephemeral: true }); }
    }));
}

export default function(mod, helpers) {
  const { v2, dsl, embed } = mod;
  const { ensureRainlink, buildTrackEmbed } = helpers;

  return v2.createInteractionCommand()
    .setName("nowplaying")
    .setDescription("Show the currently playing track")
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      const current = player?.queue?.current;
      if (!player || !current) {
        await interaction.reply({ embeds: [embed.info({ title: "Nothing is playing." })], ephemeral: true });
        return;
      }
      const eNow = buildTrackEmbed(current, { title: `Now playing: ${current.title}` });
      await interaction.reply({ embeds: [eNow] });
    }));
}

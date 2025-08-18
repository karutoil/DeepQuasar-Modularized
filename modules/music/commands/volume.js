export default function(mod, helpers) {
  const { v2, dsl, embed } = mod;
  const { ensureRainlink } = helpers;

  return v2.createInteractionCommand()
    .setName("volume")
    .setDescription("Set player volume (0-100)")
    .addIntegerOption(opt => opt.setName("amount").setDescription("Volume 0-100").setRequired(true))
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const amt = interaction.options.getInteger("amount");
      if (isNaN(amt) || amt < 0 || amt > 100) return interaction.reply({ embeds: [embed.error({ title: "Volume must be 0-100." })], ephemeral: true });
      const rainlink = ensureRainlink();
      const player = rainlink.players.get(interaction.guild.id);
      if (!player) return interaction.reply({ embeds: [embed.info({ title: "No active player." })], ephemeral: true });
      await player.setVolume(amt);
      await interaction.reply({ embeds: [embed.success({ title: `Volume set to ${amt}` })] });
    }));
}

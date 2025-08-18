export default function(mod, helpers) {
  const { v2, dsl, embed } = mod;
  const { ensureRainlink, tryCreatePlayer } = helpers;

  return v2.createInteractionCommand()
    .setName("join")
    .setDescription("Join your voice channel")
    .onExecute(dsl.withTryCatch(async (interaction) => {
      const member = interaction.member;
      const voiceChannel = member?.voice?.channel;
      if (!voiceChannel) return interaction.reply({ embeds: [embed.error({ title: "You must be in a voice channel." })], ephemeral: true });
      const rainlink = ensureRainlink();
      try {
        await tryCreatePlayer(rainlink, { guildId: interaction.guild.id, textId: interaction.channel.id, voiceId: voiceChannel.id, shardId: 0 });
        await interaction.reply({ embeds: [embed.success({ title: "Joined voice channel." })] });
      } catch (err) {
        await interaction.reply({ embeds: [embed.error({ title: "Failed to join voice.", description: err?.message })], ephemeral: true });
      }
    }));
}

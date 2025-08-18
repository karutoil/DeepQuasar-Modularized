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
        // Try to play the next queued track without destroying the player.
        const next = player.queue?.[0] || (player.queue && player.queue.slice ? player.queue.slice(0,1)[0] : null);
        if (next) {
          try {
            await player.play(next, { replaceCurrent: true });
            await interaction.reply({ embeds: [embed.success({ title: "Skipped to next track." })] });
          } catch (err) {
            // fallback to stop if play failed
            try { player.stop(); } catch (e) { void e; }
            await interaction.reply({ embeds: [embed.error({ title: "Error skipping to next track.", description: err?.message })], ephemeral: true });
          }
        } else {
          // No next track; stop and disconnect
          try { player.queue.clear(); await player.destroy(); } catch (e) { void e; }
          await interaction.reply({ embeds: [embed.info({ title: "No more tracks; stopped and disconnected." })] });
        }
      } catch (err) { await interaction.reply({ embeds: [embed.error({ title: "Error skipping.", description: err?.message })], ephemeral: true }); }
    }));
}

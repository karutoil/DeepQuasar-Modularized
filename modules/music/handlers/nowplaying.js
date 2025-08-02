// Now Playing command handler with rich embed and optional mini-controls
export function createNowPlayingCommand(ctx, moonlink) {
  const { v2, embed, lifecycle } = ctx;
  const moduleName = "music";

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "0:00";
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  function progressBar(position, length, width = 18) {
    if (!Number.isFinite(position) || !Number.isFinite(length) || length <= 0) {
      return `[${"-".repeat(width)}]`;
    }
    const ratio = Math.max(0, Math.min(1, position / length));
    const idx = Math.min(width - 1, Math.floor(ratio * width));
    let out = "";
    for (let i = 0; i < width; i++) out += i === idx ? "🔘" : "─";
    return `[${out}]`;
  }

  const nowplayingCmd = v2.createInteractionCommand()
    .setName("nowplaying")
    .setDescription("Show the currently playing track details")
    .onExecute(async (interaction) => {
      const player = moonlink.players.get(interaction.guildId);
      if (!player || !player.playing || !player.current) {
        await interaction.reply({ embeds: [embed.info({ title: "Nothing is playing." })], ephemeral: true });
        return;
      }
      const track = player.current;
      const title = track?.title || track?.info?.title || "Unknown";
      const author = track?.author || track?.info?.author || "Unknown";
      // Moonlink v4 Track exposes .duration, Lavalink info fallback is .info.length
      const lengthRaw = track?.duration ?? track?.length ?? track?.info?.duration ?? track?.info?.length ?? 0;
      const length = Number.isFinite(Number(lengthRaw)) ? Number(lengthRaw) : 0;
      const position = Number(player?.position ?? track?.position ?? track?.info?.position ?? 0);
      const artwork = track?.thumbnail || track?.artworkUrl || track?.info?.artworkUrl || null;

      // Determine queue size from Moonlink queue
      let queueSize = 0;
      try {
        const q = player.queue;
        if (Array.isArray(q)) queueSize = q.length;
        else if (q && typeof q.length === "number") queueSize = q.length;
        else if (q && typeof q.size === "number") queueSize = q.size;
        else if (q && typeof q.toArray === "function") queueSize = q.toArray().length;
      } catch {}

      const npEmbed = embed.info({
        title: "Now Playing",
        description: `**${title}**\nby ${author}`,
        fields: [
          { name: "Progress", value: `${formatDuration(position)} ${progressBar(position, length)} ${formatDuration(length)}`, inline: false },
          { name: "Volume", value: `${player.volume ?? 0}`, inline: true },
          { name: "Loop", value: String(player.loop ?? "off"), inline: true },
          { name: "Autoplay", value: player.autoPlay ? "On" : "Off", inline: true },
          { name: "Queue Size", value: String(queueSize), inline: true },
        ]
      });

      if (artwork && typeof npEmbed.setThumbnail === "function") {
        npEmbed.setThumbnail(artwork);
      }

      await interaction.reply({ embeds: [npEmbed] });
    });

  lifecycle.addDisposable(ctx.v2.register(nowplayingCmd));
  return nowplayingCmd;
}
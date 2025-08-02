// Seek command handler: jump to a position within the current track
export function createSeekCommand(ctx, moonlink, queueManager) {
  const { v2, embed, lifecycle } = ctx;

  // Parse flexible time inputs:
  // - Plain seconds: "90"
  // - Clock formats: "mm:ss" or "hh:mm:ss"
  // - Durations with units: "30s", "5m", "2h", "1d", combined like "1h30m", "2m15s"
  //   Supported units: d (days), h (hours), m (minutes), s (seconds), ms (milliseconds)
  function parseTime(input) {
    if (!input) return null;
    const str = String(input).trim().toLowerCase();
    if (!str) return null;

    // 1) Pure integer seconds (e.g., "90")
    if (/^\d+$/.test(str)) {
      const sec = parseInt(str, 10);
      return Number.isFinite(sec) ? sec * 1000 : null;
    }

    // 2) Clock formats "mm:ss" or "hh:mm:ss"
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(str)) {
      const parts = str.split(":").map((p) => parseInt(p, 10));
      if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
      let sec = 0;
      if (parts.length === 2) {
        sec = parts[0] * 60 + parts[1];
      } else if (parts.length === 3) {
        sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
      return sec * 1000;
    }

    // 3) Unit notation like "30s", "1m", "1h", "2d", or combined "1h30m", "45m10s", "1500ms"
    const unitRegex = /(\d+)(ms|d|h|m|s)/g;
    let match;
    let totalMs = 0;
    let matchedAny = false;
    while ((match = unitRegex.exec(str)) !== null) {
      matchedAny = true;
      const value = parseInt(match[1], 10);
      const unit = match[2];
      if (!Number.isFinite(value) || value < 0) return null;
      switch (unit) {
        case "ms":
          totalMs += value;
          break;
        case "s":
          totalMs += value * 1000;
          break;
        case "m":
          totalMs += value * 60 * 1000;
          break;
        case "h":
          totalMs += value * 3600 * 1000;
          break;
        case "d":
          totalMs += value * 86400 * 1000;
          break;
        default:
          return null;
      }
    }
    if (matchedAny) return totalMs;

    return null;
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "0:00";
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  const seekCmd = v2.createInteractionCommand()
    .setName("seek")
    .setDescription("Seek to a position in the current track (e.g., 90 or 1:30)")
    .addStringOption(opt => opt.setName("position").setDescription("Position in seconds or mm:ss or hh:mm:ss").setRequired(true))
    .onExecute(async (interaction, args) => {
      const player = moonlink.players.get(interaction.guildId);
      if (!player || !player.playing || !player.current) {
        await interaction.reply({ embeds: [embed.info({ title: "Nothing is playing." })], ephemeral: true });
        return;
      }
      const posMs = parseTime(args.position);
      if (posMs === null) {
        await interaction.reply({ embeds: [embed.error({ title: "Invalid time format.", description: "Use seconds (e.g., 90) or mm:ss (e.g., 1:30) or hh:mm:ss." })], ephemeral: true });
        return;
      }
      // Prefer Moonlink v4 duration fields with fallbacks
      const current = player.current;
      const trackLen = Number(
        current?.duration ??
        current?.length ??
        current?.info?.duration ??
        current?.info?.length ??
        0
      );
      // Some streams may not expose a finite duration but are seekable; allow seek if duration unknown by skipping clamp upper bound
      if (!Number.isFinite(trackLen) && trackLen !== 0) {
        await interaction.reply({ embeds: [embed.error({ title: "Seek unavailable for this source." })], ephemeral: true });
        return;
      }
      const upperBound = Number.isFinite(trackLen) && trackLen > 0 ? Math.max(0, trackLen - 1000) : undefined;
      const clamped = typeof upperBound === "number" ? Math.max(0, Math.min(posMs, upperBound)) : Math.max(0, posMs);
      try {
        await player.seek(clamped);
        await interaction.reply({ embeds: [embed.success({ title: `Seeked to ${formatDuration(clamped)}` })], ephemeral: true });
      } catch (e) {
        await interaction.reply({ embeds: [embed.error({ title: "Seek failed.", description: String(e?.message || e) })], ephemeral: true });
      }
    });

  lifecycle.addDisposable(ctx.v2.register(seekCmd));
  return seekCmd;
}
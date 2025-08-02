// Moonlink.js and Discord event handlers (Moonlink-native only)
export function registerMusicEvents(ctx, moonlink) {
  const { embed, logger, lifecycle, client, mongo } = ctx;

  const inactivity = ctx?.modules?.music?._services?.inactivity || ctx?._services?.inactivity;

  function getChannelSafe(channelId) {
    try {
      return client?.channels?.cache?.get?.(channelId) ?? null;
    } catch {
      return null;
    }
  }

  // Apply last known settings on player create
  const onPlayerCreate = async (player) => {
    try {
      const guildId = player.guildId;
      try {
        const col = await mongo.getCollection("music_guild_settings");
        let vol = 20;
        let loopMode = "off";
        let autoplay = true;
        if (col) {
          const doc = await col.findOne({ guildId });
          if (typeof doc?.volume === "number") vol = doc.volume;
          if (typeof doc?.loop === "string") loopMode = doc.loop;
          if (typeof doc?.autoplay === "boolean") autoplay = doc.autoplay;
        }
        if (typeof player.setVolume === "function") await player.setVolume(vol);
        if (typeof player.setLoop === "function") player.setLoop(loopMode);
        if (typeof player.setAutoPlay === "function") player.setAutoPlay(Boolean(autoplay)); else player.autoPlay = Boolean(autoplay);
        logger.debug("[Music] Applied guild settings on playerCreate", { guildId, volume: vol, loop: loopMode, autoplay });
      } catch (e) {
        logger.warn("[Music] onPlayerCreate settings apply failed", { error: e?.message });
      }
      try { inactivity?.clear?.(guildId); } catch {}
    } catch (e) {
      logger.warn("[Music] onPlayerCreate error", { error: e?.message });
    }
  };
  moonlink.on("playerCreate", onPlayerCreate);
  lifecycle.addDisposable(() => moonlink.off("playerCreate", onPlayerCreate));

  // Persist volume, loop, autoplay via Moonlink events
  const onPlayerChangedVolume = async (player, _oldVol, newVol) => {
    const guildId = player.guildId;
    try {
      const col = await mongo.getCollection("music_guild_settings");
      if (col) await col.updateOne({ guildId }, { $set: { guildId, volume: newVol, updatedAt: new Date() } }, { upsert: true });
      logger.debug("[Music] Persisted volume change", { guildId, newVol });
    } catch (e) {
      logger.warn("[Music] setGuildVolume failed", { guildId, newVol, error: e?.message });
    }
  };
  moonlink.on("playerChangedVolume", onPlayerChangedVolume);
  lifecycle.addDisposable(() => moonlink.off("playerChangedVolume", onPlayerChangedVolume));

  const onPlayerChangedLoop = async (player, _oldLoop, newLoop) => {
    const guildId = player.guildId;
    try {
      const col = await mongo.getCollection("music_guild_settings");
      if (col) await col.updateOne({ guildId }, { $set: { guildId, loop: newLoop, updatedAt: new Date() } }, { upsert: true });
      logger.debug("[Music] Persisted loop change", { guildId, newLoop });
    } catch (e) {
      logger.warn("[Music] setGuildLoop failed", { guildId, newLoop, error: e?.message });
    }
  };
  moonlink.on("playerChangedLoop", onPlayerChangedLoop);
  lifecycle.addDisposable(() => moonlink.off("playerChangedLoop", onPlayerChangedLoop));

  const onPlayerAutoPlaySet = async (player, autoPlay) => {
    const guildId = player.guildId;
    try {
      const col = await mongo.getCollection("music_guild_settings");
      if (col) await col.updateOne({ guildId }, { $set: { guildId, autoplay: Boolean(autoPlay), updatedAt: new Date() } }, { upsert: true });
      logger.debug("[Music] Persisted autoplay change", { guildId, autoPlay });
    } catch (e) {
      logger.warn("[Music] setAutoplay failed", { guildId, autoPlay, error: e?.message });
    }
  };
  moonlink.on("playerAutoPlaySet", onPlayerAutoPlaySet);
  lifecycle.addDisposable(() => moonlink.off("playerAutoPlaySet", onPlayerAutoPlaySet));

  // Announce track start with rich details
  const onTrackStart = (player, track) => {
    const ch = getChannelSafe(player.textChannelId || player.textChannel);
    try { inactivity?.clear?.(player.guildId); } catch {}

    if (!ch) return;

    // Extract fields with Moonlink v4 shape first, Lavalink info fallback
    const title = track?.title || track?.info?.title || "Unknown";
    const author = track?.author || track?.info?.author || "Unknown";
    const uri = track?.uri || track?.url || track?.info?.uri || track?.info?.url || null;
    const artwork = track?.artworkUrl || track?.thumbnail || track?.info?.artworkUrl || null;
    const requester = track?.requester || track?.requesterId || player?.data?.requester || null;
    const durationMs = Number(
      (track?.duration ?? track?.length ?? track?.info?.duration ?? track?.info?.length ?? 0)
    );
    const isStream = Boolean(track?.isStream ?? track?.info?.isStream);

    // Duration formatter
    const fmt = (ms) => {
      if (!Number.isFinite(ms) || ms <= 0) return "0:00";
      const s = Math.floor(ms / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      const pad = (n) => String(n).padStart(2, "0");
      return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
    };

    const descLines = [];
    descLines.push(`🎵 ${uri ? `[${title}](${uri})` : `**${title}**`}`);
    descLines.push(`👤 ${author}`);
    if (isStream) {
      descLines.push(`⏱️ Live Stream`);
    } else {
      descLines.push(`⏱️ ${fmt(durationMs)}`);
    }
    if (requester) {
      const mention = typeof requester === "string" ? `<@${requester}>` : String(requester);
      descLines.push(`🙋 Requested by ${mention}`);
    }

    const e = embed.success({
      title: "Now Playing",
      description: descLines.join("\n"),
    });

    // Optional thumbnail/cover art
    try {
      if (artwork && typeof e.setThumbnail === "function") e.setThumbnail(artwork);
      else if (artwork && e.data) e.data.thumbnail = { url: artwork };
    } catch {}

    // Add compact fields
    try {
      const fields = [];
      if (player?.volume != null) fields.push({ name: "Volume", value: String(player.volume), inline: true });
      if (player?.loop != null) fields.push({ name: "Loop", value: String(player.loop), inline: true });
      if (typeof player?.autoPlay === "boolean") fields.push({ name: "Autoplay", value: player.autoPlay ? "On" : "Off", inline: true });
      if (fields.length) {
        if (typeof e.addFields === "function") e.addFields(fields);
        else if (e.data) e.data.fields = (e.data.fields || []).concat(fields);
      }
    } catch {}

    ch.send({ embeds: [e] }).catch(() => {});
  };
  moonlink.on("trackStart", onTrackStart);
  lifecycle.addDisposable(() => moonlink.off("trackStart", onTrackStart));

  // Handle track end and queue end using Moonlink semantics
  const endFlow = (player) => {
    try {
      const q = player?.queue;
      const hasNext =
        (Array.isArray(q) && q.length > 0) ||
        (q && typeof q.length === "number" && q.length > 0) ||
        (q && typeof q.size === "number" && q.size > 0);
      if (!player?.autoPlay && !hasNext) {
        const ch = getChannelSafe(player.textChannelId || player.textChannel);
        try { player.destroy(); } catch {}
        if (ch) ch.send({ embeds: [embed.info({ title: "Queue ended. Playback stopped." })] }).catch(() => {});
      }
    } catch (e) {
      logger.warn("[Music] endFlow error", { error: e?.message });
    }
  };

  const onTrackEnd = (player, _track) => {
    if (player?.autoPlay) return; // let Moonlink continue
    endFlow(player);
  };
  moonlink.on("trackEnd", onTrackEnd);
  lifecycle.addDisposable(() => moonlink.off("trackEnd", onTrackEnd));

  const onQueueEnd = (player) => {
    if (player?.autoPlay) return;
    endFlow(player);
  };
  moonlink.on("queueEnd", onQueueEnd);
  lifecycle.addDisposable(() => moonlink.off("queueEnd", onQueueEnd));

  // Player errors
  const onError = (player, error) => {
    logger.error(`[Music] Player error: ${error}`);
    const ch = getChannelSafe(player?.textChannelId || player?.textChannel);
    if (ch) ch.send({ embeds: [embed.error({ title: "Playback error.", description: String(error) })] }).catch(() => {});
  };
  moonlink.on("error", onError);
  lifecycle.addDisposable(() => moonlink.off("error", onError));

  // Node auto-resume notice to channels is handled in moonlinkClient; keep minimal logs here if needed
}

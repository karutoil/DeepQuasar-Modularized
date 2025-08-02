// Play command handler (refactored: MusicSettings, guards, TrackFactory; success public, errors ephemeral)
import { createMusicSettings } from "../services/musicSettings.js";
import { normalizeTracks } from "../utils/trackFactory.js";
import { ensureInVoice, ensurePlayerReady, replyOrEdit } from "../utils/guards.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ComponentType,
} from "discord.js";

// Simple per-user search session cache (5 minutes)
const SEARCH_TTL_MS = 5 * 60 * 1000;
const searchSessions = new Map(); // userId -> { source, query, tracks, page, pageSize, updatedAt }
function getSession(userId) {
  const s = searchSessions.get(userId);
  if (!s) return null;
  if (Date.now() - s.updatedAt > SEARCH_TTL_MS) {
    searchSessions.delete(userId);
    return null;
  }
  return s;
}
function setSession(userId, data) {
  searchSessions.set(userId, { ...(getSession(userId) || {}), ...data, updatedAt: Date.now() });
}

function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "0:00";
  const s = Math.floor(n / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (x) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function createPlayCommand(ctx, moonlink) {
  const { v2, embed, lifecycle, logger } = ctx;
  const moduleName = "music";
  const settings = createMusicSettings(ctx);

  const playCmd = v2.createInteractionCommand()
    .setName("play")
    .setDescription("Play a track or add to queue")
    .addStringOption(opt => opt.setName("query").setDescription("Song name or URL").setRequired(true))
    .onExecute(async (interaction, args) => {
      const guildId = interaction.guildId;
      let query = args.query || interaction.options?.getString?.("query");

      if (!query || typeof query !== "string" || !query.trim()) {
        await replyOrEdit(interaction, { embeds: [embed.error({ title: "You must provide a song name or URL." })] }, { ephemeral: true });
        return;
      }

      try {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ ephemeral: false });
        }
      } catch {}

      const voiceCheck = await ensureInVoice(ctx, interaction, { ephemeral: true });
      if (!voiceCheck.ok) return;
      const ok = await ensurePlayerReady(ctx, moonlink, interaction, { ephemeral: true });
      if (!ok) return;

      let textChannelId = interaction.channelId;
      let textChannelObj = null;
      if (interaction.guild && textChannelId) {
        try { textChannelObj = await interaction.guild.channels.fetch(textChannelId); } catch (err) { logger.warn("Could not fetch text channel for play", { error: err, textChannelId }); }
      }
      const isTextCapable = Boolean(textChannelObj?.isTextBased?.());
      if (!isTextCapable) {
        await replyOrEdit(interaction, { embeds: [embed.error({ title: "Use this command in a text-capable channel or the chat tab of a voice channel." })] }, { ephemeral: true });
        return;
      }
      textChannelId = textChannelObj.id;

      // Search tracks
      let res;
      try {
        res = await moonlink.search({ query, requester: interaction.user?.id });
      } catch (e) {
        await replyOrEdit(interaction, { embeds: [embed.error({ title: "Search failed.", description: String(e?.message || e) })] }, { ephemeral: true });
        return;
      }
      const tracksArr = Array.isArray(res?.tracks) ? res.tracks : [];
      if (tracksArr.length === 0) {
        await replyOrEdit(interaction, { embeds: [embed.error({ title: "No results found." })] }, { ephemeral: true });
        return;
      }
      const loadType = String(res?.loadType || res?.type || "").toLowerCase();
      const isPlaylist = loadType === "playlist" || Boolean(res?.playlist) || Boolean(res?.playlistInfo);

      let desiredVolume = await settings.getVolume(guildId).catch(() => 20);
      let autoplayOn = await settings.getAutoplay(guildId).catch(() => true);
      if (!Number.isFinite(desiredVolume)) desiredVolume = 20;

      let player = moonlink.players.get(guildId);
      if (!player) {
        player = moonlink.players.create({
          guildId,
          voiceChannelId: String(voiceCheck.voiceChannelId),
          textChannelId: String(textChannelId),
          volume: desiredVolume
        });
      }
      try {
        if (typeof player.connect === "function") await player.connect();
        else if (typeof player.updateVoiceState === "function") await player.updateVoiceState({ voiceChannelId: String(voiceCheck.voiceChannelId) });
        else if (typeof player.join === "function") await player.join();
      } catch (e) {
        logger.warn("[/play] connect/join failed", { error: e?.message });
      }
      try { if (typeof player.setVolume === "function") await player.setVolume(desiredVolume); } catch {}
      try {
        if (typeof player.setAutoPlay === "function") player.setAutoPlay(Boolean(autoplayOn));
        else player.autoPlay = Boolean(autoplayOn);
      } catch {}

      if (isPlaylist) {
        try { player.queue?.add?.(tracksArr); } catch {}
        if (!player.playing) {
          try { await player.play(); } catch {}
        }
        const playlistName = res?.playlistInfo?.name || res?.playlist?.title || "Playlist";
        const count = tracksArr.length;
        await interaction.editReply({
          embeds: [embed.success({ title: "Playlist queued", description: `Enqueued ${count} tracks from ${playlistName}.` })]
        });
      } else {
        const track = tracksArr[0];
        try { player.queue?.add?.(track); } catch {}
        if (!player.playing) {
          try { await player.play(); } catch {}
          await interaction.editReply({ embeds: [embed.success({ title: "Starting playback..." })] });
        } else {
          await interaction.editReply({ embeds: [embed.info({ title: `Added to queue: ${track?.title || "Track"}` })] });
        }
      }
    });

  // Support both core context and direct context
  const registrar = typeof ctx.createModuleContext === "function" ? ctx.createModuleContext(moduleName).v2 : v2;
  lifecycle.addDisposable(registrar.register(playCmd));
  return playCmd;
}

// New: /search command with pagination and selection to enqueue
export function createSearchCommand(ctx, moonlink) {
  const { v2, embed, lifecycle, logger } = ctx;
  const moduleName = "music";

  function pageComponents(userId, page, pageSize, tracks) {
    const total = tracks.length;
    const start = page * pageSize;
    const end = Math.min(total, start + pageSize);
    const slice = tracks.slice(start, end);

    const options = slice.map((t, i) => {
      const idx = start + i;
      const title = t?.title || t?.info?.title || "Unknown";
      const author = t?.author || t?.info?.author || "Unknown";
      const dur = t?.duration ?? t?.length ?? t?.info?.duration ?? t?.info?.length ?? 0;
      return {
        label: `#${idx + 1} · ${title}`.slice(0, 100),
        description: `${author} [${formatDuration(dur)}]`.slice(0, 100),
        value: String(idx)
      };
    });

    const select = new StringSelectMenuBuilder()
      .setCustomId(`q_select:${userId}`)
      .setPlaceholder("Select up to 10 tracks to add")
      .setMinValues(1)
      .setMaxValues(Math.min(10, options.length))
      .addOptions(options);

    const prev = new ButtonBuilder()
      .setCustomId(`q_prev:${userId}`)
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0);

    const next = new ButtonBuilder()
      .setCustomId(`q_next:${userId}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(end >= total);

    const add = new ButtonBuilder()
      .setCustomId(`q_add:${userId}`)
      .setLabel("Add Selected")
      .setStyle(ButtonStyle.Success);

    const cancel = new ButtonBuilder()
      .setCustomId(`q_cancel:${userId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger);

    return [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(prev, next, add, cancel)
    ];
  }

  const searchCmd = v2.createInteractionCommand()
    .setName("search")
    .setDescription("Search for tracks from a specific source")
    .addStringOption(opt =>
      opt.setName("source")
        .setDescription("Source to search")
        .setRequired(true)
        .addChoices(
          { name: "YouTube", value: "youtube" },
          { name: "YouTube Music", value: "youtubemusic" },
          { name: "SoundCloud", value: "soundcloud" },
          { name: "Spotify", value: "spotify" },
          { name: "Deezer", value: "deezer" },
          { name: "Apple Music", value: "applemusic" }
        )
    )
    .addStringOption(opt =>
      opt.setName("query")
        .setDescription("Search query")
        .setRequired(true)
    )
    .onExecute(async (interaction, args) => {
      const src = String(args.source || "").toLowerCase();
      const q = String(args.query || "").trim();
      const userId = interaction.user?.id;
      if (!q) {
        await interaction.reply({ embeds: [embed.error({ title: "Provide a search query." })], ephemeral: true });
        return;
      }

      try { await interaction.deferReply({ ephemeral: true }); } catch {}

      // Search with source hint then fallback
      let result;
      try {
        result = await moonlink.search({ query: q, source: src, requester: userId });
      } catch (e) {
        try { result = await moonlink.search({ query: q, requester: userId }); } catch (err) {
          await interaction.editReply({ embeds: [embed.error({ title: "Search failed.", description: String(err?.message || err) })] });
          return;
        }
      }
      let tracks = Array.isArray(result?.tracks) ? result.tracks : [];
      if (!tracks.length) {
        try { const fb = await moonlink.search({ query: q, requester: userId }); tracks = Array.isArray(fb?.tracks) ? fb.tracks : []; } catch {}
      }
      if (!tracks.length) {
        await interaction.editReply({ embeds: [embed.info({ title: "No results found for that source/query." })] });
        return;
      }

      // Save session
      const pageSize = 10;
      setSession(userId, { source: src, query: q, tracks, page: 0, pageSize });

      const render = (page) => {
        const total = tracks.length;
        const start = page * pageSize;
        const end = Math.min(total, start + pageSize);
        const lines = tracks.slice(start, end).map((t, i) => {
          const idx = start + i + 1;
          const title = t?.title || t?.info?.title || "Unknown";
          const author = t?.author || t?.info?.author || "Unknown";
          const dur = t?.duration ?? t?.length ?? t?.info?.duration ?? t?.info?.length ?? 0;
          const uri = t?.uri || t?.url || t?.info?.uri || t?.info?.url || null;
          return `${idx}. ${uri ? `[${title}](${uri})` : `**${title}**`} — ${author} [${formatDuration(dur)}]`;
        });
        const e = embed.base(undefined, {
          title: `Search Results — ${src}`,
          description: lines.join("\n")
        });
        const components = pageComponents(userId, page, pageSize, tracks);
        return { embeds: [e], components };
      };

      await interaction.editReply(render(0));
      const msg = await interaction.fetchReply().catch(() => null);
      if (!msg?.id) return;

      const collector = msg.createMessageComponentCollector({ time: SEARCH_TTL_MS });
      let selectedIndices = [];

      collector.on("collect", async (i) => {
        if (i.user?.id !== userId) {
          try { await i.reply({ content: "Only the invoker can use this.", ephemeral: true }); } catch {}
          return;
        }
        const sess = getSession(userId);
        if (!sess) { try { await i.update({ components: [] }); } catch {} return; }
        const { pageSize } = sess;
        let { page, tracks } = sess;

        if (i.customId === `q_prev:${userId}`) {
          page = Math.max(0, page - 1);
          setSession(userId, { page });
          try { await i.update(render(page)); } catch {}
          return;
        }
        if (i.customId === `q_next:${userId}`) {
          const maxPage = Math.max(0, Math.ceil(tracks.length / pageSize) - 1);
          page = Math.min(maxPage, page + 1);
          setSession(userId, { page });
          try { await i.update(render(page)); } catch {}
          return;
        }
        if (i.customId === `q_select:${userId}` && i.componentType === ComponentType.StringSelect) {
          selectedIndices = (i.values || []).map(v => Number(v)).filter(n => Number.isFinite(n));
          try { await i.deferUpdate(); } catch {}
          return;
        }
        if (i.customId === `q_add:${userId}`) {
          // Enqueue selected tracks, honoring saved guild volume/autoplay
          const voiceCheck = await ensureInVoice(ctx, interaction, { ephemeral: true });
          if (!voiceCheck.ok) { try { await i.reply({ content: "Join a voice channel first.", ephemeral: true }); } catch {} return; }
          const ok = await ensurePlayerReady(ctx, moonlink, interaction, { ephemeral: true });
          if (!ok) { try { await i.reply({ content: "Audio backend not ready.", ephemeral: true }); } catch {} return; }
 
          const guildId = interaction.guildId;
          let player = moonlink.players.get(guildId);
 
          // Fetch saved settings
          const settings = createMusicSettings(ctx);
          let desiredVolume = 20;
          let autoplayOn = true;
          try {
            desiredVolume = await settings.getVolume(guildId).catch(() => 20);
            autoplayOn = await settings.getAutoplay(guildId).catch(() => true);
            if (!Number.isFinite(desiredVolume)) desiredVolume = 20;
          } catch {}
 
          if (!player) {
            player = moonlink.players.create({
              guildId,
              voiceChannelId: String(voiceCheck.voiceChannelId),
              textChannelId: String(interaction.channelId),
              volume: desiredVolume
            });
            try { await player.connect?.(); } catch {}
            try { await player.setVolume?.(desiredVolume); } catch {}
            try {
              if (typeof player.setAutoPlay === "function") player.setAutoPlay(Boolean(autoplayOn));
              else player.autoPlay = Boolean(autoplayOn);
            } catch {}
          } else {
            // Align existing player to saved settings
            try {
              const currentVol = Number(player.volume);
              if (Number.isFinite(desiredVolume) && desiredVolume !== currentVol) {
                await player.setVolume(desiredVolume);
              }
            } catch {}
            try {
              if (typeof player.setAutoPlay === "function") player.setAutoPlay(Boolean(autoplayOn));
              else player.autoPlay = Boolean(autoplayOn);
            } catch {}
          }
 
          const items = selectedIndices.map(idx => tracks[idx]).filter(Boolean);
          if (!items.length) {
            try { await i.reply({ content: "No tracks selected.", ephemeral: true }); } catch {}
            return;
          }
          try { player.queue?.add?.(items); } catch {}
          try { if (!player.playing) await player.play(); } catch {}
          const preview = items.slice(0, 3).map(t => t?.title || t?.info?.title || "Track").join(", ");
          try { await i.reply({ content: `Queued ${items.length} track(s): ${preview}${items.length > 3 ? " ..." : ""}`, ephemeral: true }); } catch {}
          return;
        }
        if (i.customId === `q_cancel:${userId}`) {
          searchSessions.delete(userId);
          try { await i.update({ components: [] }); } catch {}
          return;
        }
      });

      collector.on("end", async () => {
        // keep session in cache for potential reuse via new /search, but disable UI
        try { await msg.edit({ components: [] }); } catch {}
      });
    });

  const registrar = typeof ctx.createModuleContext === "function" ? ctx.createModuleContext(moduleName).v2 : v2;
  lifecycle.addDisposable(registrar.register(searchCmd));
  return searchCmd;
}

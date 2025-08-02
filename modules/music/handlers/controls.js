// Controls command handlers: pause, resume, stop, skip, volume, shuffle, clear, loop, autoplay (Moonlink-native)
import { createMusicSettings } from "../services/musicSettings.js";
import { ensureInVoice, ensurePlayerReady, replyOrEdit, ensureDjOrSelf } from "../utils/guards.js";

export function createControlCommands(ctx, moonlink) {
  const { v2, embed, lifecycle } = ctx;
  const moduleName = "music";
  const settings = createMusicSettings(ctx);
  const toggleDebounce = new Map(); // guildId -> number (timeout id)
  function debounceToggle(guildId, ms = 600) {
    if (toggleDebounce.has(guildId)) return false;
    const t = setTimeout(() => { try { toggleDebounce.delete(guildId); } catch {} }, ms);
    toggleDebounce.set(guildId, t);
    return true;
  }

  const pauseCmd = v2.createInteractionCommand()
    .setName("pause")
    .setDescription("Pause playback")
    .onExecute(async (interaction) => {
      const okReady = await ensurePlayerReady(ctx, moonlink, interaction, { ephemeral: true });
      if (!okReady) return;
      const guildId = interaction.guildId;
      if (!debounceToggle(guildId)) {
        await replyOrEdit(interaction, { embeds: [embed.warn({ title: "Please wait a moment before toggling pause again." })] }, { ephemeral: true });
        return;
      }
      const player = moonlink.players.get(guildId);
      if (!player || !player.playing || player.paused === true) {
        await replyOrEdit(interaction, { embeds: [embed.info({ title: "Nothing is playing or already paused." })] }, { ephemeral: true });
        return;
      }
      try {
        await player.pause(true);
        await replyOrEdit(interaction, { embeds: [embed.success({ title: "Playback paused." })] }, { ephemeral: true });
      } catch (e) {
        await replyOrEdit(interaction, { embeds: [embed.error({ title: "Failed to pause.", description: String(e?.message || e) })] }, { ephemeral: true });
      }
    });

  const resumeCmd = v2.createInteractionCommand()
    .setName("resume")
    .setDescription("Resume playback")
    .onExecute(async (interaction) => {
      const okReady = await ensurePlayerReady(ctx, moonlink, interaction, { ephemeral: true });
      if (!okReady) return;
      const guildId = interaction.guildId;
      if (!debounceToggle(guildId)) {
        await replyOrEdit(interaction, { embeds: [embed.warn({ title: "Please wait a moment before toggling resume again." })] }, { ephemeral: true });
        return;
      }
      const player = moonlink.players.get(guildId);
      if (!player) {
        await replyOrEdit(interaction, { embeds: [embed.info({ title: "No active player." })] }, { ephemeral: true });
        return;
      }
      if (player.paused !== true) {
        await replyOrEdit(interaction, { embeds: [embed.info({ title: "Playback is not paused." })] }, { ephemeral: true });
        return;
      }
      try {
        if (typeof player.resume === "function") {
          await player.resume();
        } else {
          await player.pause(false);
        }
        await replyOrEdit(interaction, { embeds: [embed.success({ title: "Playback resumed." })] }, { ephemeral: true });
      } catch (e) {
        await replyOrEdit(interaction, { embeds: [embed.error({ title: "Failed to resume.", description: String(e?.message || e) })] }, { ephemeral: true });
      }
    });

  const stopCmd = v2.createInteractionCommand()
    .setName("stop")
    .setDescription("Stop playback and clear queue")
    .onExecute(async (interaction) => {
      const okReady = await ensurePlayerReady(ctx, moonlink, interaction, { ephemeral: true });
      if (!okReady) return;
      const voice = await ensureInVoice(ctx, interaction, { ephemeral: true });
      if (!voice.ok) return;
      const allow = await ensureDjOrSelf(ctx, interaction, settings, { requesterId: null, ephemeral: true });
      if (!allow) return;

      const guildId = interaction.guildId;
      const player = moonlink.players.get(guildId);
      if (player) {
        try {
          if (player.queue?.clear) player.queue.clear();
          else if (Array.isArray(player.queue)) player.queue.length = 0;
        } catch {}
        try { await player.destroy(); } catch {}
      }
      await replyOrEdit(interaction, { embeds: [embed.success({ title: "Playback stopped and queue cleared." })] }, { ephemeral: true });
    });

  const skipCmd = v2.createInteractionCommand()
    .setName("skip")
    .setDescription("Skip current track")
    .onExecute(async (interaction) => {
      const okReady = await ensurePlayerReady(ctx, moonlink, interaction, { ephemeral: true });
      if (!okReady) return;
      const player = moonlink.players.get(interaction.guildId);
      if (!player || !player.playing) {
        await replyOrEdit(interaction, { embeds: [embed.info({ title: "Nothing is playing." })] }, { ephemeral: true });
        return;
      }
      try {
        if (typeof player.skip === "function") {
          await player.skip();
        } else if (typeof player.stop === "function") {
          await player.stop();
        } else if (player.queue && typeof player.play === "function") {
          await player.play();
        }
        await replyOrEdit(interaction, { embeds: [embed.success({ title: "Skipped current track." })] }, { ephemeral: true });
      } catch (e) {
        await replyOrEdit(interaction, { embeds: [embed.error({ title: "Skip failed.", description: String(e?.message || e) })] }, { ephemeral: true });
      }
    });

  const volumeCmd = v2.createInteractionCommand()
    .setName("volume")
    .setDescription("Set playback volume")
    .addIntegerOption(opt => opt.setName("level").setDescription("Volume (1-100)").setRequired(true))
    .onExecute(async (interaction, args) => {
      const okReady = await ensurePlayerReady(ctx, moonlink, interaction, { ephemeral: true });
      if (!okReady) return;
      const player = moonlink.players.get(interaction.guildId);
      if (!player) {
        await replyOrEdit(interaction, { embeds: [embed.info({ title: "Nothing is playing." })] }, { ephemeral: true });
        return;
      }
      const level = Math.max(1, Math.min(100, Number(args.level)));
      try { await player.setVolume(level); } catch {}
      // Persistence is handled by playerChangedVolume event; settings setVolume used as default seed
      try { await settings.setVolume(interaction.guildId, level); } catch {}
      await replyOrEdit(interaction, { embeds: [embed.success({ title: `Volume set to ${level}` })] }, { ephemeral: true });
    });

  const shuffleCmd = v2.createInteractionCommand()
    .setName("shuffle")
    .setDescription("Shuffle the queue")
    .onExecute(async (interaction) => {
      const okReady = await ensurePlayerReady(ctx, moonlink, interaction, { ephemeral: true });
      if (!okReady) return;
      const player = moonlink.players.get(interaction.guildId);
      if (!player) {
        await replyOrEdit(interaction, { embeds: [embed.info({ title: "No active player." })] }, { ephemeral: true });
        return;
      }
      try {
        if (typeof player.shuffle === "function") {
          player.shuffle();
        } else if (player.queue) {
          const q = player.queue;
          const list = Array.isArray(q) ? q : (typeof q.toArray === "function" ? q.toArray() : []);
          if (list.length > 1) {
            for (let i = list.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [list[i], list[j]] = [list[j], list[i]];
            }
            if (typeof q.clear === "function") q.clear();
            if (typeof q.add === "function") q.add(list);
          }
        }
        await replyOrEdit(interaction, { embeds: [embed.success({ title: "Queue shuffled." })] }, { ephemeral: true });
      } catch (e) {
        await replyOrEdit(interaction, { embeds: [embed.error({ title: "Shuffle failed.", description: String(e?.message || e) })] }, { ephemeral: true });
      }
    });

  const clearCmd = v2.createInteractionCommand()
    .setName("clear")
    .setDescription("Clear the queue")
    .onExecute(async (interaction) => {
      const allow = await ensureDjOrSelf(ctx, interaction, settings, { requesterId: null, ephemeral: true });
      if (!allow) return;
      const okReady = await ensurePlayerReady(ctx, moonlink, interaction, { ephemeral: true });
      if (!okReady) return;
      const player = moonlink.players.get(interaction.guildId);
      if (!player) {
        await replyOrEdit(interaction, { embeds: [embed.info({ title: "No active player." })] }, { ephemeral: true });
        return;
      }
      try {
        if (player.queue && typeof player.queue.clear === "function") {
          player.queue.clear();
        } else if (Array.isArray(player.queue)) {
          player.queue.length = 0;
        }
        await replyOrEdit(interaction, { embeds: [embed.success({ title: "Queue cleared." })] }, { ephemeral: true });
      } catch (e) {
        await replyOrEdit(interaction, { embeds: [embed.error({ title: "Clear failed.", description: String(e?.message || e) })] }, { ephemeral: true });
      }
    });

  const loopCmd = v2.createInteractionCommand()
    .setName("loop")
    .setDescription("Set loop mode")
    .addStringOption(opt => opt.setName("mode").setDescription("off | track | queue").setRequired(true).addChoices(
      { name: "off", value: "off" },
      { name: "track", value: "track" },
      { name: "queue", value: "queue" }
    ))
    .addIntegerOption(opt => opt.setName("count").setDescription("Loop count (0 = infinite for queue)").setRequired(false))
    .onExecute(async (interaction, args) => {
      const okReady = await ensurePlayerReady(ctx, moonlink, interaction, { ephemeral: true });
      if (!okReady) return;
      const player = moonlink.players.get(interaction.guildId);
      if (!player) {
        await replyOrEdit(interaction, { embeds: [embed.info({ title: "No active player." })] }, { ephemeral: true });
        return;
      }
      const mode = String(args.mode);
      const count = typeof args.count === "number" ? args.count : undefined;
      try {
        if (typeof player.setLoop === "function") {
          player.setLoop(mode, count);
          // Persistence handled by playerChangedLoop event; also seed defaults
          try { await settings.setLoop(interaction.guildId, mode); } catch {}
          await replyOrEdit(interaction, { embeds: [embed.success({ title: `Loop set to ${mode}${typeof count === "number" ? ` (count: ${count})` : ""}` })] }, { ephemeral: true });
        } else {
          await replyOrEdit(interaction, { embeds: [embed.error({ title: "Loop not supported by player." })] }, { ephemeral: true });
        }
      } catch (e) {
        await replyOrEdit(interaction, { embeds: [embed.error({ title: "Failed to set loop.", description: String(e?.message || e) })] }, { ephemeral: true });
      }
    });

  const autoplayCmd = v2.createInteractionCommand()
    .setName("autoplay")
    .setDescription("Toggle autoplay (on/off)")
    .addStringOption(opt => opt.setName("state").setDescription("on | off").setRequired(true).addChoices(
      { name: "on", value: "on" },
      { name: "off", value: "off" }
    ))
    .onExecute(async (interaction, args) => {
      const okReady = await ensurePlayerReady(ctx, moonlink, interaction, { ephemeral: true });
      if (!okReady) return;
      const player = moonlink.players.get(interaction.guildId);
      const wantOn = String(args.state) === "on";
      if (!player) {
        await replyOrEdit(interaction, { embeds: [embed.info({ title: "No active player." })] }, { ephemeral: true });
        return;
      }
      try {
        if (typeof player.setAutoPlay === "function") player.setAutoPlay(wantOn);
        else player.autoPlay = wantOn;
        // Persistence handled by playerAutoPlaySet event; also seed defaults
        try { await settings.setAutoplay(interaction.guildId, wantOn); } catch {}
        await replyOrEdit(interaction, { embeds: [embed.success({ title: `Autoplay ${wantOn ? "enabled" : "disabled"}.` })] }, { ephemeral: true });
      } catch (e) {
        await replyOrEdit(interaction, { embeds: [embed.error({ title: "Failed to set autoplay.", description: String(e?.message || e) })] }, { ephemeral: true });
      }
    });

  const registrar = typeof ctx.createModuleContext === "function" ? ctx.createModuleContext(moduleName).v2 : v2;
  lifecycle.addDisposable(registrar.register(pauseCmd));
  lifecycle.addDisposable(registrar.register(resumeCmd));
  lifecycle.addDisposable(registrar.register(stopCmd));
  lifecycle.addDisposable(registrar.register(skipCmd));
  lifecycle.addDisposable(registrar.register(volumeCmd));
  lifecycle.addDisposable(registrar.register(shuffleCmd));
  lifecycle.addDisposable(registrar.register(clearCmd));
  lifecycle.addDisposable(registrar.register(loopCmd));
  lifecycle.addDisposable(registrar.register(autoplayCmd));

  return [pauseCmd, resumeCmd, stopCmd, skipCmd, volumeCmd, shuffleCmd, clearCmd, loopCmd, autoplayCmd];
}

// Queue command handler (Moonlink-native): base list plus subcommands queue-remove and queue-move
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function toArrayQueue(q) {
  try {
    if (!q) return [];
    // Common Moonlink queue shapes: Array-like, Map-like (.tracks), or an object with .length/.toArray
    if (Array.isArray(q)) return [...q];
    if (q && Array.isArray(q.tracks)) return [...q.tracks];
    if (typeof q.length === "number") {
      const out = [];
      for (let i = 0; i < q.length; i++) {
        const t = q[i] ?? q.at?.(i);
        if (t) out.push(t);
      }
      return out;
    }
    if (typeof q.toArray === "function") return q.toArray();
    // Best-effort spread for iterable queues
    try { return [...q]; } catch {}
    return [];
  } catch { return []; }
}

export function createQueueCommand(ctx) {
  const { v2, embed, lifecycle } = ctx;
  const moduleName = "music";
 
  // Robust player accessor to survive hot reloads:
  // Prefer the passed-in moonlink if available; fallback to ctx.moonlink; last resort: resolved from ctx if stored elsewhere.
  const getPlayer = (guildId) => {
    try {
      const ml = (typeof moonlink !== "undefined" && moonlink) || ctx?.moonlink;
      return ml?.players?.get?.(guildId) || null;
    } catch {
      return null;
    }
  };

  function getDurationMs(track) {
    // Moonlink v4 Track has .duration; Lavalink info fallback is .info.length
    const d =
      track?.duration ??
      track?.length ??
      track?.info?.duration ??
      track?.info?.length ??
      0;
    const n = Number(d);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function renderPage(allItems, page, pageSize) {
    const total = allItems.length;
    const start = page * pageSize;
    const end = Math.min(total, start + pageSize);
    const slice = allItems.slice(start, end);
    const lines = slice.map((t, idx) => {
      const i = start + idx + 1;
      const title = t?.title || t?.info?.title || "Unknown";
      const author = t?.author || t?.info?.author || "Unknown";
      const len = getDurationMs(t);
      const who = t?.requesterId || t?.requester
        ? ` • by <@${t.requesterId || t.requester}>`
        : "";
      return `${i}. ${title} — ${author} [${formatDuration(len)}]${who}`;
    });
    const e = embed.base(undefined, {
      title: "Current Queue",
      description: lines.join("\n") || "Empty page"
    });
    return {
      embeds: [e],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("q_prev").setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
          new ButtonBuilder().setCustomId("q_next").setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(end >= total)
        )
      ],
      flags: 64
    };
  }

  // Base /queue shows the list with pagination
  const queueCmd = v2.createInteractionCommand()
    .setName("queue")
    .setDescription("Show current music queue")
    .onExecute(async (interaction) => {
      const guildId = interaction.guildId;
      const player = getPlayer(guildId);
      if (!player) {
        // Fallback: if manager is connected but player map changed after hot reload, attempt to reconstruct a snapshot view
        try {
          const ml = (typeof moonlink !== "undefined" && moonlink) || ctx?.moonlink;
          const anyPlayers = ml?.players?.all || [];
          if (Array.isArray(anyPlayers) && anyPlayers.length > 0) {
            // Try to find by guildId on array shape if available
            const guess = anyPlayers.find(p => p?.guildId === guildId);
            if (guess) {
              await interaction.reply({ embeds: [embed.info({ title: "Queue restoring", description: "Player context is being restored; try again in a moment." })], flags: 64 });
              return;
            }
          }
        } catch {}
        await interaction.reply({ embeds: [embed.info({ title: "Nothing is playing." })], flags: 64 });
        return;
      }

      // Defensive refresh: some Moonlink builds expose current on player.current or player.queue.current
      let currentTrack = player.current;
      try {
        if (!currentTrack && player.queue && player.queue.current) currentTrack = player.queue.current;
      } catch {}
 
      // If hot reload happened, playing flag may be stale briefly; rely on presence of current or pending queue
      const current = currentTrack ? [currentTrack] : [];
      const rest = toArrayQueue(player.queue);
      const items = [...current, ...rest];
 
      if (!items.length) {
        // If manager is not fully ready, avoid false "nothing is playing"
        try {
          const ml = (typeof moonlink !== "undefined" && moonlink) || ctx?.moonlink;
          const ready = ml?.__isReady || (Array.isArray(ml?.nodes) && ml.nodes.some(n => n?.connected));
          if (!ready) {
            await interaction.reply({ embeds: [embed.info({ title: "Audio backend starting", description: "Queue data is loading, try again in a moment." })], flags: 64 });
            return;
          }
        } catch {}
        if (rest.length > 0) {
          await interaction.reply({ embeds: [embed.info({ title: "Queue pending", description: "Tracks are queued and will start soon." })], flags: 64 });
        } else {
          await interaction.reply({ embeds: [embed.info({ title: "Queue is empty." })], flags: 64 });
        }
        return;
      }
      let page = 0;
      const pageSize = 10;
      const footer = `Tips: use /queue-remove index and /queue-move from to to manage the queue`;
      const first = renderPage(items, page, pageSize);
      // Add a footer hint to the embed
      try {
        const emb = first.embeds?.[0];
        if (emb && typeof emb.setFooter === "function") {
          emb.setFooter({ text: footer });
        } else if (first.embeds?.[0]?.data) {
          first.embeds[0].data.footer = { text: footer };
        }
      } catch {}
      await interaction.reply(first);

      const msg = await interaction.fetchReply().catch(() => null);
      if (!msg?.id) return;
      const collector = msg.createMessageComponentCollector?.({ time: 60_000 });
      collector?.on("collect", async (i) => {
        if (i.user?.id !== interaction.user?.id) {
          try { await i.reply({ content: "You cannot control this pagination.", ephemeral: true }); } catch {}
          return;
        }
        if (i.customId === "q_prev") page = Math.max(0, page - 1);
        if (i.customId === "q_next") page = Math.min(Math.ceil(items.length / pageSize) - 1, page + 1);
        try { await i.update(renderPage(items, page, pageSize)); } catch {}
      });
      collector?.on("end", async () => {
        try { await msg.edit({ components: [] }); } catch {}
      });
    });

  // /queue-remove index: remove track at position (1 = current)
  const removeCmd = v2.createInteractionCommand()
    .setName("queue-remove")
    .setDescription("Remove an item from the queue by index (1 = current track)")
    .addIntegerOption(o => o.setName("index").setDescription("1-based index in the combined list").setRequired(true))
    .onExecute(async (interaction, args) => {
      const guildId = interaction.guildId;
      const player = getPlayer(guildId);
      if (!player) {
        await interaction.reply({ embeds: [embed.info({ title: "No active player." })], flags: 64 });
        return;
      }
      const idx1 = Number(args.index);
      if (!Number.isFinite(idx1) || idx1 <= 0) {
        await interaction.reply({ embeds: [embed.error({ title: "Invalid index." })], flags: 64 });
        return;
      }

      if (idx1 === 1) {
        try {
          if (typeof player.stop === "function") await player.stop();
          else if (typeof player.skip === "function") await player.skip();
          else if (typeof player.play === "function") await player.play();
          await interaction.reply({ embeds: [embed.success({ title: "Removed current track." })], flags: 64 });
        } catch (e) {
          await interaction.reply({ embeds: [embed.error({ title: "Failed to remove current track.", description: String(e?.message || e) })], flags: 64 });
        }
        return;
      }

      const q = player.queue;
      const list = toArrayQueue(q);
      const qIndex = idx1 - 2; // queue starts at position 2
      if (qIndex < 0 || qIndex >= list.length) {
        await interaction.reply({ embeds: [embed.warn({ title: "Index out of range." })], flags: 64 });
        return;
      }
      try {
        if (typeof q.remove === "function") {
          q.remove(qIndex);
        } else if (typeof q.splice === "function") {
          q.splice(qIndex, 1);
        } else if (typeof q.removeRange === "function") {
          q.removeRange(qIndex, qIndex);
        } else {
          list.splice(qIndex, 1);
          if (typeof q.clear === "function") q.clear();
          if (typeof q.add === "function") q.add(list);
        }
        await interaction.reply({ embeds: [embed.success({ title: `Removed item #${idx1}` })], flags: 64 });
      } catch (e) {
        await interaction.reply({ embeds: [embed.error({ title: "Remove failed.", description: String(e?.message || e) })], flags: 64 });
      }
    });

  // /queue-move from to: move an item (1 may represent current)
  const moveCmd = v2.createInteractionCommand()
    .setName("queue-move")
    .setDescription("Move an item in the queue (1 = current track)")
    .addIntegerOption(o => o.setName("from").setDescription("1-based index to move from").setRequired(true))
    .addIntegerOption(o => o.setName("to").setDescription("1-based index to move to").setRequired(true))
    .onExecute(async (interaction, args) => {
      const guildId = interaction.guildId;
      const player = getPlayer(guildId);
      if (!player) {
        await interaction.reply({ embeds: [embed.info({ title: "No active player." })], flags: 64 });
        return;
      }
      const from1 = Number(args.from);
      const to1 = Number(args.to);
      if (!Number.isFinite(from1) || !Number.isFinite(to1) || from1 <= 0 || to1 <= 0) {
        await interaction.reply({ embeds: [embed.error({ title: "Invalid indices." })], flags: 64 });
        return;
      }

      // Moving current (1) -> requeue current at target and skip current
      if (from1 === 1) {
        const list = toArrayQueue(player.queue);
        const toIdxInQueue = Math.max(0, to1 - 2);
        try {
          const current = player.current;
          if (!current) {
            await interaction.reply({ embeds: [embed.warn({ title: "No current track to move." })], flags: 64 });
            return;
          }
          if (typeof player.skip === "function") await player.skip();
          else if (typeof player.stop === "function") await player.stop();

          if (typeof player.queue.insert === "function") {
            player.queue.insert(toIdxInQueue, current);
          } else if (typeof player.queue.add === "function") {
            list.splice(toIdxInQueue, 0, current);
            if (typeof player.queue.clear === "function") player.queue.clear();
            player.queue.add(list);
          }
          await interaction.reply({ embeds: [embed.success({ title: `Moved current track to position #${to1}` })], flags: 64 });
        } catch (e) {
          await interaction.reply({ embeds: [embed.error({ title: "Move failed.", description: String(e?.message || e) })], flags: 64 });
        }
        return;
      }

      // Move within queue (>1)
      const list = toArrayQueue(player.queue);
      const from0 = from1 - 2;
      const to0 = Math.max(0, to1 - 2);
      if (from0 < 0 || from0 >= list.length || to0 < 0 || to0 >= list.length) {
        await interaction.reply({ embeds: [embed.warn({ title: "Move failed. Indices may be out of range." })], flags: 64 });
        return;
      }
      try {
        const [item] = list.splice(from0, 1);
        list.splice(to0, 0, item);
        if (typeof player.queue.clear === "function") player.queue.clear();
        if (typeof player.queue.add === "function") player.queue.add(list);
        await interaction.reply({ embeds: [embed.success({ title: `Moved #${from1} to #${to1}` })], flags: 64 });
      } catch (e) {
        await interaction.reply({ embeds: [embed.error({ title: "Move failed.", description: String(e?.message || e) })], flags: 64 });
      }
    });

  // Register commands
  let registrar;
  if (typeof ctx.createModuleContext === "function") {
    registrar = ctx.createModuleContext(moduleName).v2;
  } else {
    registrar = v2;
  }
  lifecycle.addDisposable(registrar.register(queueCmd));
  lifecycle.addDisposable(registrar.register(removeCmd));
  lifecycle.addDisposable(registrar.register(moveCmd));
  return queueCmd;
}

// DeepQuasar "stats" module
// Provides a /stats slash command with refresh and details toggles,
// showcasing bot and host statistics in a rich embed.

import os from "node:os";
import process, { version as nodeVersion } from "node:process";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, time, TimestampStyles, EmbedBuilder } from "discord.js";

export default async function init(ctx) {
  const { logger, config, v2, lifecycle, embed } = ctx;
  const moduleName = "stats";

  const enabled = config?.isEnabled?.("MODULE_STATS_ENABLED", true) ?? true;
  if (!enabled) {
    logger?.info?.("[stats] Module disabled via MODULE_STATS_ENABLED flag.");
    return { name: moduleName, description: "Stats module (disabled)" };
  }

  // Helpers
  const formatBytes = (bytes) => {
    if (typeof bytes !== "number" || isNaN(bytes)) return "N/A";
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    if (bytes === 0) return "0 B";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = bytes / Math.pow(1024, i);
    return `${val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2)} ${sizes[i]}`;
  };

  const formatMsDuration = (ms) => {
    if (!ms || ms < 0) ms = 0;
    const sec = Math.floor(ms / 1000);
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    if (s || parts.length === 0) parts.push(`${s}s`);
    return parts.join(" ");
  };

  const safe = (fn, fallback = "N/A") => {
    try { return fn(); } catch { return fallback; }
  };

  const getClientStats = (client) => {
    const now = Date.now();
    const readyAt = client?.readyAt ? client.readyAt : null;
    const uptimeMsClient = readyAt ? now - readyAt.getTime() : client?.uptime ?? 0;

    const guilds = client?.guilds?.cache?.size ?? 0;
    const channels = client?.channels?.cache?.size ?? 0;
    const usersCache = client?.users?.cache?.size ?? 0;
    const wsPing = Math.round(client?.ws?.ping ?? 0);

    // Attempt a better member count by summing known memberCount fields
    let membersEstimated = 0;
    try {
      membersEstimated = client?.guilds?.cache
        ? client.guilds.cache.reduce((acc, g) => acc + (g?.memberCount ?? 0), 0)
        : 0;
    } catch {
      membersEstimated = 0;
    }
    const members = membersEstimated || usersCache;

    // Sharding info
    const shardInfo = (() => {
      const shardIds = client?.ws?.shards ? Array.from(client.ws.shards.keys()) : [];
      const shardCount = client?.ws?.shards?.size ?? (client?.shard?.count ?? 1);
      return {
        ids: shardIds,
        count: shardCount,
      };
    })();

    return {
      uptimeMsClient,
      guilds,
      channels,
      users: members,
      usersCache,
      wsPing,
      shardInfo,
      readyAt,
    };
  };

  const getProcessStats = () => {
    const mem = process.memoryUsage();
    const cpu = safe(() => process.cpuUsage(), { user: 0, system: 0 });
    const load = safe(() => os.loadavg(), [0, 0, 0]);
    const node = process.versions?.node ?? nodeVersion ?? "unknown";
    const pid = process.pid;
    const platform = process.platform;
    const arch = process.arch;
    const uptimeProcMs = Math.floor(process.uptime() * 1000);

    const heapUsed = mem.heapUsed ?? 0;
    const heapTotal = mem.heapTotal ?? 0;
    const rss = mem.rss ?? 0;
    const external = mem.external ?? 0;
    const arrayBuffers = mem.arrayBuffers ?? 0;

    // CPU times are microseconds since process start
    const cpuUserMs = Math.round(cpu.user / 1000);
    const cpuSysMs = Math.round(cpu.system / 1000);

    // Host memory
    const totalMem = os.totalmem?.() ?? 0;
    const freeMem = os.freemem?.() ?? 0;

    return {
      node,
      pid,
      platform,
      arch,
      uptimeProcMs,
      mem: { heapUsed, heapTotal, rss, external, arrayBuffers },
      cpu: { userMs: cpuUserMs, systemMs: cpuSysMs },
      load: { "1m": load[0] ?? 0, "5m": load[1] ?? 0, "15m": load[2] ?? 0 },
      hostMem: { total: totalMem, free: freeMem, used: Math.max(totalMem - freeMem, 0) },
      hostname: safe(() => os.hostname(), "unknown"),
      cores: safe(() => os.cpus()?.length ?? 0, 0),
    };
  };

  const getLibraryVersions = (client) => {
    // discord.js version via import meta if available; fallback to require, then env
    let discordJs = "unknown";
    try {
      if (client?.constructor?.name) {
        // Best-effort import of package.json when available
        // eslint-disable-next-line import/no-extraneous-dependencies, global-require
        const pkg = require("discord.js/package.json");
        discordJs = pkg?.version ?? "unknown";
      }
    } catch {
      // try env injected by bundler or runtime, optional
      discordJs = process.env?.DISCORD_JS_VERSION ?? "unknown";
    }

    // Loaded modules: core may expose ctx.modules or ctx.loader
    const modulesLoaded =
      safe(() => ctx?.modules?.list?.().length, undefined) ??
      safe(() => ctx?.loader?.list?.().length, undefined);

    // Command counts: attempt multiple sources
    const slashCount =
      safe(() => v2?.stats?.slashCount, undefined) ??
      safe(() => v2?.registry?.slash?.size, undefined) ??
      safe(() => ctx?.commandHandler?.getSlashCount?.(), undefined);

    const componentHandlerCount =
      safe(() => v2?.stats?.componentHandlerCount, undefined) ??
      safe(() => {
        const b = v2?.registry?.buttons?.size ?? 0;
        const s = v2?.registry?.selects?.size ?? 0;
        const m = v2?.registry?.modals?.size ?? 0;
        return b + s + m;
      }, undefined) ??
      safe(() => ctx?.interactions?.countAll?.(), undefined);

    const commandCounts = { slash: slashCount, componentHandlers: componentHandlerCount };
    return { discordJs, modulesLoaded, commandCounts, node: process.versions?.node ?? "unknown" };
  };

  const buildEmbed = (ctx, client, showAdvanced = false) => {
    const eFactory = ctx.embed ?? null;
    const base = eFactory?.info
      ? eFactory.info({ title: "Bot Statistics" })
      : new EmbedBuilder().setTitle("Bot Statistics").setColor(0x2b6cb0);

    const lib = getLibraryVersions(client);
    const cs = getClientStats(client);
    const ps = getProcessStats();

    const linesMain = [
      `Uptime: ${formatMsDuration(cs.uptimeMsClient || ps.uptimeProcMs)}`,
      `WebSocket Ping: ${cs.wsPing}ms`,
      `Guilds: ${cs.guilds.toLocaleString()}`,
      `Channels: ${cs.channels.toLocaleString()}`,
      `Users (est.): ${cs.users.toLocaleString()} ${cs.users !== cs.usersCache ? `(cache: ${cs.usersCache.toLocaleString()})` : ""}`,
      `Shards: ${cs.shardInfo.count}${cs.shardInfo.ids.length > 0 ? ` (${cs.shardInfo.ids.join(",")})` : ""}`,
      `Node: v${ps.node} (${ps.platform}/${ps.arch})`,
      `discord.js: v${lib.discordJs}`,
    ];

    const fields = [
      { name: "Overview", value: linesMain.join("\n"), inline: false },
      {
        name: "Memory (Process)",
        value: [
          `RSS: ${formatBytes(ps.mem.rss)}`,
          `Heap: ${formatBytes(ps.mem.heapUsed)} / ${formatBytes(ps.mem.heapTotal)}`,
          `External: ${formatBytes(ps.mem.external)}`,
          `ArrayBuffers: ${formatBytes(ps.mem.arrayBuffers)}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Memory (Host)",
        value: [
          `Used: ${formatBytes(ps.hostMem.used)}`,
          `Free: ${formatBytes(ps.hostMem.free)}`,
          `Total: ${formatBytes(ps.hostMem.total)}`,
        ].join("\n"),
        inline: true,
      },
    ];

    // If discord.js version is unknown but client.ws.ping exists, try to hint runtime
    if (lib.discordJs === "unknown") {
      fields.push({
        name: "Runtime Hint",
        value: "discord.js version could not be resolved in this runtime. Consider exposing it via require('discord.js/package.json') or DISCORD_JS_VERSION env.",
        inline: false,
      });
    }

    if (showAdvanced) {
      fields.push(
        {
          name: "CPU / Load",
          value: [
            `CPU User: ${formatMsDuration(ps.cpu.userMs)}`,
            `CPU System: ${formatMsDuration(ps.cpu.systemMs)}`,
            `Load Avg: ${ps.load["1m"].toFixed(2)} / ${ps.load["5m"].toFixed(2)} / ${ps.load["15m"].toFixed(2)}`,
            `Cores: ${ps.cores}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "Runtime",
          value: [
            `PID: ${ps.pid}`,
            `Hostname: ${ps.hostname}`,
            cs.readyAt ? `Ready At: ${time(cs.readyAt, TimestampStyles.LongDateTime)}` : "",
          ].filter(Boolean).join("\n"),
          inline: true,
        },
        {
          name: "Commands / Modules",
          value: [
            `Modules Loaded: ${lib.modulesLoaded ?? "unknown"}`,
            `Slash Commands: ${lib.commandCounts.slash ?? "unknown"}`,
            `Component Handlers: ${lib.commandCounts.componentHandlers ?? "unknown"}`,
          ].join("\n"),
          inline: true,
        }
      );
    }

    const footerText = `DeepQuasar • Shards: ${cs.shardInfo.count} • PID: ${ps.pid}`;
    const built = base.setFields(fields).setTimestamp(new Date()).setFooter({ text: footerText });

    return built;
  };

  // Build a row with toggles/refresh buttons using v2 builder for IDs
  const buildComponents = (ctx, builder, moduleName, showAdvanced) => {
    const refreshBtn = builder.button(ctx, moduleName, "refresh", "Refresh", ButtonStyle.Primary);
    const toggleBtn = builder.button(
      ctx, moduleName, "toggle-advanced",
      showAdvanced ? "Hide Details" : "Show Details",
      showAdvanced ? ButtonStyle.Secondary : ButtonStyle.Success
    );

    const row = new ActionRowBuilder().addComponents(refreshBtn, toggleBtn);
    return [row];
  };

  // v2 command
  const stats = v2.createInteractionCommand()
    .setName("stats")
    .setDescription("Show comprehensive bot and host statistics.")
    .onExecute(async (interaction, args, state) => {
      // Read current toggle from state; default false
      const showAdvanced = state.get("advanced") === true;

      const embedBuilt = buildEmbed(ctx, interaction.client, showAdvanced);
      const components = buildComponents(ctx, stats, moduleName, showAdvanced);

      // Store a timestamp for rate-limiting refresh if desired
      state.set("lastRenderAt", Date.now());

      await interaction.reply({
        embeds: [embedBuilt],
        components,
        ephemeral: true,
      });
    })
    .onButton("refresh", async (interaction, state) => {
      // Optional basic anti-spam: 1s minimum between refreshes
      const last = state.get("lastRefreshAt") ?? 0;
      const now = Date.now();
      if (now - last < 1000) {
        await interaction.deferUpdate();
        return;
      }
      state.set("lastRefreshAt", now);

      const showAdvanced = state.get("advanced") === true;

      const embedBuilt = buildEmbed(ctx, interaction.client, showAdvanced);
      const components = buildComponents(ctx, stats, moduleName, showAdvanced);

      await interaction.update({
        embeds: [embedBuilt],
        components,
      });
    })
    .onButton("toggle-advanced", async (interaction, state) => {
      const curr = state.get("advanced") === true;
      const next = !curr;
      state.set("advanced", next);

      const embedBuilt = buildEmbed(ctx, interaction.client, next);
      const components = buildComponents(ctx, stats, moduleName, next);

      await interaction.update({
        embeds: [embedBuilt],
        components,
      });
    });

  // Register and manage lifecycle
  // Some environments may not provide createModuleContext; fall back to direct v2.register
  let dispose;
  if (typeof ctx.createModuleContext === "function") {
    const moduleCtx = ctx.createModuleContext(moduleName);
    dispose = moduleCtx.v2.register(stats);
  } else {
    dispose = v2.register(stats);
  }
  lifecycle.addDisposable(dispose);

  logger?.info?.("[stats] Module loaded. /stats is ready.");

  return {
    name: moduleName,
    description: "Shows detailed bot and host statistics with refresh and detail toggles.",
    dispose: () => {
      logger?.info?.("[stats] Module unloaded.");
    },
  };
}
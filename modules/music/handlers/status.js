// /music status command: reports Lavalink node status and per-guild settings snapshot

import { createMusicSettings } from "../services/musicSettings.js";

export function createMusicStatusCommand(ctx, moonlink) {
  const { v2, embed, lifecycle } = ctx;
  const moduleName = "music";
  const settings = createMusicSettings(ctx);

  const statusCmd = v2.createInteractionCommand()
    .setName("music")
    .setDescription("Music module utilities")
    .addOption((b) =>
      b.addSubcommand((sc) =>
        sc
          .setName("status")
          .setDescription("Show music backend status and guild settings")
      )
    )
    .onExecute(async (interaction) => {
      // Only /music status supported for now
      const sub = interaction.options?.getSubcommand?.() || "status";
      if (sub !== "status") {
        await interaction.reply({ embeds: [embed.warn({ title: "Unsupported subcommand" })], ephemeral: true });
        return;
      }

      try {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ ephemeral: true });
        }
      } catch {}

      // Node info
      const nodes = typeof moonlink?.getConnectedNodeInfo === "function"
        ? moonlink.getConnectedNodeInfo()
        : (Array.isArray(moonlink?.nodes)
            ? moonlink.nodes.map(n => ({
                identifier: n?.identifier,
                host: n?.host,
                port: n?.port,
                connected: Boolean(n?.connected)
              }))
            : []);

      const connectedCount = nodes.filter(n => n.connected).length;
      const nodeLines = nodes.length
        ? nodes.map(n => `• ${n.identifier || `${n.host}:${n.port}`} — ${n.connected ? "Connected" : "Disconnected"}`).join("\n")
        : "No nodes configured.";

      // Guild settings
      const guildId = interaction.guildId;
      const s = await settings.get(guildId);

      const e = embed.info({
        title: "Music Status",
        fields: [
          { name: "Nodes", value: `${connectedCount}/${nodes.length} connected`, inline: true },
          { name: "Node Details", value: nodeLines, inline: false },
          { name: "Guild Settings", value:
              [
                `Volume: ${s.volume}`,
                `Autoplay: ${s.autoplay ? "On" : "Off"}`,
                `Loop: ${s.loop}`,
                `Inactivity Timeout: ${s.inactivityTimeoutMs} ms`,
                `Max Queue: ${s.maxQueue}`,
                `DJ Role: ${s.djRoleId || "None"}`,
                `Announce Channel: ${s.announceChannelId || "None"}`
              ].join("\n"),
            inline: false
          }
        ]
      });

      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({ embeds: [e] });
        } else {
          await interaction.reply({ embeds: [e], ephemeral: true });
        }
      } catch {}
    });

  // Register with module-scoped registrar if available
  let registrar;
  if (typeof ctx.createModuleContext === "function") {
    registrar = ctx.createModuleContext(moduleName).v2;
  } else {
    registrar = v2;
  }
  lifecycle.addDisposable(registrar.register(statusCmd));
  return statusCmd;
}
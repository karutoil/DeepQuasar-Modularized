import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

/**
 * Stats module
 * Feature flag: MODULE_STATS_ENABLED
 * Demonstrates event listening and a /stats command.
 */
export default async function init(ctx) {
  const { client, logger, config, commands, bus, events } = ctx;

  const enabled = config.isEnabled("MODULE_STATS_ENABLED", true);
  if (!enabled) {
    logger.info("MODULE_STATS_ENABLED=false, skipping initialization");
    return { name: "stats", description: "Stats module (disabled)" };
  }

  // Simple counters
  const counters = {
    readyFired: 0,
    joins: 0,
  };

  // Attach listeners via core events registry
  const offReady = events.on("stats", "ready", () => {
    counters.readyFired += 1;
    bus.publish("stats.ready", { at: Date.now(), count: counters.readyFired });
    logger.info(`Client ready fired ${counters.readyFired} time(s)`);
  });

  const offJoin = events.on("stats", "guildMemberAdd", (member) => {
    counters.joins += 1;
    bus.publish("stats.join", { at: Date.now(), guildId: member.guild.id, total: counters.joins });
    logger.info(`New member joined guild ${member.guild.id}. Total joins: ${counters.joins}`);
  });

  // Slash command to view counters
  const statsCmd = new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show basic bot statistics")
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

  commands.registerSlash("stats", statsCmd);

  const removeHandler = commands.onInteractionCreate("stats", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "stats") return;

    const guilds = client.guilds.cache.size;
    const users = client.users.cache.size;

    await interaction.reply({
      content: [
        "Bot statistics:",
        `- Ready events: ${counters.readyFired}`,
        `- Joins observed: ${counters.joins}`,
        `- Cached guilds: ${guilds}`,
        `- Cached users: ${users}`,
      ].join("\n"),
      ephemeral: true,
    });
  });

  return {
    name: "stats",
    description: "Basic statistics module",
    dispose: async () => {
      try {
        removeHandler?.();
      } catch (e) {
        logger.warn(`Error detaching stats handler: ${e?.message}`);
      }
      // Events are detached via events.removeModule() by the loader during unload.
      logger.info("Disposed stats module");
    },
    postReady: async () => {
      logger.info("Stats module ready");
    },
  };
}
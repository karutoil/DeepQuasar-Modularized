// Moonlink.js Manager Service: Initializes and manages Moonlink.js connection
import { Manager } from "moonlink.js";

export function createMoonlinkClient(ctx) {
  const { config, logger } = ctx;
  const nodes = [{
    host: config.get("LAVALINK_HOST"),
    port: Number(config.get("LAVALINK_PORT", 2333)),
    password: config.get("LAVALINK_PASSWORD"),
  }];
  const moonlink = new Manager({
    nodes,
    shardCount: 1,
    client: ctx.discordClient,
    sendPayload: (id, payload) => {
      const guild = ctx.discordClient.guilds.cache.get(id);
      if (guild) guild.shard.send(payload);
    }
  });
  logger.info("Moonlink.js Manager initialized.");
  return moonlink;
}

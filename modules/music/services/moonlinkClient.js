// Moonlink.js Manager Service: Initializes and manages Moonlink.js connection
import { Manager } from "moonlink.js";

// Simple deferred helper
function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject, settled: false };
}

export function createMoonlinkClient(ctx) {
  const { config, logger, client } = ctx; // use ctx.client from core
  const nodes = [{
    identifier: "Main",
    host: config.get("LAVALINK_HOST"),
    port: Number(config.get("LAVALINK_PORT", 2333)),
    password: config.get("LAVALINK_PASSWORD"),
    secure: config.get("LAVALINK_SECURE", false) === "true" || config.get("LAVALINK_SECURE", false) === true
  }];

  // Create Manager with proper Discord client bridge
  logger.debug("Moonlink.js node config", { nodes });
  const moonlink = new Manager({
    nodes,
    client, // Pass the discord.js Client
    // Stability and behavior defaults (Moonlink v4 capabilities)
    autoResume: true,               // resume players after node reconnect
    movePlayersOnReconnect: true,   // move players when node changes
    resume: true,                // resume players after disconnect
    defaultPlatformSearch: "youtube",
    autoPlay: true,                 // default autoplay for new players
    defaultVolume: 20,              // safe start volume
    // sendPayload bridge per docs
    sendPayload: (id, payload) => {
      try {
        const data = typeof payload === "string" ? JSON.parse(payload) : payload;
        const guild = client.guilds.cache.get(id);
        if (guild?.shard) {
          guild.shard.send(data);
        } else if (client.ws) {
          for (const shard of client.ws.shards.values()) {
            shard.send(data);
          }
        }
      } catch (err) {
        logger.error("Moonlink sendPayload error", { error: err?.message || err });
      }
    }
  });

  // Readiness tracking
  let isReady = false;
  let deferred = createDeferred();
  const resolveReady = () => {
    if (!isReady) {
      isReady = true;
      logger.info("[Moonlink] readiness resolved");
    }
    if (!deferred.settled) {
      deferred.resolve(true);
      deferred.settled = true;
    }
  };
  const resetDeferredIfNeeded = () => {
    if (isReady) {
      logger.warn("[Moonlink] readiness reset due to node state change");
    }
    isReady = false;
    deferred = createDeferred();
  };

  // Node lifecycle logs and stability hooks
  moonlink.on("nodeCreate", (node) => logger.info(`[Moonlink] Node created: ${node?.identifier || node?.host || "unknown"}`));
  const onNodeConnect = (node) => {
    logger.info(`[Moonlink] Node connected: ${node?.identifier || node?.host || "unknown"}`);
    resolveReady();
  };
  moonlink.on("nodeConnect", onNodeConnect);
  moonlink.on("nodeConnected", onNodeConnect);
  moonlink.on("nodeReconnect", (node) => {
    logger.warn(`[Moonlink] Node reconnecting: ${node?.identifier || node?.host || "unknown"}`);
    resetDeferredIfNeeded();
  });
  moonlink.on("nodeDisconnect", (node, code, reason) => {
    logger.warn(`[Moonlink] Node disconnected: ${node?.identifier || node?.host || "unknown"} code=${code} reason=${reason}`);
    resetDeferredIfNeeded();
  });
  moonlink.on("nodeError", (node, error) => {
    logger.error(`[Moonlink] Node error on ${node?.identifier || node?.host || "unknown"}: ${error?.message || error}`);
  });
  moonlink.on("nodeDestroy", (node) => {
    logger.warn(`[Moonlink] Node destroyed: ${node?.identifier || node?.host || "unknown"}`);
    resetDeferredIfNeeded();
  });
  moonlink.on("nodeAutoResumed", (node, players) => {
    logger.info(`[Moonlink] Auto-resumed ${Array.isArray(players) ? players.length : 0} players on ${node?.identifier || "node"}`);
    // Silent resume per requirement; do not spam channels on reload
  });
  moonlink.on("ready", () => {
    logger.info("[Moonlink] Manager ready event received");
    resolveReady();
  });
  moonlink.on("debug", (msg) => logger.debug(`[Moonlink Debug] ${msg}`));

  // Expose helpers on instance (non-enumerable to avoid serialization issues)
  Object.defineProperties(moonlink, {
    __isReady: {
      get() { return isReady; }
    },
    waitForReady: {
      value: async (timeoutMs = 15000) => {
        if (isReady) return true;
        logger.debug("[Moonlink] waitForReady start", { timeoutMs });
        const timeout = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs));
        const result = await Promise.race([deferred.promise.then(() => true), timeout]);
        logger.debug("[Moonlink] waitForReady done", { result });
        return result;
      }
    },
    getConnectedNodeInfo: {
      value: () => {
        try {
          const list = Array.isArray(moonlink.nodes) ? moonlink.nodes : [];
          const info = list.map(n => ({
            identifier: n?.identifier,
            host: n?.host,
            port: n?.port,
            connected: Boolean(n?.connected),
          }));
          logger.debug("[Moonlink] node snapshot", { nodes: info });
          return info;
        } catch {
          return [];
        }
      }
    }
  });

  logger.info("Moonlink.js Manager initialized.", {
    nodesConfigured: Array.isArray(nodes) ? nodes.map(n => `${n.host}:${n.port}`) : []
  });

  return moonlink;
}

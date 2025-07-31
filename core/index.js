import { createConfig } from "./config.js";
import { createLogger, childLogger } from "./logger.js";
import { createBus } from "./bus.js";
import { createCommandHandler } from "./commandHandler.js";
import { createInteractions } from "./interactions.js";
import { createEvents } from "./events.js";
import { createEmbed } from "./embed.js";
import { createPermissions } from "./permissions.js";
import { createRateLimiter } from "./rateLimiter.js";
import { createHttp } from "./http.js";
import { createIds } from "./ids.js";
import { createDsl } from "./dsl.js";
import { createScheduler } from "./scheduler.js";
import { createMetrics } from "./metrics.js";
import { createMongo } from "./mongo.js";

/**
 * Create lifecycle utilities that track disposables for a given module.
 */
function createLifecycle(logger) {
  const disposables = new Set();

  function addDisposable(fn) {
    if (typeof fn === "function") disposables.add(fn);
    return () => disposables.delete(fn);
  }

  function addListener(emitter, event, handler) {
    emitter.on(event, handler);
    const off = () => emitter.off(event, handler);
    addDisposable(off);
    return off;
  }

  function trackedSetInterval(fn, ms) {
    const id = setInterval(fn, ms);
    const clear = () => clearInterval(id);
    addDisposable(clear);
    return id;
  }

  function trackedSetTimeout(fn, ms) {
    const id = setTimeout(fn, ms);
    const clear = () => clearTimeout(id);
    addDisposable(clear);
    return id;
  }

  async function disposeAll() {
    const list = Array.from(disposables);
    disposables.clear();
    for (const d of list) {
      try {
        await d();
      } catch (err) {
        logger.error(`Lifecycle dispose error: ${err?.message}`, { stack: err?.stack });
      }
    }
  }

  return {
    addDisposable,
    addListener,
    setInterval: trackedSetInterval,
    setTimeout: trackedSetTimeout,
    disposeAll,
  };
}

/**
 * Utility helpers
 */
function createUtils(logger) {
  function now() {
    return new Date().toISOString();
  }
  async function safeAsync(fn, onError) {
    try {
      return await fn();
    } catch (err) {
      logger.error(`safeAsync error: ${err?.message}`, { stack: err?.stack });
      if (onError) {
        try {
          onError(err);
        } catch (e) {
          logger.error(`safeAsync onError error: ${e?.message}`, { stack: e?.stack });
        }
      }
      return undefined;
    }
  }
  return { now, safeAsync };
}

/**
 * Create the shared core utilities given a pre-created client.
 */
export function createCore(client, baseLoggerLevel = "info") {
  const config = createConfig();
  const logger = createLogger(config.get("LOG_LEVEL") ?? baseLoggerLevel);
  const bus = createBus(logger);
  const commands = createCommandHandler(client, logger, config);
  const interactions = createInteractions(client, logger);
  const events = createEvents(client, logger);
  const embed = createEmbed(config);
  const rateLimiter = createRateLimiter(logger);
  const permissions = createPermissions(embed, logger);
  const http = createHttp(config, logger);
  const ids = createIds();
  const metrics = createMetrics(logger);
  const scheduler = createScheduler(logger);
  const mongo = createMongo(config, logger);

  // DSL depends on some of the above
  const dsl = createDsl({ logger, embed, rateLimiter, permissions });

  return {
    client,
    logger,
    config,
    bus,
    commands,
    interactions,
    events,
    embed,
    rateLimiter,
    permissions,
    http,
    ids,
    metrics,
    scheduler,
    mongo,
    dsl,
    createModuleContext(moduleName) {
      const log = childLogger(logger, moduleName);
      const lifecycle = createLifecycle(log);
      const utils = createUtils(log);
      return {
        client,
        logger: log,
        config,
        bus,
        commands,
        interactions,
        events,
        embed,
        rateLimiter,
        permissions,
        http,
        ids,
        metrics,
        scheduler,
        mongo,
        dsl,
        lifecycle,
        utils
      };
    },
  };
}

export { createConfig } from "./config.js";
export { createLogger, childLogger } from "./logger.js";
export { createBus } from "./bus.js";
export { createCommandHandler } from "./commandHandler.js";
export { createInteractions } from "./interactions.js";
export { createEvents } from "./events.js";
export { createEmbed } from "./embed.js";
export { createPermissions } from "./permissions.js";
export { createRateLimiter } from "./rateLimiter.js";
export { createHttp } from "./http.js";
export { createIds } from "./ids.js";
export { createDsl } from "./dsl.js";
export { createScheduler } from "./scheduler.js";
export { createMetrics } from "./metrics.js";
export { createMongo } from "./mongo.js";
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
import { createStateManager } from "./state.js";
import { createInteractionCommand, InteractionCommandBuilder, createBuilderRegistry } from "./builders.js";
import { createPaginatedEmbed, createConfirmationDialog, createMultiSelectMenu } from "./ui.js";
import * as crypto from './crypto.js';
// New services
import { createI18n } from "./i18n.js";
import { createGuildConfig } from "./guildConfig.js";
import { createErrorReporter } from "./reporting.js";
import { initStatusCycler } from "./statusCycler.js";

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
  const logger = createLogger(config.get("LOG_LEVEL") ?? baseLoggerLevel, config);

  

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

  // New cross-cutting services
  const errorReporter = createErrorReporter({ config, logger });
  const i18n = createI18n({ config, logger });
  const guildConfig = createGuildConfig({ mongo, logger, config });

  // v2: state manager and builder registry
  const state = createStateManager(logger);
  const builders = createBuilderRegistry();

  // DSL depends on some of the above (augment with reporter and i18n)
  const dsl = createDsl({ logger, embed, rateLimiter, permissions, errorReporter, i18n });

  // Initialize status cycler
  const statusCycler = initStatusCycler(client);

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
    i18n,
    guildConfig,
    errorReporter,
    statusCycler, // Add statusCycler to the returned object
    // v2 surfaces
    v2: {
      state,
      builders,
      createInteractionCommand,
      InteractionCommandBuilder,
      ui: {
        createPaginatedEmbed,
        createConfirmationDialog,
        createMultiSelectMenu,
      },
      crypto,
    },
    createModuleContext(moduleName) {
      const log = childLogger(logger, moduleName);
      const lifecycle = createLifecycle(log);
      const utils = createUtils(log);
      // Module-scoped translator helper using module fallback chain
      function t(key, params = {}, opts = {}) {
        const locale = opts.locale || i18n.resolveLocale({ guildId: opts.guildId, userLocale: opts.userLocale });
        return i18n.t({ key, params, locale, moduleName });
      }
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
        utils,
        t,
        i18n,
        guildConfig,
        errorReporter,
        crypto, // Added crypto module to the context
        // v2 in module context for easy access
        v2: {
          state,
          builders,
          createInteractionCommand,
          InteractionCommandBuilder,
          ui: {
            createPaginatedEmbed,
            createConfirmationDialog,
            createMultiSelectMenu,
          },
          // convenience to register a builder to this module
          register(builder) {
            const { off } = builder.register({ ...this, ...{ commands, interactions, logger: log, t } }, moduleName, { stateManager: state });
            const unregister = builders.add(moduleName, builder);
            lifecycle.addDisposable(() => { try { off?.(); } catch (err) { void err; } try { unregister?.(); } catch (err) { void err; } });
            return off;
          }
        }
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
// v2 exports
export { createStateManager } from "./state.js";
export { createInteractionCommand, InteractionCommandBuilder, createBuilderRegistry } from "./builders.js";
export { createPaginatedEmbed, createConfirmationDialog, createMultiSelectMenu } from "./ui.js";
// new exports
export { createI18n } from "./i18n.js";
export { createGuildConfig } from "./guildConfig.js";
export { createErrorReporter } from "./reporting.js";
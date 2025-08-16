import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import chokidar from "chokidar";
import { createCore } from "./core/index.js";
import { initStatusCycler } from "./core/statusCycler.js";
import { register as registerLinecount } from "./core/commands/linecount.js";
import { register as registerAutocompleteDebug } from "./core/commands/autocomplete-debug.js";



// Global safeguard: raise max listeners on Console's underlying streams
try {
  const stdoutEE = /** @type {any} */ (process.stdout);
  const stderrEE = /** @type {any} */ (process.stderr);
  if (stdoutEE?.setMaxListeners) stdoutEE.setMaxListeners(200);
  if (stderrEE?.setMaxListeners) stderrEE.setMaxListeners(200);
} catch (err) { void err; }


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function moduleFlagName(moduleName) {
  return `MODULE_${moduleName.toUpperCase()}_ENABLED`;
}

function cacheBustedImport(filePath) {
  const url = new URL(pathToFileURL(filePath));
  url.searchParams.set("v", Date.now().toString());
  return import(url.href);
}

async function importModuleEntry(dirPath, moduleName, logger) {
  const esmEntry = path.join(dirPath, "index.js");
  const cjsEntry = path.join(dirPath, "index.cjs");

  if (fs.existsSync(esmEntry)) {
    try {
      return await cacheBustedImport(esmEntry);
    } catch (e) {
      logger.warn(`Failed to import ESM entry for module '${moduleName}': ${e?.message}`);
    }
  }
  if (fs.existsSync(cjsEntry)) {
    try {
      return await cacheBustedImport(cjsEntry);
    } catch (e) {
      logger.warn(`Failed to import CJS entry for module '${moduleName}': ${e?.message}`);
    }
  }
  throw new Error(`No module entry file found (index.js or index.cjs) for ${moduleName}`);
}

function createModuleRecord(name, dir) {
  return {
    name,
    dir,
    handle: null,
    loadedAt: null,
  };
}

async function main() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.DirectMessageTyping,
      GatewayIntentBits.GuildInvites
    ],
    partials: [Partials.GuildMember, Partials.Message, Partials.Channel]
  });

  const core = createCore(client);
  const { logger, config, commands, interactions, events } = core;

  // --- Shutdown Logic ---
  let isShuttingDown = false;
  let shutdownTimeout;
  let statusCyclerStop = null; // Will be set after initStatusCycler
  const SHUTDOWN_TIMEOUT_MS = 15000;

  async function shutdown(reason = "unknown") {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`[Shutdown] Initiating shutdown: ${reason}`);

    // Set a timeout to force exit if hanging
    shutdownTimeout = setTimeout(() => {
      logger.error("[Shutdown] Timeout reached, forcing exit.");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    // Steps to cleanup
    const cleanupSteps = [];

    // 1. Stop status cycler
    cleanupSteps.push((async () => {
      try {
        if (typeof statusCyclerStop === "function") {
          await statusCyclerStop();
          logger.info("[Shutdown] Status cycler stopped.");
        }
      } catch (e) {
        logger.error(`[Shutdown] Error stopping status cycler: ${e?.message}`, { stack: e?.stack });
      }
    })());

    // 2. Stop file watcher
    cleanupSteps.push((async () => {
      try {
        if (watcher) {
          await watcher.close();
          logger.info("[Shutdown] File watcher stopped.");
        }
      } catch (e) {
        logger.error(`[Shutdown] Error stopping file watcher: ${e?.message}`, { stack: e?.stack });
      }
    })());

    // 3. Clear debounced intervals
    cleanupSteps.push((async () => {
      try {
        for (const id of debouncers.values()) {
          clearTimeout(id);
        }
        debouncers.clear();
        logger.info("[Shutdown] Debounced intervals cleared.");
      } catch (e) {
        logger.error(`[Shutdown] Error clearing debouncers: ${e?.message}`, { stack: e?.stack });
      }
    })());

    // 4. Unload all modules (calls dispose if present)
    cleanupSteps.push((async () => {
      try {
        const unloads = [];
        for (const name of moduleStates.keys()) {
          unloads.push(unloadModule(name));
        }
        await Promise.allSettled(unloads);
        logger.info("[Shutdown] All modules unloaded.");
      } catch (e) {
        logger.error(`[Shutdown] Error unloading modules: ${e?.message}`, { stack: e?.stack });
      }
    })());

    // 5. Close database connections (if present)
    cleanupSteps.push((async () => {
      try {
        if (core.mongo?.disconnect) {
          await core.mongo.disconnect();
          logger.info("[Shutdown] MongoDB disconnected.");
        }
      } catch (e) {
        logger.error(`[Shutdown] Error disconnecting MongoDB: ${e?.message}`, { stack: e?.stack });
      }
    })());

    // 6. Disconnect Discord client
    cleanupSteps.push((async () => {
      try {
        await client.destroy();
        logger.info("[Shutdown] Discord client disconnected.");
      } catch (e) {
        logger.error(`[Shutdown] Error disconnecting Discord client: ${e?.message}`, { stack: e?.stack });
      }
    })());

    // 7. Shutdown other external services (if present)
    cleanupSteps.push((async () => {
      try {
        if (core.shutdownExternalServices) {
          await core.shutdownExternalServices();
          logger.info("[Shutdown] External services shut down.");
        }
      } catch (e) {
        logger.error(`[Shutdown] Error shutting down external services: ${e?.message}`, { stack: e?.stack });
      }
    })());

    // Wait for all cleanup steps to finish
    await Promise.allSettled(cleanupSteps);

    clearTimeout(shutdownTimeout);
    logger.info("[Shutdown] Cleanup complete. Exiting.");
    process.exit(0);
  }

  // Signal handlers
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    logger.error(`[Shutdown] Uncaught exception: ${err?.message}`, { stack: err?.stack });
    shutdown("uncaughtException");
  });
  // --- End Shutdown Logic ---

  // Register core-utility commands (e.g., /linecount) before installing commands
  try {
    const coreCtx = core.createModuleContext("core-utilities");
    registerLinecount(coreCtx);
    registerAutocompleteDebug(coreCtx);
    logger.info("Core utility commands registered");
  } catch (err) {
    logger.warn(`Failed to register core utility commands: ${err?.message}`);
  }

  try {
    core.config.require(["DISCORD_TOKEN"]);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const modulesDir = path.join(__dirname, "modules");
  if (!fs.existsSync(modulesDir)) {
    fs.mkdirSync(modulesDir, { recursive: true });
  }

  const moduleFolders = fs.readdirSync(modulesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const moduleStates = new Map();

  async function loadModule(moduleName) {
    const dirPath = path.join(modulesDir, moduleName);
    const flag = moduleFlagName(moduleName);
    const enabled = config.isEnabled(flag, true);

    const modLogger = core.logger.child({ module: moduleName });
    if (!enabled) {
      modLogger.info(`Module disabled via ${flag}=false`);
      return;
    }

    const record = createModuleRecord(moduleName, dirPath);
    moduleStates.set(moduleName, record);

    try {
      modLogger.info(`Attempting to load module: ${moduleName} from ${dirPath}`);
      const mod = await importModuleEntry(dirPath, moduleName, modLogger);
      const init = mod?.default;
      if (typeof init !== "function") {
        modLogger.warn("Module has no default init function; skipping");
        return;
      }

      const ctx = core.createModuleContext(moduleName);
      const handle = await init(ctx);
      record.handle = handle || null;
      record.loadedAt = new Date();

      modLogger.info(`Module loaded`);
    } catch (err) {
      const msg = err?.message || String(err);
      modLogger.error(`Module load error: ${msg}`, { stack: err?.stack });
    }
  }

  async function unloadModule(moduleName) {
    const record = moduleStates.get(moduleName);
    if (!record) return;

    const log = core.logger.child({ module: moduleName });
    try {
      // Remove slash commands and interaction/event handlers for this module
      commands.removeModule(moduleName);
      interactions.removeModule(moduleName);
      events.removeModule(moduleName);

      if (record.handle?.dispose) {
        try {
          await record.handle.dispose();
        } catch (e) {
          log.warn(`Error in module dispose(): ${e?.message}`);
        }
      }

      moduleStates.delete(moduleName);
      log.info("Module unloaded");
    } catch (err) {
      log.error(`Error during unload: ${err?.message}`, { stack: err?.stack });
    }
  }

  async function loadAllModules() {
    for (const name of moduleFolders) {
      await loadModule(name);
    }
  }

  client.once("ready", async () => {
    logger.info(`Logged in as ${client.user?.tag}`);

    try {
      const guildId = config.get("GUILD_ID");
      if (guildId) {
        await commands.installGuild(guildId);
      } else {
        await commands.installGlobal();
      }
    } catch (err) {
      logger.error(`Command install error: ${err?.message}`, { stack: err?.stack });
    }

    for (const [name, record] of moduleStates) {
      const log = core.logger.child({ module: name });
      const postReady = record.handle?.postReady;
      if (typeof postReady === "function") {
        try {
          await postReady(core.createModuleContext(name));
        } catch (err) {
          log.error(`postReady error: ${err?.message}`, { stack: err?.stack });
        }
      }
    }

    // Start status cycler after bot is ready
    // Save the stop function for shutdown
    // initStatusCycler returns an object with stop() method
    statusCyclerStop = initStatusCycler(client, { moduleStates }).stop;
  });

  await loadAllModules();

  client.on("error", (e) => logger.error(`Client error: ${e?.message}`, { stack: e?.stack }));
  client.on("shardError", (e) => logger.error(`Shard error: ${e?.message}`, { stack: e?.stack }));

  await client.login(config.get("DISCORD_TOKEN"));

  const watcher = chokidar.watch(path.join(modulesDir, "**/*"), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
  });

  const debouncers = new Map();

  function debounce(moduleName, fn) {
    const prev = debouncers.get(moduleName);
    if (prev) clearTimeout(prev);
    const id = setTimeout(fn, 150);
    debouncers.set(moduleName, id);
  }

  watcher.on("all", (event, changedPath) => {
    const rel = path.relative(modulesDir, changedPath);
    const parts = rel.split(path.sep);
    const moduleName = parts[0];
    if (!moduleName || !moduleFolders.includes(moduleName)) return;

    const log = core.logger.child({ module: moduleName });
    log.info(`File change detected (${event}): ${rel}`);

    debounce(moduleName, async () => {
      try {
        await unloadModule(moduleName);
        await loadModule(moduleName);
        const shouldReinstall = config.getBool("HOT_RELOAD_REINSTALL", true);
        if (client.isReady() && shouldReinstall) {
          const guildId = config.get("GUILD_ID");
          if (guildId) {
            await commands.installGuild(guildId);
          } else {
            await commands.installGlobal();
          }
        }
        log.info("Hot reload completed");
      } catch (err) {
        log.error(`Hot reload error: ${err?.message}`, { stack: err?.stack });
      }
    });
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
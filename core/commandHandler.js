import { REST, Routes, SlashCommandBuilder } from "discord.js";

function normalizeJson(cmd) {
  if (cmd instanceof SlashCommandBuilder) return cmd.toJSON();
  // assume already normalized JSON shape for slash/context commands
  return cmd;
}

function hashCommand(cmd) {
  // A simple stable hash via JSON string. For production, consider a stronger hash.
  return JSON.stringify(cmd);
}

export function createCommandHandler(client, logger, config) {
  // Registries
  const commandsByModule = new Map(); // moduleName -> json[]
  const handlersByModule = new Map(); // moduleName -> Set(handler)
  const allHandlers = new Set();
  let interactionWired = false;

  // Cache of last deployed hashes to compute deltas on subsequent installs
  let lastDeployedHashes = new Map(); // name -> hash

  function registerSlash(moduleName, ...builders) {
    const jsons = builders.flat().map(normalizeJson);
    const list = commandsByModule.get(moduleName) || [];
    const existingNames = new Set(list.map((c) => c.name));

    for (const c of jsons) {
      if (!c?.name) {
        logger.warn(`Ignoring invalid command without a 'name' in module '${moduleName}'`);
        continue;
      }
      if (existingNames.has(c.name)) {
        logger.warn(`Duplicate command '${c.name}' in module '${moduleName}' ignored`);
        continue;
      }
      list.push(c);
      existingNames.add(c.name);
    }
    commandsByModule.set(moduleName, list);
    return list.length;
  }

  function onInteractionCreate(moduleName, handler) {
    let set = handlersByModule.get(moduleName);
    if (!set) {
      set = new Set();
      handlersByModule.set(moduleName, set);
    }
    set.add(handler);
    allHandlers.add(handler);

    if (!interactionWired) {
      interactionWired = true;
      client.on("interactionCreate", async (interaction) => {
        if (!interaction.isChatInputCommand?.() && !interaction.isContextMenuCommand?.()) return;
        for (const h of Array.from(allHandlers)) {
          try {
            await h(interaction);
          } catch (err) {
            logger.error(`Interaction handler error: ${err?.message}`, { stack: err?.stack });
          }
        }
      });
    }
    return () => {
      set.delete(handler);
      allHandlers.delete(handler);
    };
  }

  function aggregateCommands() {
    const out = [];
    for (const arr of commandsByModule.values()) out.push(...arr);
    return out;
  }

  function computeHashes(cmds) {
    const map = new Map();
    for (const c of cmds) {
      map.set(c.name, hashCommand(c));
    }
    return map;
  }

  function diffHashes(current) {
    const added = [];
    const updated = [];
    const removed = [];

    // Find added or updated
    for (const [name, h] of current.entries()) {
      const prev = lastDeployedHashes.get(name);
      if (!prev) {
        added.push(name);
      } else if (prev !== h) {
        updated.push(name);
      }
    }

    // Find removed
    for (const [name] of lastDeployedHashes.entries()) {
      if (!current.has(name)) {
        removed.push(name);
      }
    }

    return { added, updated, removed };
  }

  async function fetchExisting(rest, route) {
    try {
      const data = await rest.get(route);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      logger.error(`Failed fetching existing commands: ${err?.message}`, { stack: err?.stack });
      return [];
    }
  }

  function buildNameMap(cmds) {
    const map = new Map();
    for (const c of cmds) {
      map.set(c.name, c);
    }
    return map;
  }

  async function upsertCommands(rest, route, desiredCmds) {
    // Smart deploy: only create/update/remove changed commands
    // 1) Fetch existing commands
    const existing = await fetchExisting(rest, route);
    const existingByName = buildNameMap(existing);
    const desiredByName = buildNameMap(desiredCmds);

    const toCreate = [];
    const toUpdate = [];
    const toDelete = [];

    // Determine creates/updates
    for (const [name, desired] of desiredByName.entries()) {
      const found = existingByName.get(name);
      if (!found) {
        toCreate.push(desired);
      } else {
        // Compare JSON (stringify for simplicity)
        if (JSON.stringify(found) !== JSON.stringify(desired)) {
          toUpdate.push({ id: found.id, body: desired });
        }
      }
    }

    // Determine deletes
    for (const [name, found] of existingByName.entries()) {
      if (!desiredByName.has(name)) {
        toDelete.push(found.id);
      }
    }

    // Apply operations
    for (const body of toCreate) {
      await rest.post(route, { body });
      logger.info(`Created command '${body.name}'`);
    }
    for (const u of toUpdate) {
      await rest.patch(`${route}/${u.id}`, { body: u.body });
      logger.info(`Updated command '${u.body.name}'`);
    }
    for (const id of toDelete) {
      await rest.delete(`${route}/${id}`);
      logger.info(`Deleted command id='${id}'`);
    }

    return { created: toCreate.length, updated: toUpdate.length, deleted: toDelete.length };
  }

  async function installGuild(guildId) {
    const token = config.get("DISCORD_TOKEN");
    const appId = config.get("DISCORD_CLIENT_ID") || client.application?.id;
    if (!token || !appId || !guildId) {
      throw new Error("Missing DISCORD_TOKEN, DISCORD_CLIENT_ID (or application id), or GUILD_ID for guild command install");
    }
    const rest = new REST({ version: "10" }).setToken(token);
    const desired = aggregateCommands();
    const route = Routes.applicationGuildCommands(appId, guildId);

    const currentHashes = computeHashes(desired);
    const delta = diffHashes(currentHashes);
    logger.info(
      `Guild command deploy delta: +${delta.added.length} ~${delta.updated.length} -${delta.removed.length}`
    );

    const result = await upsertCommands(rest, route, desired);
    logger.info(
      `Guild commands: created=${result.created}, updated=${result.updated}, deleted=${result.deleted}`
    );

    lastDeployedHashes = currentHashes;
  }

  async function installGlobal() {
    const token = config.get("DISCORD_TOKEN");
    const appId = config.get("DISCORD_CLIENT_ID") || client.application?.id;
    if (!token || !appId) {
      throw new Error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID (or application id) for global command install");
    }
    const rest = new REST({ version: "10" }).setToken(token);
    const desired = aggregateCommands();
    const route = Routes.applicationCommands(appId);

    const currentHashes = computeHashes(desired);
    const delta = diffHashes(currentHashes);
    logger.info(
      `Global command deploy delta: +${delta.added.length} ~${delta.updated.length} -${delta.removed.length}`
    );

    const result = await upsertCommands(rest, route, desired);
    logger.info(
      `Global commands: created=${result.created}, updated=${result.updated}, deleted=${result.deleted} (propagation can take up to 1 hour)`
    );

    lastDeployedHashes = currentHashes;
  }

  function removeModule(moduleName) {
    commandsByModule.delete(moduleName);
    const set = handlersByModule.get(moduleName);
    if (set) {
      for (const h of set) allHandlers.delete(h);
      handlersByModule.delete(moduleName);
    }
    // Note: We do not modify lastDeployedHashes here; it's updated on next install.
  }

  // For testing or external reporting
  function getRegistrySnapshot() {
    const cmds = aggregateCommands();
    return {
      total: cmds.length,
      names: cmds.map((c) => c.name),
    };
  }

  return {
    registerSlash,
    onInteractionCreate,
    installGuild,
    installGlobal,
    removeModule,
    getRegistrySnapshot,
    _debug: { commandsByModule, handlersByModule }
  };
}
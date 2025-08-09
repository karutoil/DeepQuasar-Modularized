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

  // v2: centralized slash/autocomplete router per command name
  const v2Routers = new Map(); // commandName -> { execute?: fn, autocomplete?: Map<option, fn> }

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

  // v2 registration helpers used by builder to attach centralized routes
  function v2RegisterExecute(commandName, fn) {
    let r = v2Routers.get(commandName);
    if (!r) { r = { execute: null, autocomplete: new Map() }; v2Routers.set(commandName, r); }
    r.execute = fn;
    return () => { const cur = v2Routers.get(commandName); if (cur) cur.execute = null; };
  }
  function v2RegisterAutocomplete(commandName, optionName, fn) {
    let r = v2Routers.get(commandName);
    if (!r) { r = { execute: null, autocomplete: new Map() }; v2Routers.set(commandName, r); }
    r.autocomplete.set(optionName, fn);
    return () => { const cur = v2Routers.get(commandName); if (cur) cur.autocomplete.delete(optionName); };
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
        try {
          // DEBUG: Log interaction channel context for troubleshooting
          try {
            const channelId = interaction.channelId;
            const channelType = interaction.channel?.type;
            const channelObjId = interaction.channel?.id;
            logger.debug('[CORE] Interaction Channel Context', {
              channelId,
              channelType,
              channelObjId,
              fullChannel: interaction.channel,
              fullInteraction: {
                id: interaction.id,
                type: interaction.type,
                commandName: interaction.commandName,
                isChatInputCommand: interaction.isChatInputCommand?.(),
                isContextMenuCommand: interaction.isContextMenuCommand?.(),
                options: interaction.options,
                channelId: interaction.channelId
              }
            });
          } catch (err) {
            logger.debug('[CORE] Failed to log interaction channel context:', err);
          }
          // v2: centralized routing first
          if (interaction.isChatInputCommand?.() === true) {
            const name = interaction.commandName;
            const r = v2Routers.get(name);
            if (r?.execute) {
              try { await r.execute(interaction); } catch (err) {
                logger.error(`v2 execute error for /${name}: ${err?.message}`, { stack: err?.stack });
              }
            }
          } else if (interaction.isAutocomplete?.() === true) {
            const name = interaction.commandName;
            const focused = interaction.options.getFocused(true);
            logger.debug(`[AUTOCOMPLETE-DEBUG] v2 centralized router check`, {
              commandName: name,
              focusedOption: focused?.name,
              focusedValue: focused?.value,
              hasV2Router: v2Routers.has(name),
              v2RouterKeys: Array.from(v2Routers.keys()),
              autocompleteHandlers: v2Routers.get(name)?.autocomplete ? Array.from(v2Routers.get(name).autocomplete.keys()) : []
            });
            
            const r = v2Routers.get(name);
            if (r) {
              const fn = r.autocomplete.get(focused?.name);
              if (fn) {
                logger.debug(`[AUTOCOMPLETE-DEBUG] v2 handler found, executing`, {
                  commandName: name,
                  optionName: focused?.name
                });
                try {
                  await fn(interaction);
                  logger.debug(`[AUTOCOMPLETE-DEBUG] v2 handler completed successfully`);
                } catch (err) {
                  logger.error(`v2 autocomplete error for /${name} ${focused?.name}: ${err?.message}`, { stack: err?.stack });
                }
              } else {
                logger.debug(`[AUTOCOMPLETE-DEBUG] No v2 autocomplete handler found`, {
                  commandName: name,
                  optionName: focused?.name,
                  availableHandlers: Array.from(r.autocomplete.keys())
                });
              }
            } else {
              logger.debug(`[AUTOCOMPLETE-DEBUG] No v2 router found for command`, {
                commandName: name,
                allV2Commands: Array.from(v2Routers.keys())
              });
            }
          }

          // Legacy/compat routing
          if (!interaction.isChatInputCommand?.() && !interaction.isContextMenuCommand?.() && !interaction.isAutocomplete?.()) return;
          
          // Add debug logging for legacy autocomplete handlers
          if (interaction.isAutocomplete?.()) {
            logger.debug(`[AUTOCOMPLETE-DEBUG] Legacy handler check`, {
              commandName: interaction.commandName,
              focusedOption: interaction.options?.getFocused?.(true)?.name,
              totalHandlers: allHandlers.size,
              handlerModules: Array.from(handlersByModule.keys())
            });
          }
          
          for (const h of Array.from(allHandlers)) {
            try {
              await h(interaction);
            } catch (err) {
              logger.error(`Interaction handler error: ${err?.message}`, { stack: err?.stack });
            }
          }
        } catch (err) {
          logger.error(`interactionCreate dispatch error: ${err?.message}`, { stack: err?.stack });
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

  // Normalize a command object for comparison with Discord's GET result.
  // Discord GET includes ids/default_member_permissions/dm_permission/version/type/etc.
  // We compare only fields that matter for behavior: name, description, type, options, contexts, integration_types, nsfw, default_member_permissions, dm_permission.
  function normalizeForCompare(cmd) {
    const {
      name,
      description,
      description_localizations,
      type,
      options,
      contexts,
      integration_types,
      nsfw,
      default_member_permissions,
      dm_permission,
    } = cmd || {};

    function stripUndef(obj) {
      if (obj === null || obj === undefined) return obj;
      if (Array.isArray(obj)) {
        return obj.map(stripUndef).filter((v) => v !== undefined);
      }
      if (typeof obj === "object") {
        const out = {};
        for (const k of Object.keys(obj)) {
          const v = stripUndef(obj[k]);
          if (v !== undefined) out[k] = v;
        }
        return out;
      }
      return obj;
    }

    function sortByName(arr) {
      return [...arr].sort((a, b) => String(a?.name ?? "").localeCompare(String(b?.name ?? "")));
    }

    function sortPrimitive(arr) {
      return [...arr].sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
    }

    function normalizeChoices(choices) {
      if (!Array.isArray(choices)) return undefined;
      const mapped = choices.map((c) => {
        const { name, name_localizations, value } = c || {};
        return stripUndef({ name, name_localizations, value });
      });
      const sorted = sortByName(mapped);
      return sorted.length ? sorted : undefined;
    }

    function normalizeOption(opt) {
      if (!opt) return opt;
      const {
        type,
        name,
        name_localizations,
        description,
        description_localizations,
        required,
        choices,
        options,
        channel_types,
        autocomplete,
        min_length,
        max_length,
        min_value,
        max_value,
      } = opt || {};

      const norm = stripUndef({
        type,
        name,
        name_localizations,
        description,
        description_localizations,
        required: required ?? false,
        choices: normalizeChoices(choices),
        options: normalizeOptions(options),
        channel_types: Array.isArray(channel_types) ? sortPrimitive(channel_types) : undefined,
        autocomplete: autocomplete ?? false,
        min_length,
        max_length,
        min_value,
        max_value,
      });
      return norm;
    }

    function normalizeOptions(opts) {
      if (!Array.isArray(opts)) return undefined;
      const mapped = opts.map(normalizeOption);
      const sorted = sortByName(mapped);
      return sorted.length ? sorted : undefined;
    }

    function canonPerm(val) {
      if (val === undefined || val === null) return null;
      try {
        if (typeof val === "string") return val;
        if (typeof val === "number" || typeof val === "bigint") return String(val);
        return String(val);
      } catch {
        return null;
      }
    }

    function canonBool(val, defaultVal = null) {
      if (val === undefined) return defaultVal;
      if (val === null) return null;
      return Boolean(val);
    }

    // Canonicalize contexts/integration_types:
    // Discord may omit these when default. Treat undefined, null, and [] as equivalent.
    const normContextsRaw = Array.isArray(contexts) ? sortPrimitive(contexts) : contexts;
    const normIntegrationTypesRaw = Array.isArray(integration_types) ? sortPrimitive(integration_types) : integration_types;
    const normContexts = (Array.isArray(normContextsRaw) && normContextsRaw.length === 0) ? undefined : normContextsRaw;
    const normIntegrationTypes = (Array.isArray(normIntegrationTypesRaw) && normIntegrationTypesRaw.length === 0) ? undefined : normIntegrationTypesRaw;

    const norm = {
      name,
      description,
      description_localizations,
      type,
      options: normalizeOptions(options),
      contexts: normContexts,
      integration_types: normIntegrationTypes,
      nsfw: nsfw ?? false,
      default_member_permissions: canonPerm(default_member_permissions),
      dm_permission: canonBool(dm_permission, null),
    };

    return stripUndef(norm);
  }

  function deepEqualRelevant(a, b) {
    try {
      return JSON.stringify(normalizeForCompare(a)) === JSON.stringify(normalizeForCompare(b));
    } catch (err) {
      // If normalization or stringify throws, treat as different but don't crash
      return false;
    }
  }

  // Provide a lightweight reason for a mismatch to aid debugging
  function diffReason(a, b) {
    try {
      const A = normalizeForCompare(a);
      const B = normalizeForCompare(b);
      const sa = JSON.stringify(A);
      const sb = JSON.stringify(B);
      if (sa === sb) return null;

      // Top-level key diff
      const keys = new Set([...Object.keys(A || {}), ...Object.keys(B || {})]);
      for (const k of keys) {
        try {
          // When local does not explicitly set contexts/integration_types (non-empty),
          // normalizeForCompare omitted them. So we won't consider them for mismatch reasons either.
          const va = JSON.stringify(A?.[k]);
          const vb = JSON.stringify(B?.[k]);
          if (va !== vb) {
            if (k === "options") {
              const la = Array.isArray(A?.options) ? A.options.length : 0;
              const lb = Array.isArray(B?.options) ? B.options.length : 0;
              return `mismatch at 'options' (len local=${lb}, remote=${la})`;
            }
            return `mismatch at '${k}'`;
          }
        } catch {
          // ignore nested stringify errors and fall through
        }
      }
      return "mismatch (nested)";
    } catch {
      return "mismatch (exception during diff)";
    }
  }

  function buildNameMap(cmds) {
    const map = new Map();
    for (const c of cmds) {
      map.set(c.name, c);
    }
    return map;
  }

  // Existing per-item upsert retained as "diff" strategy
  async function upsertCommands(rest, route, desiredCmds) {
    // Smart deploy: only create/update/remove changed commands
    // 1) Fetch existing commands
    const existing = await fetchExisting(rest, route);
    const existingByName = buildNameMap(existing);
    const desiredByName = buildNameMap(desiredCmds);

    const toCreate = [];
    const toUpdate = [];
    const toDelete = [];

    // Determine creates/updates using relevant-field comparison
    for (const [name, desired] of desiredByName.entries()) {
      const found = existingByName.get(name);
      if (!found) {
        toCreate.push(desired);
      } else {
        if (!deepEqualRelevant(found, desired)) {
          // Guard diffReason so diagnostics never throw
          try {
            const reason = diffReason(found, desired);
            if (reason) logger.info(`Command '${name}' differs: ${reason}`);
          } catch (e) {
            logger.info(`Command '${name}' differs: mismatch (exception during diff)`);
          }
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

    // Short-circuit: if nothing to do, skip making any REST calls
    if (toCreate.length === 0 && toUpdate.length === 0 && toDelete.length === 0) {
      logger.info("No command changes detected; skipping deployment for this route");
      return { created: 0, updated: 0, deleted: 0, skipped: true };
    }

    // Apply operations (or simulate in dry run)
    const dry = isDryRun();
    if (dry) {
      logger.info(`DRY-RUN: would create ${toCreate.length}, update ${toUpdate.length}, delete ${toDelete.length} on route=${route}`);
      if (toCreate.length) logger.info(`DRY-RUN creates: ${toCreate.map(c => c.name).join(", ")}`);
      if (toUpdate.length) logger.info(`DRY-RUN updates: ${toUpdate.map(u => u.body?.name).join(", ")}`);
      if (toDelete.length) logger.info(`DRY-RUN deletes: ${toDelete.length} ids`);
      return { created: 0, updated: 0, deleted: 0, skipped: true, dryRun: true };
    }

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

    return { created: toCreate.length, updated: toUpdate.length, deleted: toDelete.length, skipped: false, dryRun: false };
  }

  // Bulk strategy: single PUT that replaces the entire set
  async function upsertCommandsBulk(rest, route, desiredCmds) {
    const dry = isDryRun();
    const start = Date.now();

    if (dry) {
      logger.info(`DRY-RUN: would BULK PUT ${desiredCmds.length} commands to route=${route}`);
      return { created: 0, updated: 0, deleted: 0, duration: 0, dryRun: true };
    }

    await rest.put(route, { body: desiredCmds });
    const duration = Date.now() - start;
    // We don't get created/updated/deleted counts from Discord on bulk PUT.
    // We'll infer zeroed counts here; delta is logged separately.
    logger.info(`Bulk PUT completed in ${duration}ms (route=${route})`);
    return { created: 0, updated: 0, deleted: 0, duration, dryRun: false };
  }

  function resolveStrategy() {
    // Supports: bulk | diff | auto (defaults to bulk)
    const val = (config.get("COMMAND_DEPLOY_STRATEGY") || "bulk").toString().trim().toLowerCase();
    if (val === "bulk" || val === "diff" || val === "auto") return val;
    return "bulk";
  }

  // Dry-run mode: when true, we will report what would change but perform no REST writes.
  function isDryRun() {
    // Accepts: true/1/yes/on via Config.getBool, or explicit string "true"
    // Env key: COMMANDS_DRY_RUN
    return config.getBool?.("COMMANDS_DRY_RUN", false) === true
      || String(config.get("COMMANDS_DRY_RUN") || "").trim().toLowerCase() === "true";
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

    const strategy = resolveStrategy();
    let result;

    if (strategy === "diff") {
      result = await upsertCommands(rest, route, desired);
      if (result.skipped) {
        const prefix = result.dryRun ? "Guild commands (diff, dry-run)" : "Guild commands (diff)";
        logger.info(`${prefix}: no changes, skipped deployment`);
      } else {
        logger.info(`Guild commands (diff): created=${result.created}, updated=${result.updated}, deleted=${result.deleted}`);
      }
    } else {
      // bulk or auto -> prefer no-op optimization: if no delta, skip PUT
      if (delta.added.length === 0 && delta.updated.length === 0 && delta.removed.length === 0) {
        const dry = isDryRun();
        const prefix = dry ? "Guild commands (bulk, dry-run)" : "Guild commands (bulk)";
        logger.info(`${prefix}: no changes detected; skipping bulk PUT`);
        result = { created: 0, updated: 0, deleted: 0, skipped: true, dryRun: dry };
      } else {
        result = await upsertCommandsBulk(rest, route, desired);
        const prefix = result.dryRun ? "Guild commands (bulk, dry-run)" : "Guild commands (bulk)";
        logger.info(`${prefix}: created=${delta.added.length}, updated=${delta.updated.length}, deleted=${delta.removed.length}`);
      }
    }

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

    const strategy = resolveStrategy();
    let result;

    if (strategy === "diff") {
      result = await upsertCommands(rest, route, desired);
      if (result.skipped) {
        const prefix = result.dryRun ? "Global commands (diff, dry-run)" : "Global commands (diff)";
        logger.info(`${prefix}: no changes, skipped deployment (propagation can take up to 1 hour)`);
      } else {
        const prefix = result.bulkDiff
          ? (result.dryRun ? "Global commands (diff, bulk-dry-run)" : "Global commands (diff, bulk)")
          : "Global commands (diff)";
        logger.info(
          `${prefix}: created=${result.created}, updated=${result.updated}, deleted=${result.deleted} (propagation can take up to 1 hour)`
        );
      }
    } else {
      // bulk or auto -> prefer no-op optimization: if no delta, skip PUT
      if (delta.added.length === 0 && delta.updated.length === 0 && delta.removed.length === 0) {
        const dry = isDryRun();
        const prefix = dry ? "Global commands (bulk, dry-run)" : "Global commands (bulk)";
        logger.info(`${prefix}: no changes detected; skipping bulk PUT (propagation can take up to 1 hour)`);
        result = { created: 0, updated: 0, deleted: 0, skipped: true, dryRun: dry };
      } else {
        result = await upsertCommandsBulk(rest, route, desired);
        const prefix = result.dryRun ? "Global commands (bulk, dry-run)" : "Global commands (bulk)";
        logger.info(
          `${prefix}: created=${delta.added.length}, updated=${delta.updated.length}, deleted=${delta.removed.length} (propagation can take up to 1 hour)`
        );
      }
    }

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
    // v2 APIs for builder wiring
    v2RegisterExecute,
    v2RegisterAutocomplete,
    _debug: { commandsByModule, handlersByModule, v2Routers }
  };
}
# Create a Module (Folder-based, wired via index.js)

This guide explains how to structure a module as a folder with an `index.js` entry that wires handlers, services, and lifecycle concerns together. It replaces the previous single-file example. The pattern mirrors existing modules such as [modules/modlog/index.js](modules/modlog/index.js), [modules/music/index.js](modules/music/index.js), and [modules/autorole/index.js](modules/autorole/index.js).

For a detailed inventory of every function and builder surface exposed to modules by the core, including their purpose, usage, and examples, please refer to [docs/core_functions.md](docs/core_functions.md).

## Prerequisites
- You have a running Discord.js client and the core initialized with `createCore()`.
- You are familiar with the core module context APIs described in this document and in more detail in [docs/core_functions.md](docs/core_functions.md).
- Node 18+ recommended.

## Module Anatomy

- Each module is a folder under `modules/` and exports a default async function from `index.js` (the module entry point).
- `index.js` wires together submodules:
  - `handlers/`: for slash commands, buttons, selects, modals, and event listeners. Each handler file should encapsulate a single command or a cohesive set of interactions, returning a disposer function.
  - `services/`: for persistence, schedulers, and shared business logic.
  - `utils/`: for helpers (optional).
- The entry point checks feature flags, ensures initialization (e.g., DB indexes), registers commands and interactions, sets up events and schedulers, and registers lifecycle disposables for clean unload.

### Example Directory Layout
```
modules/
  example/
    index.js
    handlers/
      hello.js
      demo.js
      events.js
    services/
      settings.js
      jobs.js
    utils/
      formatters.js
    module.env.example
    README.md
```

## Key Ideas
- `index.js` is thin orchestration: import handler/service factories and call them with `ctx`.
- Each handler/service returns a disposer function (`off`/`stop`) or registers its own disposables via `ctx.lifecycle.addDisposable`.
- Feature flags: context config can disable a module without removing code.
- Command registration uses v2 builders or interactions service, consistent with the repository.

## Core Context and Available Functions

Modules receive a `ctx` (context) object via the `init` function, which is created with `core.createModuleContext(moduleName)`. This `ctx` object provides access to all core services and utilities.

The `ctx` object includes: `client`, `logger` (module child), `config`, `bus`, `commands`, `interactions`, `events`, `embed`, `rateLimiter`, `permissions`, `http`, `ids`, `metrics`, `scheduler`, `mongo`, `dsl`, `lifecycle`, `utils`, `t`, `i18n`, `guildConfig`, `errorReporter`, and `v2` (state, builders, `createInteractionCommand`, `InteractionCommandBuilder`, `ui`).

Below is a summary of the key functionalities available through the `ctx` object. For more in-depth details and examples, refer to [docs/core_functions.md](docs/core_functions.md).

### Core Lifecycle and Utilities
- **`core.createCore(client, baseLoggerLevel?)`**: Constructs the entire core service suite. Call once at bot startup.
- **`ctx = core.createModuleContext(moduleName)`**: Produces a module-scoped context. Use this `ctx` for all module registrations.
- **`ctx.lifecycle` helpers**: Track cleanup functions for module hot-reload/unload.
  - `addDisposable(fn)`: Track a cleanup function.
  - `addListener(emitter, event, handler)`: Attach event listener and auto-track removal.
  - `setInterval(fn, ms)` and `setTimeout(fn, ms)`: Tracked timers that automatically clear on `disposeAll()`.
  - `disposeAll()`: Calls all tracked disposables.
- **`ctx.utils`**: General utility helpers.
  - `now()`: Returns an ISO timestamp string.
  - `safeAsync(fn, onError?)`: Runs an async function, catching and logging errors.
- **`ctx.t(key, params?, opts?)`**: Module-scoped translator using `i18n` with module fallback.

### Config
- **`ctx.config.get(key, fallback?)`**: Get environment value.
- **`ctx.config.getBool(key, fallback?)`**: Get boolean environment value.
- **`ctx.config.require([keys])`**: Throws if any required environment variables are missing.
- **`ctx.config.isEnabled(flagName, defaultVal?)`**: Feature flag helper resolving to boolean.

### Logging
- **`ctx.logger`**: A module-scoped logger instance.
- Methods: `info`, `warn`, `error`, `debug`, etc.
- `childLogger(parent, moduleName)`: Attach module metadata for nested loggers.

### Event Bus
- **`ctx.bus.publish(event, payload)`**: Publish an event to the internal bus.
- **`ctx.bus.subscribe(event, handler)`**: Subscribe to an event. Returns a disposer.
- **`ctx.bus.once(event, handler)`**: Subscribe to an event once. Returns a disposer.

### Discord Event Registry
- **`ctx.events.on(moduleName, event, handler)`**: Attach a Discord client event listener. Returns a disposer.
- **`ctx.events.once(moduleName, event, handler)`**: Attach a Discord client event listener once. Returns a disposer.
- **`ctx.events.off(moduleName, event, handler)`**: Remove a specific event handler.
- **`ctx.events.addListener(moduleName, emitter, event, handler, { once? })`**: Generic event listener for any emitter.
- **`ctx.events.removeModule(moduleName)`**: Remove all event listeners for a module.

### Command Handler
- **`ctx.commands.registerSlash(moduleName, ...slashJsonOrBuilders)`**: Register slash and context commands.
- **`ctx.commands.onInteractionCreate(moduleName, handler)`**: Listen for chat input and context menu interactions (legacy compatibility; v2 routers are also active).
- **`ctx.commands.installGuild(guildId)`**: Install commands to a specific guild.
- **`ctx.commands.installGlobal()`**: Install commands globally.
- **`ctx.commands.removeModule(moduleName)`**: Remove commands registered by a module.
- **`ctx.commands.getRegistrySnapshot()`**: Get a snapshot of registered commands.
- **v2 centralized routing (used by `InteractionCommandBuilder` internally)**:
  - `v2RegisterExecute(commandName, fn)`: Register an execute handler for a command.
  - `v2RegisterAutocomplete(commandName, optionName, fn)`: Register an autocomplete handler for a command option.

### Interactions Registry
- **`ctx.interactions.registerButton(moduleName, customId, handler, { prefix? })`**: Register a button interaction handler.
- **`ctx.interactions.registerSelect(moduleName, customId, handler, { prefix? })`**: Register a select menu interaction handler.
- **`ctx.interactions.registerModal(moduleName, customId, handler, { prefix? })`**: Register a modal submission handler.
- **`ctx.interactions.registerUserContext(moduleName, commandName, handler)`**: Register a user context menu handler.
- **`ctx.interactions.registerMessageContext(moduleName, commandName, handler)`**: Register a message context menu handler.
- **`ctx.interactions.removeModule(moduleName)`**: Remove all interaction handlers for a module.

### Embeds
- **`ctx.embed.base(color, opts)`**: Create a base embed with a specified color.
- **`ctx.embed.success(opts)`**: Create a success-themed embed.
- **`ctx.embed.error(opts)`**: Create an error-themed embed.
- **`ctx.embed.info(opts)`**: Create an info-themed embed.
- **`ctx.embed.warn(opts)`**: Create a warning-themed embed.
- **`ctx.embed.neutral(opts)`**: Create a neutral-themed embed.
- `opts` can include: `title`, `description`, `url`, `thumbnail`, `image`, `author`, `fields`, `footerText`, `footerIcon`.

### Permissions
- **`ctx.permissions.hasUserPerms(member, perms)`**: Check if a member has specific permissions.
- **`ctx.permissions.hasBotPerms(guild, perms)`**: Check if the bot has specific permissions in a guild.
- **`ctx.permissions.ensureInteractionPerms(interaction, { userPerms, botPerms })`**: Ensures required permissions before executing a handler, and replies if permissions are insufficient.

### Rate Limiter
- Primarily used via `ctx.dsl.withCooldown`. Refer to `docs/core_functions.md` for direct usage.

### HTTP Client
- **`ctx.http.request(method, url, opts)`**: Make an HTTP request with retries and timeouts.
- **`ctx.http.get(url, opts)`**: Perform a GET request.
- **`ctx.http.post(url, data, opts)`**: Perform a POST request with JSON body.
- **`ctx.http.patch(url, data, opts)`**: Perform a PATCH request with JSON body.
- **`ctx.http.delete(url, opts)`**: Perform a DELETE request.
- `opts` can include: `headers`, `body`, `timeoutMs`, `retries`. Returns `{ ok, status, data, headers }`.

### IDs
- **`ctx.ids.make(moduleName, type, name, extras?)`**: Generate a consistent custom ID string for interactions.
- **`ctx.ids.parse(customId)`**: Parse a custom ID string back into its components.

### DSL Wrappers
- **`ctx.dsl.withTryCatch(handler, { errorMessage? })`**: Wraps a handler in a try/catch block, logging errors and replying with a standard error embed.
- **`ctx.dsl.withDeferredReply(handler, { ephemeral? = true })`**: Ensures `deferReply` is called before the handler executes.
- **`ctx.dsl.withCooldown(handler, { keyFn, capacity = 1, refillPerSec = 1, message? })`**: Applies a token-bucket rate limit.
- **`ctx.dsl.withPerms(handler, { userPerms = [], botPerms = [] })`**: Verifies user and bot permissions before executing the handler.
- **`ctx.dsl.withConfirmation(prompt, handler, { confirmLabel?, cancelLabel?, ephemeral? = true })`**: Presents Confirm/Cancel buttons and invokes the handler on confirmation.
- **`ctx.dsl.withPreconditions(handler, ...preconditions)`**: Applies a series of asynchronous preconditions; if any fail, the handler is blocked.

### Scheduler
- **`ctx.scheduler.schedule(cronExpr, fn, { timezone?, immediate? })`**: Schedule a cron-like recurring job. Returns a `stop()` function.
- **`ctx.scheduler.stopAll()`**: Stop all scheduled jobs.
- **`ctx.scheduler.list()`**: Get the number of active jobs.

### Metrics
- **`ctx.metrics.counter(name)`**: Create a counter metric.
- **`ctx.metrics.gauge(name)`**: Create a gauge metric.
- **`ctx.metrics.timer(name)`**: Create a timer metric.

### Guild Config
- **`ctx.guildConfig.setLocale(guildId, locale)`**: Set the preferred locale for a guild.
- **`ctx.guildConfig.getLocale(guildId)`**: Get the preferred locale for a guild.
- **`ctx.guildConfig.set(guildId, key, value)`**: Set a key-value pair for a guild.
- **`ctx.guildConfig.get(guildId, key, fallback?)`**: Get a value for a guild.

### Internationalization
- **`ctx.i18n`**: The i18n service.
- **`ctx.t()`**: The primary way to translate messages, handling module fallback and locale resolution.

### Error Reporting
- **`ctx.errorReporter.report(error, context?)`**: Logs errors locally and optionally forwards them to Sentry if configured.

### IDs and Builders v2
- **`ctx.v2.createInteractionCommand()` and `new ctx.v2.InteractionCommandBuilder()`**: The v2 builder for defining slash commands and co-located component handlers with scoped custom IDs.
  - Key methods: `setName`, `setDescription`, `setDefaultMemberPermissions`, `addOption` (and typed aliases like `addUserOption`, `addStringOption`, etc.), `onExecute`, `onButton`, `onSelect`, `onModal`, `onAutocomplete`, `addPrecondition`, `toSlashJson()`.
  - **`builder.register(ctx, moduleName, { stateManager? })`**: Registers the command and its handlers. Returns a disposer.
  - Convenience component builders (e.g., `builder.button`, `builder.select`, `builder.userSelect`, `builder.modal`, `builder.textInput`) that auto-scope custom IDs.
- **`ctx.v2.builders`**: A registry to track builders by module.
  - `add(moduleName, builder)`: Add a builder to the registry.
  - `list(moduleName)`: List builders for a module.
  - `clearModule(moduleName)`: Clear all builders for a module.
- **`ctx.v2.state`**: A pluggable interaction state manager with TTL-based cleanup.
  - `forInteraction(interaction, ttlMs?)`: Get a Map-like async facade for interaction-specific state.
  - `withKey(key, ttlMs?)`: Get a Map-like async facade for arbitrary keys.
  - `dispose()`: Dispose of the state manager.

### UI Helpers
Located in `core/ui.js`, these helpers simplify common UI patterns and integrate with the v2 builder for automatic ID scoping and handler registration.
- **`ctx.v2.ui.createPaginatedEmbed(ctx, builder, moduleName, pages, { ephemeral?, initialIndex? })`**: Creates a paginated embed with Previous/Next buttons. Returns `{ message, dispose }`.
- **`ctx.v2.ui.createConfirmationDialog(ctx, builder, moduleName, prompt, onConfirm, onCancel, { ephemeral? })`**: Creates a confirm/cancel dialog. Returns `{ message, dispose }`.
- **`ctx.v2.ui.createMultiSelectMenu(ctx, builder, moduleName, options, onSelect, { placeholder?, maxValues?, ephemeral? })`**: Creates a string select menu. Returns `{ message, dispose }`.
- **`ctx.v2.ui.createUserSelectMenu(...)`, `createRoleSelectMenu(...)`, `createChannelSelectMenu(...)`, `createMentionableSelectMenu(...)`**: Similar to `createMultiSelectMenu` but for specific select menu types.
- **`ctx.v2.ui.createForm(ctx, builder, moduleName, { title, fields })`**: Creates a modal form. Returns `{ modal, message, open, modalId }`.
- **`ctx.v2.ui.parseModal(interaction)`**: Parses submitted modal inputs into a plain object.
- **`ctx.v2.ui.createWizard(ctx, builder, moduleName, state, steps)`**: Creates a multi-step wizard. Returns `{ start, dispose }`.

## Minimal Folderized Module

- Goal: define `/hello` via a dedicated handler and wire it in `index.js`.

### `modules/example/handlers/hello.js`
```js
export function registerHelloCommand(ctx) {
  const moduleName = "example";
  const b = ctx.v2.createInteractionCommand()
    .setName("hello")
    .setDescription("Say hello")
    .onExecute(
      ctx.dsl.withTryCatch(
        ctx.dsl.withDeferredReply(async (i) => {
          const e = ctx.embed.success({ title: "Hello", description: "World" });
          await i.editReply({ embeds: [e] });
        })
      )
    );

  const dispose = ctx.v2.register(b, moduleName);
  ctx.lifecycle.addDisposable(dispose);
  return dispose;
}
```

### `modules/example/index.js`
```js
export default async function init(ctx) {
  const moduleName = "example";
  const { logger, config, lifecycle } = ctx;

  if (!config.isEnabled("MODULE_EXAMPLE_ENABLED", true)) {
    logger.info("[Example] Module disabled via config.");
    return { name: moduleName, description: "Example module (disabled)" };
  }

  // Wire handlers
  const disposers = [];
  try {
    const { registerHelloCommand } = await import("./handlers/hello.js");
    const d = registerHelloCommand(ctx);
    if (typeof d === "function") disposers.push(d);
  } catch (e) {
    logger.error("[Example] Failed to register hello command", { error: e?.message });
  }

  lifecycle.addDisposable(() => {
    for (const d of disposers) {
      try { d?.(); } catch {}
    }
  });

  logger.info("[Example] Module loaded.");
  return {
    name: moduleName,
    description: "Minimal folderized example with a /hello command.",
    dispose: async () => {
      logger.info("[Example] Module unloaded.");
      for (const d of disposers) {
        try { d?.(); } catch {}
      }
    }
  };
}
```

## Wiring Multiple Handlers and UI Components

- Each handler file should encapsulate a single command or a cohesive set of interactions, returning a disposer.

### `modules/example/handlers/demo.js`
```js
export function registerDemoCommand(ctx) {
  const moduleName = "example";

  const b = ctx.v2.createInteractionCommand()
    .setName("demo")
    .setDescription("Demonstration")
    .addStringOption(o => o.setName("q").setDescription("Query"))
    .onExecute(
      ctx.dsl.withTryCatch(
        ctx.dsl.withDeferredReply(async (i) => {
          const pages = [
            { title: "Page 1", description: "..." },
            { title: "Page 2", description: "..." },
          ];
          const { message, dispose } = ctx.v2.ui.createPaginatedEmbed(ctx, b, moduleName, pages);
          await i.editReply(message);
          ctx.lifecycle.addDisposable(dispose);
        })
      )
    )
    .onButton("refresh", async (i) => {
      await i.update({ content: "Refreshed.", components: [] });
    })
    .onSelect("choice", async (i) => {
      await i.update({ content: `Selected: ${i.values?.join(", ")}`, components: [] });
    })
    .onUserSelect("userpick", async (i) => {
      await i.update({ content: `User selected: ${i.values?.join(", ")}`, components: [] });
    })
    .onRoleSelect("rolepick", async (i) => {
      await i.update({ content: `Role selected: ${i.values?.join(", ")}`, components: [] });
    })
    .onChannelSelect("channelpick", async (i) => {
      await i.update({ content: `Channel selected: ${i.values?.join(", ")}`, components: [] });
    })
    .onMentionableSelect("mentionpick", async (i) => {
      await i.update({ content: `Mentionable selected: ${i.values?.join(", ")}`, components: [] });
    })
    .onAutocomplete("q", async (i) => {
      const focused = i.options.getFocused();
      const choices = ["alpha", "beta", "gamma"].filter(x => x.startsWith(focused || ""));
      await i.respond(choices.map(c => ({ name: c, value: c })));
    });

  const dispose = ctx.v2.register(b, moduleName);
  ctx.lifecycle.addDisposable(dispose);
  return dispose;
}
```

### `modules/example/index.js` (wiring multiple)
```js
export default async function init(ctx) {
  const moduleName = "example";
  const { logger, config, lifecycle } = ctx;

  if (!config.isEnabled("MODULE_EXAMPLE_ENABLED", true)) {
    logger.info("[Example] Module disabled via config.");
    return { name: moduleName, description: "Example module (disabled)" };
  }

  const disposers = [];

  // Register commands
  try { const { registerHelloCommand } = await import("./handlers/hello.js"); const d = registerHelloCommand(ctx); if (typeof d === "function") disposers.push(d); } catch (e) { logger.error("[Example] hello failed", { error: e?.message }); }
  try { const { registerDemoCommand } = await import("./handlers/demo.js"); const d = registerDemoCommand(ctx); if (typeof d === "function") disposers.push(d); } catch (e) { logger.error("[Example] demo failed", { error: e?.message }); }

  lifecycle.addDisposable(() => {
    for (const d of disposers) { try { d?.(); } catch {} }
  });

  logger.info("[Example] Module loaded.");
  return {
    name: moduleName,
    description: "Example with multiple commands and UI handlers.",
    dispose: async () => {
      logger.info("[Example] Module unloaded.");
      for (const d of disposers) { try { d?.(); } catch {} }
    }
  };
}
```

## Client Events with Tracked Cleanup

- Use a dedicated handler file to attach events via `ctx.events` and return a disposer.

### `modules/example/handlers/events.js`
```js
export function registerClientEvents(ctx) {
  const moduleName = "example";

  const offReady = ctx.events.once(moduleName, "ready", () => {
    ctx.logger.info("[Example] Ready");
  });

  const offMsgCreate = ctx.events.on(moduleName, "messageCreate", async (msg) => {
    if (msg.content === "!ping") await msg.reply("Pong");
  });

  // Aggregate disposer
  const dispose = () => {
    try { offReady?.(); } catch {}
    try { offMsgCreate?.(); } catch {}
  };

  ctx.lifecycle.addDisposable(dispose);
  return dispose;
}
```

## Background Jobs and Services

- Put recurring tasks, DB access, and shared logic in `services/`.

### `modules/example/services/jobs.js`
```js
export function startFiveMinuteJob(ctx) {
  const stop = ctx.scheduler.schedule("*/5 * * * *", async () => {
    ctx.logger.info("[Example] 5-minute job ran");
  }, { immediate: true });

  ctx.lifecycle.addDisposable(stop);
  return stop;
}
```

### `modules/example/services/settings.js`
```js
export async function ensureIndexes(ctx) {
  // Example: setup collection indexes
  const db = await ctx.mongo.getDb();
  await db.collection("example_settings").createIndex({ guildId: 1 }, { unique: true });
}
```

### `modules/example/index.js` (wiring services and events)
```js
export default async function init(ctx) {
  const moduleName = "example";
  const { logger, config, lifecycle } = ctx;

  if (!config.isEnabled("MODULE_EXAMPLE_ENABLED", true)) {
    logger.info("[Example] Module disabled via config.");
    return { name: moduleName, description: "Example module (disabled)" };
  }

  const disposers = [];

  // Ensure DB indexes
  try { const { ensureIndexes } = await import("./services/settings.js"); await ensureIndexes(ctx); } catch (e) { logger.warn("[Example] ensureIndexes failed", { error: e?.message }); }

  // Register commands
  try { const { registerHelloCommand } = await import("./handlers/hello.js"); const d = registerHelloCommand(ctx); if (typeof d === "function") disposers.push(d); } catch (e) { logger.error("[Example] hello failed", { error: e?.message }); }

  // Register events
  try { const { registerClientEvents } = await import("./handlers/events.js"); const d = registerClientEvents(ctx); if (typeof d === "function") disposers.push(d); } catch (e) { logger.error("[Example] events failed", { error: e?.message }); }

  // Start scheduler jobs
  try { const { startFiveMinuteJob } = await import("./services/jobs.js"); const stop = startFiveMinuteJob(ctx); if (typeof stop === "function") disposers.push(stop); } catch (e) { logger.error("[Example] jobs failed", { error: e?.message }); }

  lifecycle.addDisposable(() => { for (const d of disposers) { try { d?.(); } catch {} } });

  logger.info("[Example] Module loaded.");
  return {
    name: moduleName,
    description: "Example module with services, events, and scheduled jobs.",
    dispose: async () => {
      logger.info("[Example] Module unloaded.");
      for (const d of disposers) { try { d?.(); } catch {} }
    }
  };
}
```

## Permissions, Rates, Preconditions

- Apply DSL wrappers and permission checks inside each handler file for separation of concerns, similar to the single-file examples, but isolated per handler.

## HTTP Calls with Retries and Timeouts

- Use `ctx.http` inside handlers/services; ensure error handling is local to the file to keep `index.js` focused on wiring.

## Command Registration Patterns

- **v2 builder path (recommended for slash commands and select menus):**
  - Build with `ctx.v2.createInteractionCommand()`
  - Use builder helpers for select menus:
    - `.onSelect("choice", handler)`
    - `.onUserSelect("userpick", handler)`
    - `.onRoleSelect("rolepick", handler)`
    - `.onChannelSelect("channelpick", handler)`
    - `.onMentionableSelect("mentionpick", handler)`
  - Register via `ctx.v2.register(builder, moduleName)`
  - Capture returned disposer and add to `ctx.lifecycle`
- **interactions service path (for buttons/selects with customId prefixes):**
  - Use `ctx.interactions.registerButton(moduleName, "prefix:", handler, { prefix: true })`
  - Use `ctx.interactions.registerSelect(moduleName, "prefix:", handler, { prefix: true })` for custom select menus
  - Store disposer or add to lifecycle immediately

See [modules/modlog/index.js](modules/modlog/index.js) for a complete example using a single top-level command with subcommands and autocomplete wired to separate handlers.

## Deploying Commands to Discord

- Commands register into a registry; deploy at startup or when modules load:
  - Guild install: `ctx.commands.installGuild(guildId)`
  - Global install: `ctx.commands.installGlobal()`
- Configuration (via env, see [core/config.js](core/config.js)):
  - `COMMAND_DEPLOY_STRATEGY`: `bulk` | `diff` | `auto` (default `bulk`)
  - `COMMANDS_DRY_RUN`: `true`/`false`

### Example Startup Integration (root `index.js`)
```js
import { Client, GatewayIntentBits } from "discord.js";
import { createCore } from "./core/index.js";
import Example from "./modules/example/index.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});
const core = createCore(client);

client.once("ready", async () => {
  const ctx = core; // Repository modules accept the core context directly
  await Example(ctx);

  // Deploy commands
  const guildId = process.env.GUILD_ID;
  if (guildId) await ctx.commands.installGuild(guildId);
  else await ctx.commands.installGlobal();

  ctx.logger.info("[Startup] Example module installed");
});

client.login(process.env.DISCORD_TOKEN);
```

## Module Initialization and Bot Readiness

Modules are designed to be loaded and initialized once the Discord client is ready. This ensures that all necessary Discord API connections are established and the bot is fully operational before your module attempts to register commands, set up event listeners, or interact with Discord resources.

**Example (from root `index.js`):**

```js
import { Client, GatewayIntentBits } from "discord.js";
import { createCore } from "./core/index.js";
import MyModule from "./modules/my-module/index.js"; // Your module's entry point

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});
const core = createCore(client);

client.once("ready", async () => {
  const ctx = core; // The core context is passed to your module

  // Initialize your module after the bot is ready
  await MyModule(ctx);

  // Perform other actions that require the bot to be ready, e.g., deploying commands
  const guildId = process.env.GUILD_ID;
  if (guildId) await ctx.commands.installGuild(guildId);
  else await ctx.commands.installGlobal();

  ctx.logger.info("[Startup] MyModule installed and bot is ready.");
});

client.login(process.env.DISCORD_TOKEN);
```

By calling `await MyModule(ctx);` inside the `client.once("ready", ...)` block, you guarantee that any setup, command registration, or event listener attachment within your module's `init` function (and subsequently, its handlers and services) only occurs after the bot has successfully connected to Discord.

## Loading and Unloading Modules

- **Loading**
  - Create or use the core context (many modules in this repo accept core context directly).
  - Call the module’s default export; it registers commands, interactions, events.
  - Add disposers to `ctx.lifecycle` to ensure clean unloads.
- **Unloading (hot-reload or shutdown)**
  - Call the returned `dispose` function from the module or use `ctx.lifecycle.disposeAll()`.
  - If you used `ctx.interactions` with module scoping, you can call `ctx.interactions.removeModule("moduleName")` for safety.
  - `v2.register` returns a disposer; store it or register in lifecycle immediately.

### Common Pattern
```js
export default async function init(ctx) {
  const moduleName = "my-module";
  const { lifecycle, logger } = ctx;

  const disposers = [];

  // Commands
  // const disposeCmd = ctx.v2.register(builder, moduleName);
  // disposers.push(disposeCmd);

  // Events
  // const disposeEvt = ctx.events.on(moduleName, "guildCreate", (g) => logger.info(`Joined guild ${g.id}`));
  // disposers.push(disposeEvt);

  // Schedule
  // const stopJob = ctx.scheduler.schedule("0 * * * *", async () => { /* hourly */ });
  // disposers.push(stopJob);

  lifecycle.addDisposable(() => {
    for (const d of disposers) { try { d?.(); } catch {} }
  });

  return {
    name: moduleName,
    description: "My module.",
    dispose: async () => {
      logger.info(`[${moduleName}] Module unloaded.`);
      for (const d of disposers) { try { d?.(); } catch {} }
    }
  };
}
```

## Scaffolding a New Folder-Based Module

If available, use [bin/scaffold-module.js](bin/scaffold-module.js) to bootstrap a module folder with `index.js`, `handlers/`, and `services/`. Otherwise:

- Create `modules/your-module/index.js` and export a default async function that wires handlers/services.
- Place commands in `modules/your-module/handlers/*.js` exporting `registerXxx(ctx)` functions that call `ctx.v2.register` or `ctx.interactions.registerX`.
- Place persistence, schedulers, and shared logic in `modules/your-module/services/*.js` exporting `ensureIndexes`/`startXxx(ctx)`.
- In your app startup, import the module and call it with the core context.

## Troubleshooting Tips

- **Component handler not firing?** Ensure `customId` and prefix scoping match. v2 builder helpers and UI helpers scope IDs automatically by module and command.
- **Select menu parity:** user, role, channel, and mentionable select IDs are mapped and scoped internally; ensure you use the correct builder helper (e.g., `.onUserSelect`, `.onRoleSelect`, etc.) or registration method for your select menu type.
- **Command changes not appearing?**
  - Global installs can take up to 1 hour to propagate.
  - Use `COMMANDS_DRY_RUN` or set deploy strategy to "diff" for diagnostics.
- Always add disposers (`off`/`stop`) to `ctx.lifecycle` to guarantee clean unloads.

## References in this Repository

- Folder-wired, single-command with subcommands and autocomplete: [modules/modlog/index.js](modules/modlog/index.js)
- Folder-wired, multiple commands and events with services: [modules/music/index.js](modules/music/index.js)
- Folder-wired, DB indexes, events, and timers: [modules/autorole/index.js](modules/autorole/index.js)
- Complex module with many handlers and services: [modules/tickets/index.js](modules/tickets/index.js)

## Why this design

- Clear separation of concerns (commands, interactions, events, UI, DSL).
- Strong module isolation and lifecycle cleanup to support hot-reload/unload.
- Opinionated helpers (DSL, UI, embeds, ids) to minimize repetitive boilerplate.
- Extensible v2 builder co-locates command logic with components and autocomplete.

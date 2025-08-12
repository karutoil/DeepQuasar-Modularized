# Core functions available to modules

This document inventories every function and builder surface exposed to modules by the core. For each, you will find:
- What it is
- How to use it
- Why/when to use it
- Example usage snippets

Modules receive these via the module context created with core.createModuleContext(moduleName). Many factories are already constructed and injected into the context (client, logger, config, bus, commands, interactions, events, embed, rateLimiter, permissions, http, ids, metrics, scheduler, mongo, dsl, lifecycle, utils, t, i18n, guildConfig, errorReporter, and v2 features).

Navigation
- Core creation and module context: createCore(), createModuleContext()
- Logging: createLogger(), childLogger()
- Config: createConfig()
- Event bus: createBus()
- Command handling: createCommandHandler()
- Interactions registry: createInteractions()
- Events registry: createEvents()
- Embeds: createEmbed()
- Permissions: createPermissions()
- Rate limiter: createRateLimiter()
- HTTP client: createHttp()
- IDs: createIds()
- DSL wrappers: createDsl()
- Scheduler: createScheduler()
- Metrics: createMetrics()
- Mongo access: createMongo() [factory exists; usage depends on file, not documented here]
- i18n: createI18n()
- Guild config: createGuildConfig()
- Error reporting: createErrorReporter()
- v2 Builders and UI:
  - createInteractionCommand(), new InteractionCommandBuilder()
  - createBuilderRegistry()
  - ui.createPaginatedEmbed(), ui.createConfirmationDialog(), ui.createMultiSelectMenu(), createForm(), parseModal(), createWizard()
- State manager: createStateManager()

Note: Snippets assume you are inside a module’s setup function receiving ctx = core.createModuleContext("your-module").



Core lifecycle and utilities from createCore() and createModuleContext()

1) core.createCore(client, baseLoggerLevel?)
- What: Constructs the entire core service suite and returns an object with all services and a createModuleContext(moduleName) helper.
- How: Call once at bot startup with a Discord.js client.
- Why: Establishes shared infra (logging, config, registries, schedulers, i18n, etc.).
- Example:
  const core = createCore(client);
  const ctx = core.createModuleContext("example");

2) ctx = core.createModuleContext(moduleName)
- What: Produces a module-scoped context including:
  client, logger (module child), config, bus, commands, interactions, events, embed, rateLimiter, permissions, http, ids, metrics, scheduler, mongo, dsl, lifecycle, utils, t, i18n, guildConfig, errorReporter, v2 (state, builders, createInteractionCommand, InteractionCommandBuilder, ui).
- How: Use the returned ctx for all module registrations.
- Why: Ensures isolation, cleanup, and consistent logging.

3) ctx.lifecycle helpers
Source: createLifecycle() in core/index.js:27
- addDisposable(fn)
  - What: Track a cleanup function for module hot-reload/unload.
  - How: const off = something(); ctx.lifecycle.addDisposable(off);
  - Why: Ensures proper cleanup.
- addListener(emitter, event, handler)
  - What: Attach event listener and auto-track removal.
  - Example: const off = ctx.lifecycle.addListener(client, "ready", () => {});
- setInterval(fn, ms) and setTimeout(fn, ms)
  - What: Tracked timers that automatically clear on disposeAll().
- disposeAll()
  - What: Calls all tracked disposables.

4) ctx.utils
Source: createUtils() in core/index.js:80
- now()
  - What: ISO timestamp string.
- safeAsync(fn, onError?)
  - What: Run async fn catching/logging errors; optional onError(err).
  - Why: Prevents unhandled exceptions in background tasks.

5) ctx.t(key, params?, opts?)
- What: Module-scoped translator using i18n with module fallback.
- How: const text = ctx.t("my.key", { name: user.username }, { guildId, userLocale });
- Why: Localized messages consistently across modules.



Config

createConfig() -> Config in core/config.js:52
- ctx.config.get(key, fallback?)
  - What: Get environment value.
- ctx.config.getBool(key, fallback?)
  - What: Get boolean env using common true/false strings.
- ctx.config.require([keys])
  - What: Throw if any required environment variables are missing.
- ctx.config.isEnabled(flagName, defaultVal?)
  - What: Feature flag helper resolving to boolean.

Why: Standardize env access and validation across modules.

Example:
const apiUrl = ctx.config.get("MY_API_URL");
if (!ctx.config.isEnabled("MY_FEATURE")) return;



Logging

createLogger(level?), childLogger(parent, moduleName) in core/logger.js
- ctx.logger (child) is already provided by createModuleContext().
- logger methods: info, warn, error, debug, etc.
- childLogger(parent, moduleName): attach module metadata when you need nested loggers.

Why: Consistent, structured logging.

Example:
ctx.logger.info("Starting module");
const apiLog = childLogger(ctx.logger, "api");
apiLog.debug("fetching", { url });



Event Bus

createBus(logger) in core/bus.js
- ctx.bus.publish(event, payload)
- ctx.bus.subscribe(event, handler) -> off()
- ctx.bus.once(event, handler) -> off()

Why: Decouple internal module events, broadcast domain signals.

Example:
const off = ctx.bus.subscribe("tickets:new", async (ticket) => { /* ... */ });
ctx.lifecycle.addDisposable(off);
ctx.bus.publish("tickets:new", { id: 123 });



Discord Event Registry

createEvents(client, logger) in core/events.js
- ctx.events.on(moduleName, event, handler) -> off()
- ctx.events.once(moduleName, event, handler) -> off()
- ctx.events.off(moduleName, event, handler)
- ctx.events.addListener(moduleName, emitter, event, handler, { once? })
- ctx.events.removeModule(moduleName)

Why: Attach Discord client or custom emitter events with cleanup.

Example:
const offReady = ctx.events.once("my-module", "ready", () => ctx.logger.info("Ready!"));
ctx.lifecycle.addDisposable(offReady);



Command Handler

createCommandHandler(client, logger, config) in core/commandHandler.js
- ctx.commands.registerSlash(moduleName, ...slashJsonOrBuilders)
  - Register slash and context commands (JSON or SlashCommandBuilder JSON).
- ctx.commands.onInteractionCreate(moduleName, handler) -> off()
  - Listen for chat input and context menu interactions (legacy compat; v2 routers also active).
- ctx.commands.installGuild(guildId)
- ctx.commands.installGlobal()
- ctx.commands.removeModule(moduleName)
- ctx.commands.getRegistrySnapshot()
- v2 centralized routing (used by InteractionCommandBuilder internally)
  - v2RegisterExecute(commandName, fn) -> off()
  - v2RegisterAutocomplete(commandName, optionName, fn) -> off()

Why: Install and route slash/ctx commands reliably, with diff/bulk strategies and dry-run.

Example (manual JSON):
ctx.commands.registerSlash("my-module", { name: "ping", description: "Ping" });
const off = ctx.commands.onInteractionCreate("my-module", async (i) => {
  if (i.isChatInputCommand?.() && i.commandName === "ping") {
    await i.reply("Pong");
  }
});
ctx.lifecycle.addDisposable(off);



Interactions Registry

createInteractions(client, logger) in core/interactions.js
- Register handlers:
  - ctx.interactions.registerButton(moduleName, customId, handler, { prefix? }) -> off()
  - ctx.interactions.registerSelect(moduleName, customId, handler, { prefix? }) -> off()
  - ctx.interactions.registerModal(moduleName, customId, handler, { prefix? }) -> off()
  - ctx.interactions.registerUserContext(moduleName, commandName, handler) -> off()
  - ctx.interactions.registerMessageContext(moduleName, commandName, handler) -> off()
- ctx.interactions.removeModule(moduleName)

Why: Centralized routing of components and context menus, with optional prefix matching for dynamic customIds.

Example:
const off = ctx.interactions.registerButton("my-module", "my-module:btn:save", async (i) => {
  await i.update({ content: "Saved", components: [] });
});
ctx.lifecycle.addDisposable(off);



Embeds

createEmbed(config) in core/embed.js
- ctx.embed.base(color, opts)
- ctx.embed.success(opts)
- ctx.embed.error(opts)
- ctx.embed.info(opts)
- ctx.embed.warn(opts)
- ctx.embed.neutral(opts)

Opts: { title, description, url, thumbnail, image, author, fields, footerText, footerIcon }

Why: Consistent theming and ergonomics for embeds.

Example:
const e = ctx.embed.success({ title: "Done", description: "Operation successful." });
await interaction.reply({ embeds: [e], ephemeral: true });



Permissions

createPermissions(embed, logger) in core/permissions.js
- ctx.permissions.hasUserPerms(member, perms)
- ctx.permissions.hasBotPerms(guild, perms)
- ctx.permissions.ensureInteractionPerms(interaction, { userPerms, botPerms }) -> Promise<boolean>

Why: Gate handlers on required permissions and auto-inform users/bot insufficiency.

Example:
const ok = await ctx.permissions.ensureInteractionPerms(i, { userPerms: ["ManageGuild"] });
if (!ok) return;
// proceed



Rate Limiter

createRateLimiter(logger) is constructed in core/index.js and used by DSL. Typical module usage is via DSL withCooldown; direct usage follows its own API from core/rateLimiter.js (not shown here). Prefer DSL withCooldown unless you need low-level control.



HTTP Client

createHttp(config, logger) in core/http.js
- ctx.http.request(method, url, opts)
- ctx.http.get(url, opts)
- ctx.http.post(url, data, opts)
- ctx.http.patch(url, data, opts)
- ctx.http.delete(url, opts)

Opts: { headers, body, timeoutMs, retries }. Returns { ok, status, data, headers }.

Why: Typed JSON convenience with retries, timeouts, and logging.

Example:
const res = await ctx.http.get("https://api.example.com/items");
if (!res.ok) return;
await interaction.reply(`Items: ${JSON.stringify(res.data)}`);



IDs

createIds() in core/ids.js
- ctx.ids.make(moduleName, type, name, extras?) -> customId string
- ctx.ids.parse(customId) -> { module, type, name, extras }

Why: Consistent customId shape for interactions and debugging.

Example:
const id = ctx.ids.make("my-module", "btn", "save", { page: 2 });
// later:
const parsed = ctx.ids.parse(id); // { module: "my-module", type: "btn", name: "save", extras: { page: "2" } }



DSL Wrappers

createDsl({ logger, embed, rateLimiter, permissions, errorReporter, i18n }) in core/dsl.js
- withTryCatch(handler, { errorMessage? })
  - Wraps handler in try/catch, logs and replies with a standard error embed.
- withDeferredReply(handler, { ephemeral? = true })
  - Ensures deferReply before running your handler.
- withCooldown(handler, { keyFn, capacity = 1, refillPerSec = 1, message? })
  - Token-bucket rate limit by interaction/user key.
- withPerms(handler, { userPerms = [], botPerms = [] })
  - Verifies permissions before executing.
- withConfirmation(prompt, handler, { confirmLabel?, cancelLabel?, ephemeral? = true })
  - Presents Confirm/Cancel components; invokes handler on confirm.
- withPreconditions(handler, ...preconditions)
  - Each precondition async (interaction) => boolean|string. Returns if blocked; otherwise runs handler.

Why: Compose consistent policies with minimal boilerplate.

Examples:
const handler = ctx.dsl.withTryCatch(
  ctx.dsl.withDeferredReply(async (i) => {
    await i.editReply("Work done");
  })
);

const guarded = ctx.dsl.withPerms(async (i) => { /* ... */ }, { userPerms: ["ManageGuild"] });



Scheduler

createScheduler(logger) in core/scheduler.js
- ctx.scheduler.schedule(cronExpr, fn, { timezone?, immediate? }) -> stop()
- ctx.scheduler.stopAll()
- ctx.scheduler.list() -> number active jobs

Why: Cron-like recurring jobs with logging and tracked cleanup.

Example:
const stop = ctx.scheduler.schedule("*/5 * * * *", async () => {
  ctx.logger.info("5-minute task running");
}, { immediate: true });
ctx.lifecycle.addDisposable(stop);



Metrics

createMetrics(logger) in core/metrics.js
- ctx.metrics.counter(name) -> { inc(n?), get(), reset() }
- ctx.metrics.gauge(name) -> { set(v), add(n?), sub(n?), get(), reset() }
- ctx.metrics.timer(name) -> { start(), stop(log?), withTiming(asyncFn, { logResult? }) }

Why: Lightweight instrumentation without external dependencies.

Example:
const t = ctx.metrics.timer("heavyTask");
t.start();
await doWork();
const ms = t.stop(true);

### Encryption

`crypto` in `core/crypto.js`

- `ctx.crypto.encrypt(text)`
  - What: Encrypts a given string using AES-256-GCM.
  - How: `const encryptedData = ctx.crypto.encrypt("my secret data");`
  - Why: Securely store sensitive data in the database or other persistent storage.
- `ctx.crypto.decrypt(encryptedText)`
  - What: Decrypts a previously encrypted string.
  - How: `const decryptedData = ctx.crypto.decrypt(encryptedData);`
  - Why: Retrieve and use sensitive data that was encrypted.

Example:

```javascript
const sensitiveData = "This is a secret message.";
const encrypted = ctx.crypto.encrypt(sensitiveData);
console.log("Encrypted:", encrypted);

const decrypted = ctx.crypto.decrypt(encrypted);
console.log("Decrypted:", decrypted);
```



Guild Config

createGuildConfig({ mongo, logger, config }) in core/guildConfig.js
- ctx.guildConfig.setLocale(guildId, locale)
- ctx.guildConfig.getLocale(guildId)
- ctx.guildConfig.set(guildId, key, value)
- ctx.guildConfig.get(guildId, key, fallback?)

Why: Store per-guild settings and locale preferences without full persistence layer.

Example:
ctx.guildConfig.setLocale(i.guildId, "en-US");
const theme = ctx.guildConfig.get(i.guildId, "theme", "default");



Internationalization

createI18n({ config, logger }) is constructed in core/index.js and exposed via ctx.i18n and the convenience ctx.t(key, params, opts).
- Use ctx.t() as your primary access.
- If needed, ctx.i18n.resolveLocale and ctx.i18n.t may be available based on the i18n implementation (not shown here).



Error Reporting

createErrorReporter({ config, logger }) in core/reporting.js
- ctx.errorReporter.report(error, context?)
  - Logs locally, which are then forwarded to Grafana Loki if configured.

Why: Centralized error capture with contextual metadata.

Example:
try {
  // ...
} catch (err) {
  await ctx.errorReporter.report(err, { scope: "my-module", op: "refresh" });
}



IDs and Builders v2

Interaction Command Builder API in core/builders.js

A. createInteractionCommand() and new InteractionCommandBuilder()
- What: v2 builder that defines a slash command and co-located component handlers with scoped customIds.
- Core methods:
  - setName(name)
  - setDescription(desc)
  - setDefaultMemberPermissions(perm)
  - addOption(fn) and typed aliases:
    - addUserOption(fn), addStringOption(fn), addIntegerOption(fn), addNumberOption(fn),
      addBooleanOption(fn), addChannelOption(fn), addRoleOption(fn),
      addMentionableOption(fn), addAttachmentOption(fn)
  - onExecute(handler)
  - onButton(localName, handler)
  - onSelect(localName, handler)
  - onModal(localName, handler)
  - onAutocomplete(optionName, handler)
  - addPrecondition(fn) where fn is async (interaction) => boolean|string
  - toSlashJson() -> command JSON
  - register(ctx, moduleName, { stateManager? }) -> { off }
    - Registers slash JSON, routes execute/autocomplete, and registers component handlers with scoped IDs.
  - Convenience component builders that auto-scope customId:
    - button(ctx, moduleName, localName, label, style?, extras?)
    - select(ctx, moduleName, localName, placeholder?, options?)
    - userSelect(ctx, moduleName, localName, { placeholder?, minValues?, maxValues? })
    - roleSelect(ctx, moduleName, localName, { placeholder?, minValues?, maxValues? })
    - channelSelect(ctx, moduleName, localName, { placeholder?, minValues?, maxValues?, channelTypes? })
    - mentionableSelect(ctx, moduleName, localName, { placeholder?, minValues?, maxValues? })
    - modal(ctx, moduleName, localName, title)
    - textInput(customId, label, style?, required?)

Why: Co-locate all interaction pieces of a command for maintainability and automatic ID scoping.

Example:
const b = ctx.v2.createInteractionCommand()
  .setName("hello")
  .setDescription("Say hello")
  .onExecute(async (i) => {
    await i.reply("Hello!");
  })
  .onButton("wave", async (i) => {
    await i.update({ content: "o/" });
  });

const off = b.register(ctx, "my-module", { stateManager: ctx.v2.state });
ctx.lifecycle.addDisposable(off);

B. createBuilderRegistry()
- registry = ctx.v2.builders
- registry.add(moduleName, builder) -> unregister()
- registry.list(moduleName) -> builder[]
- registry.clearModule(moduleName)

Why: Track builders by module for install/migration flows.

C. State Manager for v2 builders
createStateManager(logger, { provider?, options? }) in core/state.js
- ctx.v2.state is provided in module context.
- High-level:
  - state.forInteraction(interaction, ttlMs?) -> Map-like async facade { get, set, has, delete, clear, keys, values, entries }
  - state.withKey(key, ttlMs?) -> same API bound to arbitrary key
  - state.dispose()
  - kind: "memory" | "file" | "mongo"

Why: Maintain step state across component interactions and modals.

Example:
const state = ctx.v2.state.forInteraction(i);
await state.set("page", 0);
const page = await state.get("page");



UI Helpers

Located in core/ui.js

- createPaginatedEmbed(ctx, builder, moduleName, pages, { ephemeral?, initialIndex? })
  - Returns { message, dispose }
  - message is a payload ready for reply/update
  - Registers Previous/Next button handlers
  - Why: Quick pagination for multi-page content
  - Example:
    const { message, dispose } = ctx.v2.ui.createPaginatedEmbed(ctx, b, "my-module", [
      { title: "Page 1", description: "..." },
      { title: "Page 2", description: "..." },
    ]);
    await interaction.reply(message);
    ctx.lifecycle.addDisposable(dispose);

- createConfirmationDialog(ctx, builder, moduleName, prompt, onConfirm, onCancel, { ephemeral? })
  - Returns { message, dispose }
  - Why: Reusable confirm/cancel flow with scoped buttons.

- createMultiSelectMenu(ctx, builder, moduleName, options, onSelect, { placeholder?, maxValues?, ephemeral? })
  - Returns { message, dispose }
  - Why: Simplify select menus with routing.
- createUserSelectMenu(ctx, builder, moduleName, onSelect, { placeholder?, minValues?, maxValues?, ephemeral? })
  - Returns { message, dispose }
  - Why: User selection with automatic routing.
- createRoleSelectMenu(ctx, builder, moduleName, onSelect, { placeholder?, minValues?, maxValues?, ephemeral? })
  - Returns { message, dispose }
  - Why: Role selection with automatic routing.
- createChannelSelectMenu(ctx, builder, moduleName, onSelect, { placeholder?, minValues?, maxValues?, channelTypes?, ephemeral? })
  - Returns { message, dispose }
  - Why: Channel selection with automatic routing.
- createMentionableSelectMenu(ctx, builder, moduleName, onSelect, { placeholder?, minValues?, maxValues?, ephemeral? })
  - Returns { message, dispose }
  - Why: Mentionable selection with automatic routing.

- createForm(ctx, builder, moduleName, { title, fields })
  - Returns { modal, message, open, modalId }
  - Why: Quickly build and open a modal form.
  - Combine with parseModal() to read submitted values.

- parseModal(interaction)
  - Parses submitted modal interaction into a plain object keyed by field name.

- createWizard(ctx, builder, moduleName, state, steps)
  - Returns { start, dispose }
  - Steps: [{ render: s => payload, onNext?: (interaction, state) }]
  - Why: Multi-step flows with Next/Cancel and state persistence.



Command Installation Utilities

From ctx.commands:
- installGuild(guildId): Install current registry to a guild.
- installGlobal(): Install globally.
- Strategy controlled via env:
  - COMMAND_DEPLOY_STRATEGY: bulk | diff | auto (default bulk)
  - COMMANDS_DRY_RUN: true/false



Internationalization Convenience

From ctx.i18n and ctx.t():
- Prefer ctx.t for translating messages in your module; it handles module fallback and locale resolution.



Mongo and other services

createMongo() exists and is wired in core/index.js, but its detailed API is not included in the scanned files. If your module needs DB access, consult core/mongo.js for the exact API. The state manager also offers an optional Mongo provider via options.mongo. Use ctx.v2.state if you need persisted state for interactions.



Complete example: a minimal v2 command with DSL and UI

```js
import { createInteractionCommand } from "core";

export function setup(ctx) {
  const b = ctx.v2.createInteractionCommand()
    .setName("demo")
    .setDescription("Demonstration")
    .addStringOption(opt => opt.setName("q").setDescription("Query"))
    .onExecute(ctx.dsl.withTryCatch(
      ctx.dsl.withDeferredReply(async (i) => {
        const args = i.options.getString("q");
        const pages = [
          { title: "Result 1", description: String(args ?? "") },
          { title: "Result 2", description: "More..." },
        ];
        const { message, dispose } = ctx.v2.ui.createPaginatedEmbed(ctx, b, "my-module", pages);
        await i.editReply(message);
        ctx.lifecycle.addDisposable(dispose);
      })
    ))
    .onButton("refresh", async (i) => {
      await i.update({ content: "Refreshed." });
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
    });

  const off = b.register(ctx, "my-module", { stateManager: ctx.v2.state });
  ctx.lifecycle.addDisposable(off);
}
```



Why this design

- Clear separation of concerns (commands, interactions, events, UI, DSL).
- Strong module isolation and lifecycle cleanup to support hot-reload/unload.
- Opinionated helpers (DSL, UI, embeds, ids) to minimize repetitive boilerplate.
- Extensible v2 builder co-locates command logic with components and autocomplete.
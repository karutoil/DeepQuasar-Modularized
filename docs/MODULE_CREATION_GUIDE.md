# Module Creation Guide

This guide explains how to build, load, and maintain modules in this repository. It consolidates the essentials from the existing documentation and points you to deeper references when needed.

- For a focused, step-by-step creation walkthrough, see `docs/create_a_module.md`.
- For a comprehensive list of all core APIs available to modules (with examples), see `docs/core_functions.md`.
- For logging conventions and Grafana Loki usage, see `docs/logging_best_practices.md`.

## What is a module?

- A module is a folder under `modules/` with an entry file `index.js` (ESM) or `index.cjs` (CJS) that exports a default async function `init(ctx)`.
- The root loader discovers modules and dynamically imports them at startup (and on file changes for hot-reload).
- The loader passes a module-scoped `ctx` (module context) created via `core.createModuleContext(moduleName)`, which exposes core services (commands, interactions, events, embeds, DSL, UI, state, scheduler, HTTP, Mongo, i18n, logging, etc.).
- If your module returns an object from `init(ctx)` with a `postReady(ctx)` function, it will be called after the Discord client is ready. If it returns `dispose()`, it will be invoked on unload/hot-reload/shutdown.

## Quick start

1) Scaffold a module (recommended)

- With npm script:
```bash
npm run scaffold your-module
```
- Or directly:
```bash
node bin/scaffold-module.js your-module
```

This creates `modules/your-module/` with `index.js`, a `.env` example, and optional snippets. It also prints the feature flag you can use to enable/disable the module.

2) Enable the module via feature flag

Add to your `.env` (replace name accordingly):
```bash
MODULE_YOUR_MODULE_ENABLED=true
```

3) Start the bot
```bash
npm run dev
```
The loader imports your module, calls its `init(ctx)`, registers handlers, and installs commands on ready.

## Recommended layout

```
modules/
  your-module/
    index.js            # Entry: orchestrates handlers/services and returns { name, description, postReady?, dispose? }
    handlers/           # Slash commands, buttons/selects/modals, context menus, client event listeners
      your-command.js
      events.js
    services/           # Persistence, schedulers, cross-cutting logic (e.g., ensureIndexes, jobs)
      settings.js
      jobs.js
    utils/              # Optional helpers
    module.env.example  # Feature flag template
    README.md           # Module-local notes
```

See more structure details and samples in `docs/create_a_module.md`.

## Module entry: shape and lifecycle

Minimal `modules/your-module/index.js`:
```javascript
export default async function init(ctx) {
  const moduleName = "your-module";
  const { logger, config, v2, lifecycle } = ctx;

  if (!config.isEnabled("MODULE_YOUR_MODULE_ENABLED", true)) {
    logger.info("Module disabled via MODULE_YOUR_MODULE_ENABLED");
    return { name: moduleName, description: "your-module (disabled)" };
  }

  // Define a slash command with the v2 builder
  const b = v2.createInteractionCommand()
    .setName("hello")
    .setDescription("Say hello")
    .onExecute(async (i) => {
      await i.reply({ content: "Hello!", ephemeral: true });
    });

  // Register the command and track the disposer for hot-reload/unload
  const off = v2.register(b, moduleName);
  lifecycle.addDisposable(off);

  // Optional postReady hook
  async function postReady() {
    // e.g., install to a specific guild if configured
    const guildId = ctx.config.get("GUILD_ID");
    if (guildId) await ctx.commands.installGuild(guildId);
  }

  return {
    name: moduleName,
    description: "Example module",
    postReady,
    dispose: async () => { try { await lifecycle.disposeAll(); } catch {} }
  };
}
```

Lifecycle summary:
- `init(ctx)` is called when the module is loaded.
- `postReady()` (if returned) is called once the Discord client is ready.
- `dispose()` (if returned) is called on module unload/hot-reload/shutdown; additionally, anything registered via `ctx.lifecycle.addDisposable()` will be cleaned up automatically by the core.

## Feature flags and environment

- Per-module enable flag: `MODULE_<NAME>_ENABLED` (e.g., `MODULE_REMINDERS_ENABLED`).
- The loader resolves flags via `ctx.config.isEnabled(flag, defaultTrue)`.
- Command deployment behavior is configurable:
  - `COMMAND_DEPLOY_STRATEGY`: `bulk` | `diff` | `auto` (default `bulk`)
  - `COMMANDS_DRY_RUN`: `true` to simulate without writing
- Hot-reload reinstall toggle:
  - `HOT_RELOAD_REINSTALL`: `true` (default) triggers command reinstall after a module hot-reloads while the client is ready.

## How to register functionality

Most module functionality is registered using these core surfaces from `ctx`:

- Commands: `ctx.commands.registerSlash(moduleName, json)`; v2 builder preferred via `ctx.v2.createInteractionCommand()`.
- Interactions (components/modals): `ctx.interactions.registerButton|registerSelect|registerModal(moduleName, id, handler, { prefix? })`.
- Context menus: `ctx.interactions.registerUserContext`, `ctx.interactions.registerMessageContext`.
- Events: `ctx.events.on/once(moduleName, event, handler)`.
- Scheduling: `ctx.scheduler.schedule(cron, fn, opts)`.
- UI helpers (v2): `ctx.v2.ui.createPaginatedEmbed`, `createConfirmationDialog`, `createMultiSelectMenu`, `createForm`, `parseModal`, `createWizard`.
- DSL wrappers: `ctx.dsl.withTryCatch`, `withDeferredReply`, `withCooldown`, `withPerms`, `withConfirmation`, `withPreconditions`.
- State for multi-step interactions: `ctx.v2.state.forInteraction(i)` returns a Map-like async facade.

Refer to `docs/core_functions.md` for comprehensive API docs and examples.

## Patterns and snippets

1) A v2 command with DSL wrappers and UI pagination
```javascript
const b = ctx.v2.createInteractionCommand()
  .setName("demo")
  .setDescription("Demonstrate pagination")
  .onExecute(
    ctx.dsl.withTryCatch(
      ctx.dsl.withDeferredReply(async (i) => {
        const pages = [
          { title: "Page 1", description: "..." },
          { title: "Page 2", description: "..." },
        ];
        const { message, dispose } = ctx.v2.ui.createPaginatedEmbed(ctx, b, "your-module", pages);
        await i.editReply(message);
        ctx.lifecycle.addDisposable(dispose);
      })
    )
  );
ctx.lifecycle.addDisposable(ctx.v2.register(b, "your-module"));
```

2) Button/select/modal handlers co-located with a builder
```javascript
b.onButton("save", async (i) => { await i.update({ content: "Saved", components: [] }); });
b.onSelect("choice", async (i) => { await i.update({ content: `You picked: ${i.values.join(", ")}` }); });
b.onModal("form_submit", async (i) => { const data = ctx.v2.ui.parseModal(i); /* ... */ });
```

3) Client events with cleanup
```javascript
const offReady = ctx.events.once("your-module", "ready", () => ctx.logger.info("Ready"));
ctx.lifecycle.addDisposable(offReady);
```

4) Scheduled job
```javascript
const stop = ctx.scheduler.schedule("*/5 * * * *", async () => ctx.logger.info("5-min job"), { immediate: true });
ctx.lifecycle.addDisposable(stop);
```

## Hot reload

- The loader watches `modules/**` for changes.
- On change, it unloads the affected module (calls `dispose()` and clears commands/interactions/events), re-imports it with cache-busting, and optionally reinstalls commands (`HOT_RELOAD_REINSTALL=true`).
- Always register `off`/`stop` disposers with `ctx.lifecycle.addDisposable()` so hot-reload is clean.

## Troubleshooting

- Component handler not firing? Ensure the `customId` matches. Prefer the v2 builder helpers or UI helpers, which auto-scope IDs to `${module}:${command}:${type}:${name}`.
- Autocomplete not triggering? Ensure the option has `.setAutocomplete(true)` and you used `.onAutocomplete("optionName", handler)`.
- Command changes not visible? Global installs can take up to 1 hour to propagate. Try guild installs while developing; use `COMMANDS_DRY_RUN` and `COMMAND_DEPLOY_STRATEGY=diff` for diagnostics.
- Permissions errors? Gate with `ctx.dsl.withPerms` and/or `ctx.permissions.ensureInteractionPerms()`.

## Deep dives

- Step-by-step module creation with more examples: `docs/create_a_module.md`
- Complete API inventory and examples: `docs/core_functions.md`
- Logging to Grafana Loki: `docs/logging_best_practices.md`
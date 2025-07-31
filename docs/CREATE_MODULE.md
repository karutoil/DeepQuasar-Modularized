# Creating a New Module

This guide explains how to create a self-contained module for the modular Discord bot. Modules are plug-and-play features that register slash commands, interaction handlers, event listeners, scheduled jobs, use shared core services (logger, config, embeds, permissions, rate limiter, HTTP client, MongoDB, etc.), and can be hot reloaded or disabled via .env flags.

Use the CLI scaffolder:
```bash
npm run scaffold -- my-feature
```
This creates `modules/my-feature/` with a starter `index.js` and `module.env.example`. Or follow the manual steps below.

---

## 1) Module structure

Create a folder:
```
modules/
  my-feature/
    index.js
    module.env.example
    README.md (optional)

    # Optional nested folders (you can freely organize your module internals)
    commands/        # local command builders/handlers
    handlers/        # shared business logic
    components/      # buttons/, modals/, selects/ (if you prefer)
      buttons/
      modals/
      selects/
    events/          # event handlers local to this module
    services/        # data access, http wrappers, etc.
```

- `index.js` must export `default async function init(ctx) { ... }`
- Add a feature flag in `.env`: `MODULE_MY_FEATURE_ENABLED=true`
- Provide `module.env.example` documenting any module-specific config

You may freely split code across the nested folders. The only requirement is that your `index.js` wires these pieces back into the core (see examples below).

---

## 2) Module entrypoint signature

`index.js` exports a default async `init(ctx)` function.

```js
export default async function init(ctx) {
  // ctx: core context described below
  return {
    name: "my-feature",
    description: "What this module does",
    // Optional hooks:
    dispose: async () => {},  // Clean up resources on unload/hot reload
    postReady: async () => {} // Runs after client 'ready' and command install
  };
}
```

If your module needs to disable itself based on a flag:
```js
const enabled = ctx.config.isEnabled("MODULE_MY_FEATURE_ENABLED", true);
if (!enabled) {
  ctx.logger.info("MODULE_MY_FEATURE_ENABLED=false, skipping initialization");
  return { name: "my-feature", description: "Disabled feature" };
}
```

---

## 3) Core context (ctx)

The core passes a unified context to your module:

- `ctx.client`: Discord.js Client
- `ctx.logger`: Winston child logger scoped to your module
- `ctx.config`: Env manager
  - `get(key, fallback)`, `getBool(key, fallback)`, `require(keys[])`, `isEnabled(flag, default)`
- `ctx.bus`: Pub/Sub
  - `publish(event, payload)`, `subscribe(event, handler) -> unsubscribe`
- `ctx.commands`: Slash/Context command registry and deployer
  - `registerSlash(moduleName, ...buildersOrJson)`
  - `onInteractionCreate(moduleName, handler) -> unsubscribe`
  - `installGuild(guildId)`, `installGlobal()`
- `ctx.interactions`: Unified interaction handlers
  - `registerButton(moduleName, customId, handler)`
  - `registerSelect(moduleName, customId, handler)`
  - `registerModal(moduleName, customId, handler)`
  - `registerUserContext(moduleName, commandName, handler)`
  - `registerMessageContext(moduleName, commandName, handler)`
- `ctx.events`: Event listener registry
  - `on(moduleName, event, handler)`, `once(moduleName, event, handler)`
  - `addListener(moduleName, emitter, event, handler, { once })`
- `ctx.embed`: Global embed builder
  - `success(opts)`, `error(opts)`, `info(opts)`, `warn(opts)`, `neutral(opts)`, `base(color, opts)`
- `ctx.permissions`: Permission helpers
  - `ensureInteractionPerms(interaction, { userPerms, botPerms })`
- `ctx.rateLimiter`: Token-bucket rate limiter
  - `take(key, { capacity, refillPerSec })`, `setConfig(key, ...)`
- `ctx.http`: HTTP client (undici) with retries, timeouts, backoff
  - `get/post/patch/delete`, `request`
- `ctx.mongo`: MongoDB (official driver) thin wrapper
  - `getDb()`, `getCollection(name)`, `ping()`, `close()`, `withSchema(schema, op)`
- `ctx.ids`: CustomId helpers for interactions
  - `make(module, type, name, extras)`, `parse(customId)`
- `ctx.scheduler`: Cron scheduling (node-cron)
  - `schedule(cronExpr, fn, { timezone, immediate }) -> stop()`
- `ctx.metrics`: No-op metrics
  - `counter(name)`, `gauge(name)`, `timer(name)`
- `ctx.dsl`: Handler decorators
  - `withTryCatch(handler, opts)`
  - `withDeferredReply(handler, { ephemeral })`
  - `withCooldown(handler, { keyFn, capacity, refillPerSec, message })`
  - `withPerms(handler, { userPerms, botPerms })`
- `ctx.lifecycle`: Disposables tracking (for manual listeners/timers you add)
  - `addDisposable(fn)`, `addListener(emitter, event, handler)`
  - `setInterval(fn, ms)`, `setTimeout(fn, ms)`, `disposeAll()`
- `ctx.utils`:
  - `now()`, `safeAsync(fn, onError)`

Modules must NOT import from other modules. Only use core services via `ctx`.

---

## 4) Registering slash and context commands

Register commands in `init`:
```js
import { SlashCommandBuilder } from "discord.js";

const hello = new SlashCommandBuilder()
  .setName("hello")
  .setDescription("Say hello");

const userInspect = { name: "User Inspect", type: 2 };    // USER context menu
const messageInspect = { name: "Message Inspect", type: 3 }; // MESSAGE context menu

ctx.commands.registerSlash("my-feature", hello, userInspect, messageInspect);
```

Handle interactions:
```js
const offSlash = ctx.commands.onInteractionCreate("my-feature", ctx.dsl.withTryCatch(async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === "hello") {
    const e = ctx.embed.success({ title: "Hello!", description: `Hi ${interaction.user.username}`});
    await interaction.reply({ embeds: [e], ephemeral: true });
  }
}));
```

Commands are installed on client `ready`. If `GUILD_ID` is set, installed to that guild for fast iteration; otherwise globally (propagation may take up to 1 hour). Hot reload can re-install after changes.

---

## 5) Interaction handlers (buttons, selects, modals, context menus)

Generate consistent custom IDs:
```js
const BTN_HELLO = ctx.ids.make("my-feature", "btn", "hello", { v: 1 });

const offBtn = ctx.interactions.registerButton("my-feature", BTN_HELLO, ctx.dsl.withTryCatch(async (interaction) => {
  await interaction.reply({ content: "Button clicked!", ephemeral: true });
}));
```

Modal example:
```js
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from "discord.js";

const MODAL_ID = ctx.ids.make("my-feature", "modal", "feedback");
const FIELD_ID = "my-feature:feedback:text";

const offModal = ctx.interactions.registerModal("my-feature", MODAL_ID, ctx.dsl.withTryCatch(async (interaction) => {
  const text = interaction.fields.getTextInputValue(FIELD_ID);
  await interaction.reply({ content: `Got feedback: ${text}`, ephemeral: true });
}));

// Trigger modal from a slash handler:
const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle("Feedback");
const input = new TextInputBuilder().setCustomId(FIELD_ID).setLabel("Your feedback").setStyle(TextInputStyle.Paragraph);
modal.addComponents(new ActionRowBuilder().addComponents(input));
await interaction.showModal(modal);
```

Context menus:
```js
ctx.interactions.registerUserContext("my-feature", "User Inspect", async (interaction) => {
  await interaction.reply({ content: `User: ${interaction.targetUser.tag}`, ephemeral: true });
});
```

---

## 6) Events and lifecycle

Use core events for client listeners (automatically cleaned up on hot reload):
```js
const offReady = ctx.events.on("my-feature", "ready", () => {
  ctx.logger.info("Client ready observed in my-feature");
});

const offMsg = ctx.events.on("my-feature", "messageCreate", async (msg) => {
  if (!msg.author.bot && msg.content === "!ping") {
    await msg.reply("pong");
  }
});
```

If you manually attach something (custom emitter), use `ctx.lifecycle.addListener`:
```js
const off = ctx.lifecycle.addListener(customEmitter, "event", handler);
```

---

## 7) Embeds, permissions, and rate limiting

Embeds:
```js
const e = ctx.embed.info({ title: "Info", description: "Some details" });
await interaction.reply({ embeds: [e], ephemeral: true });
```

Permissions:
```js
const ok = await ctx.permissions.ensureInteractionPerms(interaction, {
  userPerms: ["ManageMessages"],
  botPerms: ["SendMessages"]
});
if (!ok) return; // Already responded with standardized embed
```

Rate limiting (per user per command):
```js
const keyFn = (i) => `my-feature:hello:${i.user.id}`;
const handler = ctx.dsl.withCooldown(async (interaction) => {
  await interaction.reply({ content: "You passed the cooldown!", ephemeral: true });
}, { keyFn, capacity: 1, refillPerSec: 0.2 });
```

Compose with try/catch and deferred reply:
```js
const wrapped = ctx.dsl.withTryCatch(
  ctx.dsl.withDeferredReply(
    ctx.dsl.withPerms(handler, { userPerms: [], botPerms: ["SendMessages"] })
  )
);
```

---

## 8) HTTP client

```js
const res = await ctx.http.get("https://api.example.com/data");
if (res.ok) {
  ctx.logger.info("Data", { status: res.status, data: res.data });
} else {
  ctx.logger.warn("Request failed", { status: res.status, data: res.data });
}
```

You can set headers/timeouts/retries:
```js
await ctx.http.post("https://api.example.com/items", { name: "x" }, { timeoutMs: 15000 });
```

---

## 9) MongoDB usage

Ensure you set `MONGODB_URI` in `.env`. If not set, Mongo is disabled gracefully.

```js
const coll = await ctx.mongo.getCollection("my_feature_data");
await coll.insertOne({ userId: interaction.user.id, ts: new Date() });
const doc = await coll.findOne({ userId: interaction.user.id });
```

Optional zod validation around writes:
```js
import { z } from "zod";
const schema = z.object({ userId: z.string(), ts: z.date() });

await ctx.mongo.withSchema(schema, async (s) => {
  const doc = s.parse({ userId: interaction.user.id, ts: new Date() });
  return coll.insertOne(doc);
});
```

Health:
```js
const ok = await ctx.mongo.ping();
```

---

## 10) Scheduling jobs

Use cron expressions:
```js
// Every 5 minutes (UTC)
const stop = ctx.scheduler.schedule("*/5 * * * *", async () => {
  ctx.logger.info("Periodic job running...");
}, { timezone: "UTC", immediate: true });

// Optional: stop() during dispose if desired (loader also cleans via unload)
```

---

## 11) Metrics and timings

No-op by default; useful for consistent API:
```js
const t = ctx.metrics.timer("expensive-op");
const { ms, result, error } = await t.withTiming(async () => doWork());
ctx.logger.info(`expensive-op took ${ms.toFixed(1)}ms`);
```

---

## 12) Bus (Pub/Sub)

Broadcast events without tight coupling:
```js
// Publish
ctx.bus.publish("my-feature.changed", { id: 123, time: Date.now() });

// Subscribe
const unsubscribe = ctx.bus.subscribe("stats.ready", (payload) => {
  ctx.logger.info(`Stats ready: ${JSON.stringify(payload)}`);
});
ctx.lifecycle.addDisposable(unsubscribe);
```

---

## 13) Hot reload and cleanup

The loader automatically:
- Unregisters slash commands and handlers for your module
- Removes interaction handlers
- Removes event listeners registered via core events
- Calls your module’s `dispose()` if provided

In `dispose()`, detach any manual resources:
```js
dispose: async () => {
  // Custom timers or external resources
  ctx.logger.info("Disposed my-feature");
}
```

---

## 14) Environment variables

Global `.env` (see `.env.example`):
- Required:
  - `DISCORD_TOKEN`
  - `DISCORD_CLIENT_ID`
- Recommended for dev:
  - `GUILD_ID`
- Logging:
  - `LOG_LEVEL`
- Hot reload:
  - `HOT_RELOAD_REINSTALL`
- Embed theme:
  - `EMBED_COLOR_SUCCESS`, `EMBED_COLOR_ERROR`, `EMBED_COLOR_INFO`, `EMBED_COLOR_WARN`, `EMBED_COLOR_NEUTRAL`, `EMBED_FOOTER_TEXT`, `EMBED_FOOTER_ICON`
- HTTP:
  - `HTTP_TIMEOUT_MS`, `HTTP_RETRIES`, `HTTP_BACKOFF_MS`, `HTTP_USER_AGENT`
- Scheduler:
  - `SCHEDULER_TIMEZONE` (optional; can also set per job)
- MongoDB:
  - `MONGODB_URI` (enables Mongo)
  - `MONGODB_DB`, `MONGODB_SERVER_API`, `MONGODB_MIN_POOL`, `MONGODB_MAX_POOL`
  - `MONGODB_CONNECT_TIMEOUT_MS`, `MONGODB_SOCKET_TIMEOUT_MS`
  - `MONGODB_TLS`, `MONGODB_TLS_CA_FILE`
- Module flags:
  - `MODULE_<NAME>_ENABLED` e.g., `MODULE_MY_FEATURE_ENABLED=true`

Each module can provide its own `module.env.example`.

---

## 15) Example skeleton (with nested folders wired through index.js)

Below is a default example that demonstrates organizing the module across nested folders (commands, components/buttons, events, services). The only requirement is that `index.js` wires these parts back into the core by registering commands, interactions, and events. You can rename or add folders as you see fit.

```js
// modules/my-feature/index.js
import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

// Example of importing from nested folders (you can structure these however you prefer)
import buildHello from "./commands/hello.js";                 // returns SlashCommandBuilder or JSON
import handleHelloSlash from "./handlers/helloSlash.js";      // slash interaction handler
import handleHelloButton from "./components/buttons/hello.js";// button handler
import onReady from "./events/onReady.js";                     // event handler
import createService from "./services/myService.js";           // service factory (optional)

export default async function init(ctx) {
  const enabled = ctx.config.isEnabled("MODULE_MY_FEATURE_ENABLED", true);
  if (!enabled) {
    ctx.logger.info("MODULE_MY_FEATURE_ENABLED=false, skipping");
    return { name: "my-feature", description: "Disabled" };
  }

  // Optional: initialize service(s) used by handlers
  const svc = createService({ http: ctx.http, logger: ctx.logger });

  // Commands
  // You can build a SlashCommandBuilder in a nested file to keep index.js small
  const helloCmd = buildHello(); // SlashCommandBuilder

  // Register commands (can pass SlashCommandBuilder or raw JSON payload)
  ctx.commands.registerSlash("my-feature", helloCmd);

  // Wire the slash handler via a small adapter that uses your service(s)
  const offSlash = ctx.commands.onInteractionCreate("my-feature",
    ctx.dsl.withTryCatch(async (interaction) => {
      if (!interaction.isChatInputCommand() || interaction.commandName !== "hello") return;
      await handleHelloSlash({ ctx, interaction, svc });
    })
  );

  // Interactions (buttons/modals/selects)
  const BTN_ID = ctx.ids.make("my-feature", "btn", "hello");
  const MODAL_ID = ctx.ids.make("my-feature", "modal", "feedback");
  const FIELD_ID = "my-feature:feedback:text";

  // Register button handler (delegates to nested file)
  const offBtn = ctx.interactions.registerButton("my-feature", BTN_ID, ctx.dsl.withTryCatch(async (interaction) => {
    // Example: show a modal (you can also keep modal construction in a nested file)
    const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle("Feedback");
    const input = new TextInputBuilder().setCustomId(FIELD_ID).setLabel("Your feedback").setStyle(TextInputStyle.Paragraph);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  }));

  // Register modal submit handler (using nested handler)
  const offModal = ctx.interactions.registerModal("my-feature", MODAL_ID, ctx.dsl.withTryCatch(async (interaction) => {
    const text = interaction.fields.getTextInputValue(FIELD_ID);
    await handleHelloButton({ ctx, interaction, text, svc });
  }));

  // Events (wired from nested file)
  const offReady = ctx.events.on("my-feature", "ready", () => onReady({ ctx, svc }));

  return {
    name: "my-feature",
    description: "My feature demo module (nested folders example)",
    dispose: async () => {
      try { offSlash?.(); } catch {}
      try { offBtn?.(); } catch {}
      try { offModal?.(); } catch {}
      try { offReady?.(); } catch {}
      ctx.logger.info("Disposed my-feature");
    },
    postReady: async () => {
      ctx.logger.info("my-feature postReady");
    }
  };
}
```

Example nested files (you can adjust names and locations):

```js
// modules/my-feature/commands/hello.js
import { SlashCommandBuilder } from "discord.js";
export default function buildHello() {
  return new SlashCommandBuilder()
    .setName("hello")
    .setDescription("Say hello using my-feature module");
}
```

```js
// modules/my-feature/handlers/helloSlash.js
export default async function handleHelloSlash({ ctx, interaction, svc }) {
  const e = ctx.embed.info({ title: "Hello!", description: `Hi ${interaction.user.username}` });
  await interaction.reply({ embeds: [e], ephemeral: true });
  await svc.logHello(interaction.user.id);
}
```

```js
// modules/my-feature/components/buttons/hello.js
export default async function handleHelloButton({ ctx, interaction, text, svc }) {
  await svc.saveFeedback({ userId: interaction.user.id, text });
  await interaction.reply({ content: `Feedback received: "${text}"`, ephemeral: true });
}
```

```js
// modules/my-feature/events/onReady.js
export default function onReady({ ctx }) {
  ctx.logger.info("my-feature observed ready");
}
```

```js
// modules/my-feature/services/myService.js
export default function createService({ http, logger }) {
  return {
    async logHello(userId) {
      logger.info(`logHello for ${userId}`);
    },
    async saveFeedback({ userId, text }) {
      logger.info(`saveFeedback for ${userId}: ${text}`);
      // optionally persist via ctx.mongo from caller scope
    }
  };
}
```

This pattern demonstrates:
- Arbitrary nesting inside a module.
- A small `index.js` that imports and wires internals into the core.
- Clean separation of concerns (builders, handlers, services, events).

> Important: The core only requires that `index.js` exposes the `init(ctx)` contract. Your internal structure is up to you.

---

## 16) Testing your module

1. Add `MODULE_MY_FEATURE_ENABLED=true` to `.env`
2. Start the bot:
   ```bash
   npm start
   ```
3. With `GUILD_ID` set, slash commands are installed to your guild quickly.
4. Modify `modules/my-feature/` files; hot reload unloads and reloads your module safely.

---

## 17) Troubleshooting

- Missing required env:
  - `ctx.config.require(["DISCORD_TOKEN"])` is checked at startup; check `.env`
- Slash commands not appearing:
  - Ensure `GUILD_ID` set for quick dev installs. Global installs can take up to 1 hour.
  - Check logs for `installGuild`/`installGlobal` results.
- Mongo issues:
  - Ensure `MONGODB_URI` is set; check `ctx.mongo.ping()` and logs for connection errors.
- Interaction IDs:
  - Use `ctx.ids.make()` to avoid collisions and keep IDs under Discord’s 100-char limit.
- Hot reload:
  - On file change, the loader calls `dispose()` and unregisters handlers automatically.

---

By following this guide and using the provided core services, you can build robust, isolated, and maintainable modules that plug neatly into the bot’s architecture while keeping module internals organized in any folder structure you prefer, as long as everything links back through the module’s `index.js`.
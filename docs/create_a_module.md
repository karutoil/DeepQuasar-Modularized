# Create a Module

This guide walks through building a module for DeepQuasar: how to register commands and interactions, wire lifecycle cleanup, and safely load/unload.

Prerequisites
- You have a running Discord.js client and the core initialized with createCore(client).
- You are familiar with the core module context APIs described in docs/core_functions.md.
- Node 18+ recommended.

Module anatomy

Each module typically exports an async setup function that receives the module-scoped context. Use ctx.v2 builders for slash commands and interactions, ctx.events/ctx.interactions for additional event hooks, and ctx.lifecycle to register disposables for cleanup.

Example directory layout:
modules/
  example/
    index.js
    handlers/
    services/
    README.md


Minimal module: a simple slash command

modules/example/index.js
```js
export async function setup(ctx) {
  // Create a v2 command builder
  const b = ctx.v2.createInteractionCommand()
    .setName("hello")
    .setDescription("Say hello")
    .onExecute(ctx.dsl.withTryCatch(
      ctx.dsl.withDeferredReply(async (i) => {
        const e = ctx.embed.success({ title: "Hello", description: "World" });
        await i.editReply({ embeds: [e] });
      })
    ));

  // Register the builder, capture disposer
  const { off } = b.register(ctx, "example", { stateManager: ctx.v2.state });
  ctx.lifecycle.addDisposable(off);
}
```

What this does
- Defines a slash command /hello.
- Wraps the handler with standard error handling and deferReply using the DSL.
- Registers the command and ensures it is unregistered when your module unloads.


Add component handlers and UI helpers

You can attach buttons, selects, modals, and autocomplete in the same builder.

modules/example/index.js
```js
export async function setup(ctx) {
  const b = ctx.v2.createInteractionCommand()
    .setName("demo")
    .setDescription("Demonstration")
    .addStringOption(o => o.setName("q").setDescription("Query"))
    .onExecute(ctx.dsl.withTryCatch(
      ctx.dsl.withDeferredReply(async (i) => {
        // Paginated embed UI
        const pages = [
          { title: "Page 1", description: "..." },
          { title: "Page 2", description: "..." },
        ];
        const { message, dispose } = ctx.v2.ui.createPaginatedEmbed(ctx, b, "example", pages);
        await i.editReply(message);
        ctx.lifecycle.addDisposable(dispose);
      })
    ))
    .onButton("refresh", async (i) => {
      await i.update({ content: "Refreshed.", components: [] });
    })
    .onSelect("choice", async (i) => {
      await i.update({ content: `Selected: ${i.values?.join(", ")}`, components: [] });
    })
    .onAutocomplete("q", async (i) => {
      const focused = i.options.getFocused();
      const choices = ["alpha", "beta", "gamma"].filter(x => x.startsWith(focused || ""));
      await i.respond(choices.map(c => ({ name: c, value: c })));
    });

  const { off } = b.register(ctx, "example", { stateManager: ctx.v2.state });
  ctx.lifecycle.addDisposable(off);
}
```

Scoping customIds automatically
- Any .onButton("name")/.onSelect("name")/.onModal("name") receives scoped IDs like example:demo:btn:name… so they won’t collide with other modules.
- You can build components using builder.button/select/modal helpers if you need to pre-construct UI, or use UI helpers in core/ui.js for common patterns.


Listening to Discord client events

Use ctx.events to safely bind client events with tracked cleanup.

```js
export async function setup(ctx) {
  const offReady = ctx.events.once("example", "ready", () => {
    ctx.logger.info("Example module ready");
  });
  ctx.lifecycle.addDisposable(offReady);

  const offMsgCreate = ctx.events.on("example", "messageCreate", async (msg) => {
    if (msg.content === "!ping") await msg.reply("Pong");
  });
  ctx.lifecycle.addDisposable(offMsgCreate);
}
```


Background jobs with the Scheduler

Use cron-like tasks via ctx.scheduler.

```js
export async function setup(ctx) {
  const stop = ctx.scheduler.schedule("*/5 * * * *", async () => {
    ctx.logger.info("5-minute job ran");
  }, { immediate: true });
  ctx.lifecycle.addDisposable(stop);
}
```


Permissions, rate limits, and preconditions

Use DSL wrappers for consistent policies.

```js
export async function setup(ctx) {
  const b = ctx.v2.createInteractionCommand()
    .setName("admin")
    .setDescription("Admin command")
    .addPrecondition(async (i) => {
      // Gate by permission
      const ok = await ctx.permissions.ensureInteractionPerms(i, { userPerms: ["ManageGuild"] });
      return ok || "You do not have permission for this command.";
    })
    .onExecute(
      ctx.dsl.withCooldown(
        ctx.dsl.withTryCatch(async (i) => {
          await i.reply({ content: "Admin task executed.", ephemeral: true });
        }),
        { keyFn: (i) => `admin:${i.user?.id}`, capacity: 1, refillPerSec: 0.2 }
      )
    );

  const { off } = b.register(ctx, "example", { stateManager: ctx.v2.state });
  ctx.lifecycle.addDisposable(off);
}
```


HTTP calls with retries and timeouts

```js
export async function setup(ctx) {
  const b = ctx.v2.createInteractionCommand()
    .setName("fetch")
    .setDescription("Fetch data")
    .onExecute(ctx.dsl.withTryCatch(async (i) => {
      const res = await ctx.http.get("https://api.github.com/repos/nodejs/node");
      if (!res.ok) {
        await i.reply({ content: "Failed to fetch", ephemeral: true });
        return;
      }
      await i.reply({ content: `Stars: ${res.data?.stargazers_count}`, ephemeral: true });
    }));

  const { off } = b.register(ctx, "example", { stateManager: ctx.v2.state });
  ctx.lifecycle.addDisposable(off);
}
```


Registering and installing commands

Register slash commands by calling builder.register(ctx, "moduleName", ...). Commands are staged in the registry. To deploy them to Discord:
- Guild install: ctx.commands.installGuild(guildId)
- Global install: ctx.commands.installGlobal()

Configuration (via env, see core/config.js)
- COMMAND_DEPLOY_STRATEGY: bulk | diff | auto (default bulk)
- COMMANDS_DRY_RUN: true/false

Example deploy flow at startup (index.js)
```js
import { Client, GatewayIntentBits } from "discord.js";
import { createCore } from "./core/index.js";
import * as Example from "./modules/example/index.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const core = createCore(client);

client.once("ready", async () => {
  const ctx = core.createModuleContext("example");
  await Example.setup(ctx);

  // Install commands after registration
  const guildId = process.env.GUILD_ID;
  if (guildId) await ctx.commands.installGuild(guildId);
  else await ctx.commands.installGlobal();

  ctx.logger.info("Example module installed");
});

client.login(process.env.DISCORD_TOKEN);
```


Loading and unloading modules

Loading
- Create the module context via core.createModuleContext("moduleName").
- Run your module’s setup(ctx) which registers commands, interactions, events.
- Track any cleanup disposables using ctx.lifecycle.addDisposable(...).

Unloading (hot-reload or shutdown)
- Call ctx.v2.builders.clearModule("moduleName") if you manage builders manually; most builder registrations give you an off() to unregister routers and handlers.
- Remove event listeners with the disposer you saved, or call ctx.events.removeModule("moduleName") if you attached via ctx.events.
- For interactions registered directly via ctx.interactions, keep the off() returned and call it, or if you grouped them by module, ctx.interactions.removeModule("moduleName").
- Clear scheduler jobs by keeping the stop() function or, for module-wide cleanup, ensure you added the stop() to ctx.lifecycle so disposeAll() can clear it.

Common pattern
```js
export async function setup(ctx) {
  // Register a command
  const b = ctx.v2.createInteractionCommand().setName("x").setDescription("X");
  const { off } = b.register(ctx, "my-module", { stateManager: ctx.v2.state });
  ctx.lifecycle.addDisposable(off);

  // Events
  const offEv = ctx.events.on("my-module", "guildCreate", (g) => ctx.logger.info(`Joined guild ${g.id}`));
  ctx.lifecycle.addDisposable(offEv);

  // Schedule
  const stopJob = ctx.scheduler.schedule("0 * * * *", async () => { /* hourly */ });
  ctx.lifecycle.addDisposable(stopJob);

  // On hot-reload or shutdown:
  // await ctx.lifecycle.disposeAll(); // remove all disposables you registered above
}
```

Note on module-scoped translation

Use ctx.t(key, params, opts) to translate messages with module-aware fallback. For example, ctx.t("greeting", { name: i.user.username }, { guildId: i.guildId, userLocale: i.locale }).



Troubleshooting tips

- If a component handler is not firing, verify customId matches your registered prefix or exact id. When using v2 builder helpers or UI helpers, IDs are scoped and consistent.
- For user select menus, the core remaps :usel: to :sel: for handler parity; ensure you registered the select handler.
- If command changes are not appearing:
  - For global installs, Discord propagation can take up to 1 hour.
  - Use COMMANDS_DRY_RUN or switch strategy to "diff" for diagnostics.
- Always return and add off()/stop() disposers to ctx.lifecycle to ensure clean unloads.



Scaffolding new modules

You can use bin/scaffold-module.js if available in your repo to bootstrap a new module folder and files. Otherwise:
- Create modules/your-module/index.js
- Export async setup(ctx) {}
- Register at startup using core.createModuleContext("your-module") and your setup function.
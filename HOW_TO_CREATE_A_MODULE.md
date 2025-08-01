# How to Create a DeepQuasar Module

This guide provides a comprehensive overview of how to create a module for the DeepQuasar bot. Modules are self-contained units of functionality that can be loaded, unloaded, and reloaded at runtime.

## 1. File Structure

Every module resides in its own directory inside the `/modules` folder. The minimum required file is `index.js`.

```
/modules/
└── your-module-name/
    ├── index.js
    └── module.env.example (optional)
```

-   **`index.js`**: The entry point for your module.
-   **`module.env.example`**: An optional file to document environment variables specific to your module.

## 2. The `init` Function

The `index.js` file must export a default asynchronous function, typically named `init`. This function is the entry point for your module and is called by the module loader.

```javascript
// /modules/your-module-name/index.js
export default async function init(ctx) {
  // ... module logic ...

  return {
    name: "your-module-name",
    description: "A brief description of what this module does.",
    // ... lifecycle methods ...
  };
}
```

### The Context Object (`ctx`)

The `init` function receives a single argument: the context object (`ctx`). This object is your gateway to all of the bot's core services.

Here are some of the most important services available on `ctx`:

-   `logger`: A scoped logger instance for your module.
-   `config`: Access to the bot's configuration, including feature flags.
-   `v2`: The modern interaction and command builder API (Recommended).
-   `bus`: An event bus for communication between modules.
-   `events`: A service for subscribing to Discord.js client events.
-   `lifecycle`: A helper for managing disposables (cleanup functions).
-   `utils`: A collection of utility functions.
-   `embed`: A helper for creating rich embeds.
-   `scheduler`: A service for scheduling tasks (e.g., cron jobs).

## 3. The Module Definition Object

Your `init` function must return a module definition object.

-   `name` (String, required): The unique name of your module. Should match the directory name.
-   `description` (String, required): A short description of the module's purpose.
-   `dispose` (Function, optional): A function to clean up all resources before the module is unloaded. **This is critical for hot-reloading.**
-   `postReady` (Function, optional): A function that runs once after the Discord client has successfully connected and is ready.

## 4. Lifecycle and Hot-Reloading

To support hot-reloading (loading new code without restarting the bot), your module must be able to clean up after itself. This is done using the `dispose` method.

The `dispose` method should undo everything the module set up. This includes:
-   Unregistering command handlers.
-   Removing event listeners.
-   Clearing timers or intervals.
-   Unsubscribing from the event bus.

The `lifecycle.addDisposable()` helper is the recommended way to manage cleanup.

### Example: Managing Cleanup

```javascript
export default async function init(ctx) {
  const { logger, v2, lifecycle } = ctx;
  const moduleName = "my-module";

  const myCommand = v2.createInteractionCommand()
    .setName("hello")
    .setDescription("Says hello")
    .onExecute(async (interaction) => {
      await interaction.reply("Hello, world!");
    });

  // Register the command and get a disposable function.
  const disposeCommand = ctx.createModuleContext(moduleName).v2.register(myCommand);

  // Add the disposable to the lifecycle manager.
  // This will be called automatically when the module is unloaded.
  lifecycle.addDisposable(disposeCommand);

  logger.info("My Module has been loaded.");

  return {
    name: moduleName,
    description: "A module demonstrating proper lifecycle management.",
    dispose: async () => {
      // While lifecycle.addDisposable is preferred,
      // you can also have a manual dispose method.
      // It's useful for logging or more complex cleanup.
      logger.info("My Module has been unloaded.");
    },
  };
}
```

## 5. Creating Commands (v2 Builder API)

The `v2` builder is the recommended way to create commands and handle interactions. It provides a fluent, chainable API for building commands and attaching handlers for components like buttons and modals.

### Complete Command Example

Here is a complete example of a `/ping` command that includes a button and demonstrates state management between interactions.

```javascript
// /modules/ping-example/index.js
import { ButtonStyle } from "discord.js";

export default async function init(ctx) {
  const { logger, config, v2, lifecycle, utils } = ctx;
  const moduleName = "ping-example";

  // 1. Create the command
  const ping = v2.createInteractionCommand()
    .setName("ping")
    .setDescription("Checks bot latency and provides interaction examples.")
    // 2. Define the main command handler
    .onExecute(async (interaction, args, state) => {
      const apiPing = Math.round(interaction.client.ws.ping);

      // 3. Use the state object to pass data to component handlers
      state.set("apiPing", apiPing);
      state.set("startTime", Date.now());

      // 4. Create a button linked to this command
      const row = new ActionRowBuilder().addComponents(
        ping.button(ctx, moduleName, "details", "Show Details", ButtonStyle.Primary)
      );

      await interaction.reply({
        content: `Pong! Gateway latency: ${apiPing}ms.`,
        components: [row],
        ephemeral: true,
      });
    })
    // 5. Define a handler for the button
    .onButton("details", async (interaction, state) => {
      // 6. Retrieve data from the state object
      const apiPing = state.get("apiPing") ?? "N/A";
      const startTime = state.get("startTime") ?? 0;
      const roundTrip = Date.now() - startTime;

      await interaction.update({ // Use update for a seamless experience
        content: `Gateway latency is ${apiPing}ms. Full round-trip took ${roundTrip}ms.`,
        components: [], // Remove the button after it's clicked
      });
    });

  // 7. Register the command and manage its lifecycle
  const moduleCtx = ctx.createModuleContext(moduleName);
  lifecycle.addDisposable(moduleCtx.v2.register(ping));

  logger.info(`Module '${moduleName}' loaded.`);

  return {
    name: moduleName,
    description: "A ping command with a button and state management.",
    dispose: () => {
      logger.info(`Module '${moduleName}' unloaded.`);
    },
  };
}
```

## 6. Using Core Services

### Configuration Flags

Enable or disable your module based on environment variables. This is a best practice.

```javascript
// in .env file
MODULE_MY_MODULE_ENABLED=true
```

```javascript
// in your module's index.js
export default async function init(ctx) {
  const { logger, config } = ctx;

  const enabled = config.isEnabled("MODULE_MY_MODULE_ENABLED", true); // Default to true if not set
  if (!enabled) {
    logger.info("My Module is disabled via config.");
    return { name: "my-module", description: "My module (disabled)" };
  }

  // ... rest of the module setup
}
```

### Inter-Module Communication (Event Bus)

Modules can communicate with each other without being tightly coupled using the `bus`.

**Module A (Publisher):**
```javascript
// In some command or event handler
ctx.bus.publish("user.greeted", { userId: interaction.user.id, at: new Date() });
```

**Module B (Subscriber):**
```javascript
// In init(ctx)
const unsubscribe = ctx.bus.subscribe("user.greeted", (payload) => {
  logger.info(`User ${payload.userId} was greeted at ${payload.at}`);
});

// Clean up the subscription
ctx.lifecycle.addDisposable(unsubscribe);
```

## 7. Loading Your Module

To load your module, the bot owner must add its name to the central module list (typically a file like `modules.json` or a database entry, depending on the bot's configuration). Once added, the bot will load it on startup, and it will be available for runtime `!reload` commands.

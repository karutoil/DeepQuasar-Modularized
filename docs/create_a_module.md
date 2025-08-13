# Creating a New Module in DeepQuasar

This guide will walk you through the process of creating a new module for DeepQuasar, using the `autorole` module as a practical example. DeepQuasar modules are designed to be self-contained units of functionality that can be easily enabled, disabled, and hot-reloaded.

## Module Structure

AA typical DeepQuasar module follows a convention for its directory structure:

```
modules/your-module-name/
├── index.js             # Module entry point
├── module.env.example   # Environment variables specific to this module
├── README.md            # Module documentation
├── handlers/            # Discord event handlers, command logic, interaction handlers
│   ├── yourHandler.js
│   └── anotherHandler.js
├── services/            # Business logic, database interactions, external API calls
│   └── yourService.js
└── utils/               # Reusable utility functions
    └── helpers.js
```

## 1. The `index.js` Entry Point

Every module must have an `index.js` file at its root. This file exports an `init` function, which is the first function called by the core when the module is loaded. The `init` function receives a `ctx` (context) object, which provides access to core services and module-scoped utilities.

**Example: `modules/autorole/index.js`**

```javascript
// Autorole Module Entry Point
import { createConfigureCommand } from "./handlers/configure.js";
import { registerMemberJoinHandler } from "./handlers/memberJoin.js";
import { ensureIndexes, invalidateGuildSettingsCache } from "./services/settings.js";

export default async function init(ctx) {
  const { logger, config, lifecycle } = ctx;
  const moduleName = "autorole";

  // 1. Module Enabling/Disabling
  // Always check if the module is enabled via configuration.
  // This allows users to easily toggle modules on/off.
  if (!config.isEnabled("MODULE_AUTOROLE_ENABLED", true)) {
    logger.info(`[${moduleName}] Module disabled via config.`);
    return { name: moduleName, description: "Autorole module (disabled)" };
  }

  // 2. Database Initialization (if applicable)
  // Perform any necessary database setup, like ensuring indexes.
  await ensureIndexes(ctx);

  // 3. Exposing Module-Specific Helpers (Optional)
  // You can attach module-specific functions or data to the ctx object
  // under a unique key (e.g., `ctx.autorole`). This allows other parts
  // of your module (or even other modules if designed for it) to access them.
  const timers = new Map(); // Example: Track scheduled timers
  ctx.autorole = {
    invalidate: (guildId) => invalidateGuildSettingsCache(guildId),
    timers,
  };

  // 4. Registering Handlers and Commands
  // This is where you wire up the main logic of your module.
  // Handlers from subfolders are imported and registered with core services.
  createConfigureCommand(ctx); // Registers a slash command
  const disposer = registerMemberJoinHandler(ctx); // Registers a Discord event listener

  // 5. Lifecycle Management
  // Use `ctx.lifecycle.addDisposable` to register cleanup functions.
  // These functions will be called when the module is unloaded or hot-reloaded,
  // ensuring proper resource management (e.g., unregistering event listeners, clearing timers).
  lifecycle.addDisposable(() => {
    try { disposer?.(); } catch {}
    // Clear all pending timers
    try {
      for (const [, timeoutId] of timers) {
        clearTimeout(timeoutId);
      }
      timers.clear();
    } catch {}
  });

  logger.info(`[${moduleName}] Module loaded.`);
  // The init function should return an object with at least `name` and `description`.
  // A `dispose` function can also be returned for explicit cleanup during unload.
  return {
    name: moduleName,
    description: "Automatically assign a configured role to new members with optional delay and account age gating.",
    dispose: async () => {
      logger.info(`[${moduleName}] Module unloaded.`);
      try { disposer?.(); } catch {}
      try {
        for (const [, timeoutId] of timers) clearTimeout(timeoutId);
        timers.clear();
      } catch {}
    }
  };
}
```

## 2. Wiring Up Subfolders

Subfolders (`handlers/`, `services/`, `utils/`) help organize your module's code by concern. The `index.js` file acts as the orchestrator, importing and calling functions from these subfolders to set up the module's functionality.

### `handlers/` - Discord Event and Command Logic

This folder typically contains functions that respond to Discord events (e.g., `guildMemberAdd`, `interactionCreate`) or implement command logic. They often receive the `ctx` object to access core services.

**Example: `modules/autorole/handlers/configure.js` (Simplified)**

This file defines the `/autorole` slash command and its associated component (button, select menu, modal) handlers.

```javascript
import { PermissionsBitField } from "discord.js";
// ... other imports

export function createConfigureCommand(ctx) {
  const { v2, lifecycle, logger, interactions } = ctx;
  const moduleName = "autorole";

  // Define a single-level /autorole command using the v2 builder
  const cmd = v2.createInteractionCommand()
    .setName("autorole")
    .setDescription("Open autorole configuration")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .onExecute(async (interaction) => {
      // Logic to open the configuration UI
      // ...
    });

  // Register the command with the core's command handler
  const off = v2.register(cmd);
  lifecycle.addDisposable(off); // Ensure command is unregistered on module unload

  // Register component handlers (buttons, selects, modals) using core interactions
  const offRole = interactions.registerSelect(moduleName, "ar_role_select", async (interaction) => {
    // Logic for role selection
    // ...
  });
  lifecycle.addDisposable(offRole);

  // ... similar registrations for other buttons and modals

  return { name: "autorole (v2)" };
}
```

**Example: `modules/autorole/handlers/memberJoin.js`**

This file contains the logic for handling new member joins.

```javascript
import { getGuildSettings } from "../services/settings.js";

export function registerMemberJoinHandler(ctx) {
  const { client, logger } = ctx;
  const timers = ctx.autorole?.timers || new Map(); // Access module-specific state

  async function applyRoleIfEligible(member, settings, ctx) {
    // Logic to apply role based on settings
    // ...
  }

  async function onGuildMemberAdd(member) {
    // Fetch settings, check conditions, and apply/schedule role
    const settings = await getGuildSettings(ctx, member.guild.id);
    // ...
    await applyRoleIfEligible(member, settings, ctx);
  }

  function onGuildMemberRemove(member) {
    // Logic to cancel scheduled timers if a member leaves
    // ...
  }

  // Register Discord client events
  client.on("guildMemberAdd", onGuildMemberAdd);
  client.on("guildMemberRemove", onGuildMemberRemove);

  // Return a disposer function for cleanup
  return () => {
    try { client.off("guildMemberAdd", onGuildMemberAdd); } catch {}
    try { client.off("guildMemberRemove", onGuildMemberRemove); } catch {}
  };
}
```

### `services/` - Business Logic and Data Access

Services encapsulate the core business logic, data persistence (e.g., MongoDB interactions), and external API calls. They are typically independent of Discord-specific objects and can be tested in isolation.

**Example: `modules/autorole/services/settings.js`**

This file handles reading and writing autorole settings to MongoDB.

```javascript
import { createMongo } from "../../../core/mongo.js";

const COLLECTION = "guild_autorole_settings";
// ... DEFAULTS and caching logic

function getMongo(ctx) {
  // Helper to get the core Mongo instance
  // ...
}

export async function ensureIndexes(ctx) {
  // Ensure MongoDB indexes are set up
  // ...
}

export async function getGuildSettings(ctx, guildId) {
  // Fetch settings from DB or cache
  // ...
}

export async function setGuildSettings(ctx, guildId, partial) {
  // Save settings to DB and invalidate cache
  // ...
}

export function invalidateGuildSettingsCache(guildId) {
  // Invalidate cache for a specific guild
  // ...
}

export function validateRoleAssignable(guild, roleId) {
  // Logic to validate if a role can be assigned by the bot
  // ...
}
```

### `utils/` - Reusable Utility Functions

This folder is for small, generic helper functions that can be reused across different parts of your module or even potentially by other modules. The `autorole` module doesn't have a dedicated `utils` folder in the provided example, but it would be a good place for functions like `formatDuration` or `isValidRoleId`.

### `module.env.example` - Module Environment Variables

This file documents and provides example values for environment variables specific to your module. These variables are accessed via `ctx.config`.

**Example: `modules/autorole/module.env.example`**

```ini
# Autorole Module Environment Variables
# Enable/disable the module
MODULE_AUTOROLE_ENABLED=true

# Defaults and limits (can be overridden in DB per guild via the configuration UI)
# Whether to ignore bot accounts by default when no setting is stored yet
AUTOROLE_DEFAULT_IGNORE_BOTS=true
# Maximum allowed delay in seconds for safety bounds in the UI (default 86400 = 24h)
AUTOROLE_MAX_DELAY_SECONDS=86400
```

### `README.md` - Module Documentation

Every module should have a `README.md` file that explains its purpose, features, setup instructions, usage, and any troubleshooting tips. This is crucial for maintainability and for other developers (or your future self!) to understand how the module works.

By following this structure and leveraging the `ctx` object and lifecycle management, you can create robust, maintainable, and well-integrated modules for DeepQuasar.
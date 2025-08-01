
# DeepQuasar Core Functions

This document provides a detailed overview of the functions available in the DeepQuasar core. These functions are designed to be used within modules to extend the functionality of the bot.

## Builders (`core/builders.js`)

The `builders.js` file provides a powerful `InteractionCommandBuilder` for creating and managing slash commands and their interactions.

### `createInteractionCommand()`

Creates a new `InteractionCommandBuilder` instance.

**Example:**

```javascript
import { createInteractionCommand } from "./core/builders.js";

const myCommand = createInteractionCommand();
```

### `InteractionCommandBuilder`

A builder for creating slash commands and their associated interactions.

#### `setName(name)`

Sets the name of the command.

**Example:**

```javascript
myCommand.setName("ping");
```

#### `setDescription(description)`

Sets the description of the command.

**Example:**

```javascript
myCommand.setDescription("Replies with pong!");
```

#### `addOption(fn)`

Adds an option to the command.

**Example:**

```javascript
myCommand.addStringOption(option =>
    option.setName("message")
        .setDescription("The message to echo back")
        .setRequired(true)
);
```

#### `onExecute(handler)`

Sets the handler for when the command is executed.

**Example:**

```javascript
myCommand.onExecute((interaction, args, state) => {
    interaction.reply("Pong!");
});
```

#### `onButton(localName, handler)`

Sets a handler for a button interaction.

**Example:**

```javascript
myCommand.onButton("my_button", (interaction, state) => {
    interaction.reply("Button clicked!");
});
```

#### `onSelect(localName, handler)`

Sets a handler for a select menu interaction.

**Example:**

```javascript
myCommand.onSelect("my_select", (interaction, state) => {
    interaction.reply(`You selected: ${interaction.values.join(", ")}`);
});
```

#### `onModal(localName, handler)`

Sets a handler for a modal submission.

**Example:**

```javascript
myCommand.onModal("my_modal", (interaction, state) => {
    const favoriteColor = interaction.fields.getTextInputValue("favoriteColorInput");
    interaction.reply(`Your favorite color is ${favoriteColor}`);
});
```

#### `onAutocomplete(optionName, handler)`

Sets a handler for autocomplete interactions.

**Example:**

```javascript
myCommand.onAutocomplete("query", (interaction) => {
    const focusedValue = interaction.options.getFocused();
    const choices = ["apple", "banana", "cherry", "date", "elderberry"];
    const filtered = choices.filter(choice => choice.startsWith(focusedValue));
    interaction.respond(
        filtered.map(choice => ({ name: choice, value: choice }))
    );
});
```

#### `addPrecondition(fn)`

Adds a precondition that must be met before the command can be executed.

**Example:**

```javascript
myCommand.addPrecondition((interaction) => {
    if (interaction.user.id !== "1234567890") {
        return "You are not authorized to use this command.";
    }
    return true;
});
```

#### `register(ctx, moduleName, { stateManager } = {})`

Registers the command with the core.

**Example:**

```javascript
myCommand.register(ctx, "my-module");
```

## Bus (`core/bus.js`)

The `bus.js` file provides a simple event bus for communication between modules.

### `createBus(baseLogger)`

Creates a new event bus instance.

**Example:**

```javascript
import { createBus } from "./core/bus.js";
import { createLogger } from "./core/logger.js";

const logger = createLogger();
const bus = createBus(logger);
```

### `subscribe(event, handler)`

Subscribes to an event.

**Example:**

```javascript
bus.subscribe("user:created", (user) => {
    console.log(`User created: ${user.username}`);
});
```

### `once(event, handler)`

Subscribes to an event once.

**Example:**

```javascript
bus.once("user:deleted", (user) => {
    console.log(`User deleted: ${user.username}`);
});
```

### `publish(event, payload)`

Publishes an event.

**Example:**

```javascript
bus.publish("user:created", { username: "test" });
```

## Command Handler (`core/commandHandler.js`)

The `commandHandler.js` file is responsible for registering and handling slash commands.

### `createCommandHandler(client, logger, config)`

Creates a new command handler instance.

**Example:**

```javascript
import { createCommandHandler } from "./core/commandHandler.js";
import { Client } from "discord.js";
import { createLogger } from "./core/logger.js";
import { createConfig } from "./core/config.js";

const client = new Client({ intents: [] });
const logger = createLogger();
const config = createConfig();
const commandHandler = createCommandHandler(client, logger, config);
```

### `registerSlash(moduleName, ...builders)`

Registers a slash command.

**Example:**

```javascript
import { SlashCommandBuilder } from "discord.js";

const myCommand = new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with pong!");

commandHandler.registerSlash("my-module", myCommand);
```

### `onInteractionCreate(moduleName, handler)`

Sets a handler for when an interaction is created.

**Example:**

```javascript
commandHandler.onInteractionCreate("my-module", (interaction) => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === "ping") {
        interaction.reply("Pong!");
    }
});
```

### `installGuild(guildId)`

Installs all registered commands to a specific guild.

**Example:**

```javascript
commandHandler.installGuild("1234567890");
```

### `installGlobal()`

Installs all registered commands globally.

**Example:**

```javascript
commandHandler.installGlobal();
```

### `removeModule(moduleName)`

Removes all commands and handlers for a specific module.

**Example:**

```javascript
commandHandler.removeModule("my-module");
```

## Config (`core/config.js`)

The `config.js` file provides a simple way to access environment variables.

### `createConfig()`

Creates a new config instance.

**Example:**

```javascript
import { createConfig } from "./core/config.js";

const config = createConfig();
```

### `get(key, fallback = undefined)`

Gets a value from the environment variables.

**Example:**

```javascript
const token = config.get("DISCORD_TOKEN");
```

### `getBool(key, fallback = false)`

Gets a boolean value from the environment variables.

**Example:**

```javascript
const debug = config.getBool("DEBUG");
```

### `require(keys)`

Requires that a set of keys exist in the environment variables.

**Example:**

```javascript
config.require(["DISCORD_TOKEN", "DISCORD_CLIENT_ID"]);
```

### `isEnabled(flagName, defaultVal = true)`

Checks if a feature flag is enabled.

**Example:**

```javascript
if (config.isEnabled("MY_FEATURE")) {
    // ...
}
```

## DSL (`core/dsl.js`)

The `dsl.js` file provides a set of "Domain Specific Language" helpers to simplify common tasks.

### `createDsl({ logger, embed, rateLimiter, permissions, errorReporter, i18n })`

Creates a new DSL instance.

**Example:**

```javascript
import { createDsl } from "./core/dsl.js";
// ... import other dependencies

const dsl = createDsl({ logger, embed, rateLimiter, permissions, errorReporter, i18n });
```

### `withTryCatch(handler, { errorMessage } = {})`

Wraps a handler in a try/catch block.

**Example:**

```javascript
const myHandler = dsl.withTryCatch(async (interaction) => {
    // ...
});
```

### `withDeferredReply(handler, { ephemeral } = {})`

Defers the reply to an interaction.

**Example:**

```javascript
const myHandler = dsl.withDeferredReply(async (interaction) => {
    // ...
});
```

### `withCooldown(handler, { keyFn, capacity, refillPerSec, message } = {})`

Adds a cooldown to a handler.

**Example:**

```javascript
const myHandler = dsl.withCooldown(async (interaction) => {
    // ...
}, { keyFn: (interaction) => interaction.user.id });
```

### `withPerms(handler, { userPerms, botPerms } = {})`

Checks for permissions before executing a handler.

**Example:**

```javascript
const myHandler = dsl.withPerms(async (interaction) => {
    // ...
}, { userPerms: ["KICK_MEMBERS"] });
```

### `withConfirmation(prompt, handler, { confirmLabel, cancelLabel, ephemeral } = {})`

Shows a confirmation dialog before executing a handler.

**Example:**

```javascript
const myHandler = dsl.withConfirmation("Are you sure?", async (interaction) => {
    // ...
});
```

### `withPreconditions(handler, ...preconditions)`

Adds preconditions to a handler.

**Example:**

```javascript
const myHandler = dsl.withPreconditions(async (interaction) => {
    // ...
}, (interaction) => interaction.user.id === "1234567890");
```

## Embed (`core/embed.js`)

The `embed.js` file provides a simple way to create embeds.

### `createEmbed(config)`

Creates a new embed builder instance.

**Example:**

```javascript
import { createEmbed } from "./core/embed.js";
import { createConfig } from "./core/config.js";

const config = createConfig();
const embed = createEmbed(config);
```

### `base(color, opts = {})`

Creates a base embed.

**Example:**

```javascript
const myEmbed = embed.base(0x00FF00, { title: "My Embed" });
```

### `success(opts = {})`

Creates a success embed.

**Example:**

```javascript
const myEmbed = embed.success({ title: "Success!" });
```

### `error(opts = {})`

Creates an error embed.

**Example:**

```javascript
const myEmbed = embed.error({ title: "Error!" });
```

### `info(opts = {})`

Creates an info embed.

**Example:**

```javascript
const myEmbed = embed.info({ title: "Info" });
```

### `warn(opts = {})`

Creates a warning embed.

**Example:**

```javascript
const myEmbed = embed.warn({ title: "Warning!" });
```

### `neutral(opts = {})`

Creates a neutral embed.

**Example:**

```javascript
const myEmbed = embed.neutral({ title: "Neutral" });
```

## Events (`core/events.js`)

The `events.js` file provides a way to listen to Discord events.

### `createEvents(client, logger)`

Creates a new event handler instance.

**Example:**

```javascript
import { createEvents } from "./core/events.js";
import { Client } from "discord.js";
import { createLogger } from "./core/logger.js";

const client = new Client({ intents: [] });
const logger = createLogger();
const events = createEvents(client, logger);
```

### `on(moduleName, event, handler)`

Listens to an event.

**Example:**

```javascript
events.on("my-module", "messageCreate", (message) => {
    console.log(message.content);
});
```

### `once(moduleName, event, handler)`

Listens to an event once.

**Example:**

```javascript
events.once("my-module", "ready", () => {
    console.log("Ready!");
});
```

### `off(moduleName, event, handler)`

Stops listening to an event.

**Example:**

```javascript
const handler = (message) => console.log(message.content);
events.on("my-module", "messageCreate", handler);
events.off("my-module", "messageCreate", handler);
```

### `addListener(moduleName, emitter, event, handler, { once = false } = {})`

Adds a listener to any event emitter.

**Example:**

```javascript
import { EventEmitter } from "events";
const myEmitter = new EventEmitter();
events.addListener("my-module", myEmitter, "myEvent", () => {
    console.log("myEvent triggered!");
});
myEmitter.emit("myEvent");
```

### `removeModule(moduleName)`

Removes all listeners for a specific module.

**Example:**

```javascript
events.removeModule("my-module");
```

## Guild Config (`core/guildConfig.js`)

The `guildConfig.js` file provides a way to store configuration for a specific guild.

### `createGuildConfig({ mongo, logger, config })`

Creates a new guild config instance.

**Example:**

```javascript
import { createGuildConfig } from "./core/guildConfig.js";
// ... import other dependencies

const guildConfig = createGuildConfig({ mongo, logger, config });
```

### `setLocale(guildId, locale)`

Sets the locale for a guild.

**Example:**

```javascript
guildConfig.setLocale("1234567890", "en-US");
```

### `getLocale(guildId)`

Gets the locale for a guild.

**Example:**

```javascript
const locale = guildConfig.getLocale("1234567890");
```

### `set(guildId, key, value)`

Sets a value for a guild.

**Example:**

```javascript
guildConfig.set("1234567890", "prefix", "!");
```

### `get(guildId, key, fallback = undefined)`

Gets a value for a guild.

**Example:**

```javascript
const prefix = guildConfig.get("1234567890", "prefix", "!");
```

## HTTP (`core/http.js`)

The `http.js` file provides a simple way to make HTTP requests.

### `createHttp(config, logger)`

Creates a new HTTP client instance.

**Example:**

```javascript
import { createHttp } from "./core/http.js";
import { createConfig } from "./core/config.js";
import { createLogger } from "./core/logger.js";

const config = createConfig();
const logger = createLogger();
const http = createHttp(config, logger);
```

### `request(method, url, { headers, body, timeoutMs, retries } = {})`

Makes an HTTP request.

**Example:**

```javascript
const response = await http.request("GET", "https://api.example.com/users");
```

### `get(url, opts = {})`

Makes a GET request.

**Example:**

```javascript
const response = await http.get("https://api.example.com/users");
```

### `post(url, data, opts = {})`

Makes a POST request.

**Example:**

```javascript
const response = await http.post("https://api.example.com/users", { name: "test" });
```

### `patch(url, data, opts = {})`

Makes a PATCH request.

**Example:**

```javascript
const response = await http.patch("https://api.example.com/users/1", { name: "test2" });
```

### `delete(url, opts = {})`

Makes a DELETE request.

**Example:**

```javascript
const response = await http.delete("https://api.example.com/users/1");
```

## i18n (`core/i18n.js`)

The `i18n.js` file provides a simple way to handle internationalization.

### `createI18n({ config, logger })`

Creates a new i18n instance.

**Example:**

```javascript
import { createI18n } from "./core/i18n.js";
import { createConfig } from "./core/config.js";
import { createLogger } from "./core/logger.js";

const config = createConfig();
const logger = createLogger();
const i18n = createI18n({ config, logger });
```

### `t({ key, params, locale, moduleName } = {})`

Translates a key.

**Example:**

```javascript
i18n.register("en", { "hello": "Hello, {name}!" });
const greeting = i18n.t({ key: "hello", params: { name: "world" } });
```

### `safeT(key, { defaultValue, locale, moduleName, params } = {})`

Safely translates a key.

**Example:**

```javascript
const greeting = i18n.safeT("goodbye", { defaultValue: "Goodbye!" });
```

### `register(locale, entries)`

Registers a set of translations.

**Example:**

```javascript
i18n.register("en", { "hello": "Hello!" });
```

## IDs (`core/ids.js`)

The `ids.js` file provides a way to create and parse custom IDs for interactions.

### `createIds()`

Creates a new ID generator instance.

**Example:**

```javascript
import { createIds } from "./core/ids.js";

const ids = createIds();
```

### `make(moduleName, type, name, extras = {})`

Creates a custom ID.

**Example:**

```javascript
const myId = ids.make("my-module", "button", "my-button", { userId: "1234567890" });
```

### `parse(customId)`

Parses a custom ID.

**Example:**

```javascript
const { module, type, name, extras } = ids.parse(myId);
```

## Interactions (`core/interactions.js`)

The `interactions.js` file provides a way to handle interactions.

### `createInteractions(client, logger)`

Creates a new interaction handler instance.

**Example:**

```javascript
import { createInteractions } from "./core/interactions.js";
import { Client } from "discord.js";
import { createLogger } from "./core/logger.js";

const client = new Client({ intents: [] });
const logger = createLogger();
const interactions = createInteractions(client, logger);
```

### `registerButton(moduleName, customId, handler, { prefix = false } = {})`

Registers a button handler.

**Example:**

```javascript
interactions.registerButton("my-module", "my-button", (interaction) => {
    interaction.reply("Button clicked!");
});
```

### `registerSelect(moduleName, customId, handler, { prefix = false } = {})`

Registers a select menu handler.

**Example:**

```javascript
interactions.registerSelect("my-module", "my-select", (interaction) => {
    interaction.reply(`You selected: ${interaction.values.join(", ")}`);
});
```

### `registerModal(moduleName, customId, handler, { prefix = false } = {})`

Registers a modal handler.

**Example:**

```javascript
interactions.registerModal("my-module", "my-modal", (interaction) => {
    const favoriteColor = interaction.fields.getTextInputValue("favoriteColorInput");
    interaction.reply(`Your favorite color is ${favoriteColor}`);
});
```

### `registerUserContext(moduleName, commandName, handler)`

Registers a user context menu handler.

**Example:**

```javascript
interactions.registerUserContext("my-module", "Get User Info", (interaction) => {
    interaction.reply(`User: ${interaction.targetUser.username}`);
});
```

### `registerMessageContext(moduleName, commandName, handler)`

Registers a message context menu handler.

**Example:**

```javascript
interactions.registerMessageContext("my-module", "Get Message Info", (interaction) => {
    interaction.reply(`Message: ${interaction.targetMessage.content}`);
});
```

### `removeModule(moduleName)`

Removes all interaction handlers for a specific module.

**Example:**

```javascript
interactions.removeModule("my-module");
```

## Logger (`core/logger.js`)

The `logger.js` file provides a simple way to log messages.

### `createLogger(level = "info")`

Creates a new logger instance.

**Example:**

```javascript
import { createLogger } from "./core/logger.js";

const logger = createLogger();
```

### `childLogger(parent, moduleName)`

Creates a child logger.

**Example:**

```javascript
import { createLogger, childLogger } from "./core/logger.js";

const parentLogger = createLogger();
const myModuleLogger = childLogger(parentLogger, "my-module");
```

## Metrics (`core/metrics.js`)

The `metrics.js` file provides a simple way to collect metrics.

### `createMetrics(logger)`

Creates a new metrics instance.

**Example:**

```javascript
import { createMetrics } from "./core/metrics.js";
import { createLogger } from "./core/logger.js";

const logger = createLogger();
const metrics = createMetrics(logger);
```

### `counter(name)`

Creates a counter.

**Example:**

```javascript
const myCounter = metrics.counter("my-counter");
myCounter.inc();
```

### `gauge(name)`

Creates a gauge.

**Example:**

```javascript
const myGauge = metrics.gauge("my-gauge");
myGauge.set(100);
```

### `timer(name)`

Creates a timer.

**Example:**

```javascript
const myTimer = metrics.timer("my-timer");
myTimer.start();
// ...
myTimer.stop();
```

## Mongo (`core/mongo.js`)

The `mongo.js` file provides a simple way to interact with a MongoDB database.

### `createMongo(config, logger)`

Creates a new MongoDB client instance.

**Example:**

```javascript
import { createMongo } from "./core/mongo.js";
import { createConfig } from "./core/config.js";
import { createLogger } from "./core/logger.js";

const config = createConfig();
const logger = createLogger();
const mongo = createMongo(config, logger);
```

### `getDb()`

Gets the database instance.

**Example:**

```javascript
const db = await mongo.getDb();
```

### `getCollection(name)`

Gets a collection.

**Example:**

```javascript
const users = await mongo.getCollection("users");
```

### `ping()`

Pings the database.

**Example:**

```javascript
const result = await mongo.ping();
```

### `close()`

Closes the database connection.

**Example:**

```javascript
await mongo.close();
```

## Permissions (`core/permissions.js`)

The `permissions.js` file provides a simple way to check for permissions.

### `createPermissions(embed, logger)`

Creates a new permissions handler instance.

**Example:**

```javascript
import { createPermissions } from "./core/permissions.js";
import { createEmbed } from "./core/embed.js";
import { createLogger } from "./core/logger.js";

const embed = createEmbed();
const logger = createLogger();
const permissions = createPermissions(embed, logger);
```

### `hasUserPerms(member, perms = [])`

Checks if a user has a set of permissions.

**Example:**

```javascript
if (permissions.hasUserPerms(interaction.member, ["KICK_MEMBERS"])) {
    // ...
}
```

### `hasBotPerms(guild, perms = [])`

Checks if the bot has a set of permissions.

**Example:**

```javascript
if (permissions.hasBotPerms(interaction.guild, ["KICK_MEMBERS"])) {
    // ...
}
```

### `ensureInteractionPerms(interaction, { userPerms = [], botPerms = [] } = {})`

Ensures that the user and bot have the required permissions for an interaction.

**Example:**

```javascript
await permissions.ensureInteractionPerms(interaction, { userPerms: ["KICK_MEMBERS"] });
```

## Rate Limiter (`core/rateLimiter.js`)

The `rateLimiter.js` file provides a simple way to rate limit actions.

### `createRateLimiter(logger)`

Creates a new rate limiter instance.

**Example:**

```javascript
import { createRateLimiter } from "./core/rateLimiter.js";
import { createLogger } from "./core/logger.js";

const logger = createLogger();
const rateLimiter = createRateLimiter(logger);
```

### `take(key, opts)`

Takes a token from the rate limiter.

**Example:**

```javascript
const { allowed } = rateLimiter.take(interaction.user.id);
if (!allowed) {
    // ...
}
```

### `setConfig(key, { capacity, refillPerSec })`

Sets the configuration for a rate limiter.

**Example:**

```javascript
rateLimiter.setConfig(interaction.user.id, { capacity: 5, refillPerSec: 1 });
```

### `clear(key)`

Clears a rate limiter.

**Example:**

```javascript
rateLimiter.clear(interaction.user.id);
```

### `resetAll()`

Resets all rate limiters.

**Example:**

```javascript
rateLimiter.resetAll();
```

## Reporting (`core/reporting.js`)

The `reporting.js` file provides a simple way to report errors.

### `createErrorReporter({ config, logger })`

Creates a new error reporter instance.

**Example:**

```javascript
import { createErrorReporter } from "./core/reporting.js";
import { createConfig } from "./core/config.js";
import { createLogger } from "./core/logger.js";

const config = createConfig();
const logger = createLogger();
const errorReporter = createErrorReporter({ config, logger });
```

### `report(error, context = {})`

Reports an error.

**Example:**

```javascript
try {
    // ...
} catch (error) {
    errorReporter.report(error);
}
```

## Result (`core/result.js`)

The `result.js` file provides a simple way to return results from functions.

### `Result.ok(value)`

Returns a success result.

**Example:**

```javascript
import { Result } from "./core/result.js";

function myFunc() {
    return Result.ok("Success!");
}
```

### `Result.err(code, message, meta = {})`

Returns an error result.

**Example:**

```javascript
import { Result, ErrorCodes } from "./core/result.js";

function myFunc() {
    return Result.err(ErrorCodes.UNKNOWN, "An error occurred.");
}
```

## Scheduler (`core/scheduler.js`)

The `scheduler.js` file provides a simple way to schedule tasks.

### `createScheduler(logger)`

Creates a new scheduler instance.

**Example:**

```javascript
import { createScheduler } from "./core/scheduler.js";
import { createLogger } from "./core/logger.js";

const logger = createLogger();
const scheduler = createScheduler(logger);
```

### `schedule(cronExpr, fn, { timezone, immediate = false } = {})`

Schedules a task.

**Example:**

```javascript
scheduler.schedule("* * * * *", () => {
    console.log("This runs every minute!");
});
```

### `stopAll()`

Stops all scheduled tasks.

**Example:**

```javascript
scheduler.stopAll();
```

### `list()`

Lists all scheduled tasks.

**Example:**

```javascript
const numTasks = scheduler.list();
```

## State (`core/state.js`)

The `state.js` file provides a simple way to manage state.

### `createStateManager(logger, { provider = "memory", options = {} } = {})`

Creates a new state manager instance.

**Example:**

```javascript
import { createStateManager } from "./core/state.js";
import { createLogger } from "./core/logger.js";

const logger = createLogger();
const stateManager = createStateManager(logger);
```

### `withKey(key, ttlMs = defaultTtlMs)`

Gets a state object for a specific key.

**Example:**

```javascript
const myState = stateManager.withKey("my-key");
await myState.set("foo", "bar");
```

### `forInteraction(interaction, ttlMs = defaultTtlMs)`

Gets a state object for a specific interaction.

**Example:**

```javascript
const interactionState = stateManager.forInteraction(interaction);
await interactionState.set("foo", "bar");
```

### `dispose()`

Disposes of the state manager.

**Example:**

```javascript
stateManager.dispose();
```

## UI (`core/ui.js`)

The `ui.js` file provides a set of high-level UI helpers.

### `createPaginatedEmbed(ctx, builder, moduleName, pages, { ephemeral = true, initialIndex = 0 } = {})`

Creates a paginated embed.

**Example:**

```javascript
import { createPaginatedEmbed } from "./core/ui.js";

const pages = [
    { title: "Page 1" },
    { title: "Page 2" },
];

const { message, dispose } = createPaginatedEmbed(ctx, builder, "my-module", pages);
await interaction.reply(message);
```

### `createConfirmationDialog(ctx, builder, moduleName, prompt, onConfirm, onCancel, { ephemeral = true } = {})`

Creates a confirmation dialog.

**Example:**

```javascript
import { createConfirmationDialog } from "./core/ui.js";

const { message, dispose } = createConfirmationDialog(ctx, builder, "my-module", "Are you sure?", (interaction) => {
    interaction.reply("Confirmed!");
});
await interaction.reply(message);
```

### `createMultiSelectMenu(ctx, builder, moduleName, options, onSelect, { placeholder = "Select...", maxValues = 1, ephemeral = true } = {})`

Creates a multi-select menu.

**Example:**

```javascript
import { createMultiSelectMenu } from "./core/ui.js";

const options = [
    { label: "Option 1", value: "1" },
    { label: "Option 2", value: "2" },
];

const { message, dispose } = createMultiSelectMenu(ctx, builder, "my-module", options, (interaction, values) => {
    interaction.reply(`You selected: ${values.join(", ")}`);
});
await interaction.reply(message);
```

### `createForm(ctx, builder, moduleName, { title, fields })`

Creates a form.

**Example:**

```javascript
import { createForm } from "./core/ui.js";

const { modal, open } = createForm(ctx, builder, "my-module", {
    title: "My Form",
    fields: [
        { name: "name", label: "Name" },
    ],
});

await open(interaction);
```

### `parseModal(interaction)`

Parses a modal submission.

**Example:**

```javascript
myCommand.onModal("my-modal", (interaction) => {
    const { name } = parseModal(interaction);
    interaction.reply(`Your name is ${name}`);
});
```

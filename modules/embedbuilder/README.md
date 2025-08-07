# Embed Builder Module

Interactive embed builder with live preview, per-guild templates, import/export, and send-to-channel.

- Command: `/embedbuilder`
- Features:
  - Live preview (ephemeral)
  - Edit via modals: title, description, color, images, footer, author
  - Fields: add and clear
  - Channel select (text channels and threads)
  - Send to selected channel (permission-gated)
  - Per-guild templates: save, load, remove (permission-gated)
  - Export/Import JSON (Discord-compatible embed JSON)

## Requirements

- Node 18+
- Core initialized with createCore() and v2 builders available
- Mongo configured (used for template persistence)
- Feature flag enabled (default true)

See [docs/create_a_module.md](docs/create_a_module.md:1) and [docs/core_functions.md](docs/core_functions.md:31) for the integration patterns.

## Install and Wiring

1) Import and initialize the module during startup:

```js
// index.js (root startup)
import { Client, GatewayIntentBits } from "discord.js";
import { createCore } from "./core/index.js";
import EmbedBuilder from "./modules/embedbuilder/index.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const core = createCore(client);

client.once("ready", async () => {
  const ctx = core;
  await EmbedBuilder(ctx);

  // Deploy commands
  const guildId = process.env.GUILD_ID;
  if (guildId) await ctx.commands.installGuild(guildId);
  else await ctx.commands.installGlobal();

  ctx.logger.info("[Startup] Embed Builder module installed");
});

client.login(process.env.DISCORD_TOKEN);
```

2) Ensure environment variables:
- `MODULE_EMBEDBUILDER_ENABLED=true`
- `EMBEDBUILDER_MAX_TEMPLATES=50` (optional)

You can copy the example file:
- `modules/embedbuilder/module.env.example`

## Permissions

- Open `/embedbuilder`: everyone
- Save/Remove template buttons: requires `ManageGuild`
- Send to channel: requires `ManageMessages` for the user and `SendMessages`, `EmbedLinks` for the bot in the selected channel

These are enforced via DSL wrappers:
- `ctx.dsl.withPerms`
- `ctx.permissions.ensureInteractionPerms`

## UX Overview

When a user runs `/embedbuilder`, the bot replies ephemerally with:
- Buttons:
  - Title, Description, Color, Images, Add Field
  - Save, Load, Remove, Export, Import
  - Clear Fields, Send
- Channel Select (text-capable channels):
  - GuildText, Announcement, PublicThread, PrivateThread
- Live embed preview based on the current draft

Operations:
- Edit buttons open modals; on submit, draft updates and UI re-renders
- Save opens a modal for key and name, persists to Mongo (per guild)
- Load shows select of up to 25 recent templates
- Remove shows select then deletes selected template
- Export replies with JSON (inline if small or as file)
- Import opens modal for JSON; parses, validates, applies
- Send posts the embed to the selected channel

## Persistence

Mongo collection `embed_templates`:
- Document shape (simplified):
```json
{
  "guildId": "123",
  "key": "announcement",
  "name": "Announcement",
  "data": { "data": { /* Discord embed JSON */ } },
  "createdBy": "userId",
  "updatedBy": "userId",
  "createdAt": "ISO",
  "updatedAt": "ISO"
}
```

Indexes:
- Unique: `{ guildId: 1, key: 1 }`
- Secondary: `{ guildId: 1, updatedAt: -1 }`

Max templates per guild:
- Controlled by `EMBEDBUILDER_MAX_TEMPLATES` (default 50)

Service API:
- `ensureIndexes(ctx)`
- `save(ctx, guildId, key, { name, data }, userId)`
- `get(ctx, guildId, key)`
- `list(ctx, guildId, limit)`
- `remove(ctx, guildId, key)`
- `exportOne(ctx, guildId, key)`
- `importOne(ctx, guildId, json, keyOpt, userId)`

## Validation

Validation enforces Discord embed limits:
- Title ≤ 256
- Description ≤ 4096
- Fields ≤ 25, each name ≤ 256, value ≤ 1024
- Footer text ≤ 2048
- Author name ≤ 256
- Total characters ≤ 6000
- Color in 0..0xFFFFFF
- URLs must be http/https

See [`modules/embedbuilder/utils/schema.js`](modules/embedbuilder/utils/schema.js:1).

Preview rendering uses a safe builder to avoid breaking the UI with invalid inputs:
See [`modules/embedbuilder/utils/preview.js`](modules/embedbuilder/utils/preview.js:1).

## Files

- [`modules/embedbuilder/index.js`](modules/embedbuilder/index.js:1): Module wiring and lifecycle
- [`modules/embedbuilder/handlers/builder.js`](modules/embedbuilder/handlers/builder.js:1): Command and interaction handlers
- [`modules/embedbuilder/services/templates.js`](modules/embedbuilder/services/templates.js:1): Mongo persistence
- [`modules/embedbuilder/utils/schema.js`](modules/embedbuilder/utils/schema.js:1): Validation and normalization
- [`modules/embedbuilder/utils/components.js`](modules/embedbuilder/utils/components.js:1): UI component helpers
- [`modules/embedbuilder/utils/preview.js`](modules/embedbuilder/utils/preview.js:1): Live preview embed builder
- [`modules/embedbuilder/module.env.example`](modules/embedbuilder/module.env.example:1)

## Notes and Future Enhancements

- Add a paginated or autocomplete template picker for large template sets
- Add per-user private saved drafts (separate collection or state key)
- Add granular field manager (edit/remove per field)
- Add multi-embed support (send multiple embeds at once)
- Add i18n strings and localizations
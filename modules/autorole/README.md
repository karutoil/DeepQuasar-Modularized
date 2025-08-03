# Autorole Module for DeepQuasar

Automatically assign a configured role to new members with optional delay, bot-ignore, and minimum account age gating. Includes an interactive configuration embed and per-guild settings stored in MongoDB.

## Features
- Assign a selected role to new members
- Optional delay before role application (can be disabled)
- Ignore bot accounts (toggle)
- Minimum account age gating in days (can be disabled)
- Interactive, ephemeral embed to configure settings
- Per-guild settings persisted in MongoDB
- Permission-gated: only users with Manage Guild can configure

## Setup

1) Enable module via environment:
- Set `MODULE_AUTOROLE_ENABLED=true` (see `module.env.example`)

2) Ensure the bot has required permissions in your servers:
- Manage Roles
- The role to assign must be below the bot’s highest role in the role hierarchy

3) MongoDB must be configured in the core (uses core/mongo.js). The collection used is `guild_autorole_settings`.

4) Command deployment:
- The runtime handler listens for `/autorole configure`. If your command deployer is separate, register:
  - Name: `autorole`
  - Description: Configure autorole for this server
  - Subcommand: `configure` — “Open configuration”
  - Default permissions: Manage Guild

## Usage

- In a server, run `/autorole configure` (requires Manage Guild).
- In the interactive UI:
  - Pick a Role using the Role Select menu
  - Set Delay: choose a preset or Custom (seconds up to 86400)
  - Toggle Ignore Bots on/off
  - Toggle Account Age Gate on/off and set days if enabled
  - Save to persist

Validation:
- Saving will be blocked if the chosen role cannot be assigned (role above or equal to bot’s highest, managed role, or missing Manage Roles permission).
- Runtime checks also guard against changes to hierarchy after saving.

## Behavior

- On member join:
  - If Ignore Bots: true and the user is a bot, skip
  - If Account Age Gate is enabled and account age is below threshold days, skip (debug log)
  - If Delay > 0, schedule role application; canceled automatically if the member leaves before it elapses
  - Otherwise, apply immediately if assignable and not already present

- Timers:
  - Stored per member and cleared on module dispose and on member leave

- Caching:
  - Per-guild settings cached with a short TTL (60s) and invalidated on save

- Hot Reload:
  - Listeners and timers registered with lifecycle and cleaned up on disposal

## Environment Variables

See `module.env.example`:
- `MODULE_AUTOROLE_ENABLED=true`
- `AUTOROLE_DEFAULT_IGNORE_BOTS=true`
- `AUTOROLE_MAX_DELAY_SECONDS=86400`

## Files

- modules/autorole/index.js — Module entry, registers commands and listeners
- modules/autorole/handlers/configure.js — Interactive configuration UI
- modules/autorole/handlers/memberJoin.js — Join handler and delayed apply logic
- modules/autorole/services/settings.js — Mongo-backed settings and validation helpers
- modules/autorole/utils/ui.js — (optional) UI helpers (inlined where practical)

## Troubleshooting

- Role not being applied:
  - Verify the configured role exists and is below the bot’s highest role
  - Ensure the bot has Manage Roles permission
  - Check that account age gate is not preventing assignment
  - Verify delay is not set too long or that the member didn’t leave before delay elapsed

- Command not visible:
  - Make sure your command deployer has registered `/autorole configure` and that you have Manage Guild permission
  - Confirm `MODULE_AUTOROLE_ENABLED=true`

- Mongo issues:
  - Check connectivity and that the `guild_autorole_settings` collection exists; indexes are created automatically

## License
MIT
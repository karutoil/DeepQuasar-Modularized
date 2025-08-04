# ModLog Search Module for DeepQuasar

This module provides a clean, performant interface to search Discord Audit Logs across ALL events, with rich filtering, pagination, and optional export.

## Features
- Search across ALL audit log events (discord.js v14 `AuditLogEvent`)
- Filters:
  - Event type (single or "all")
  - Executor (requestor) user
  - Target (actioned) user
  - Object references: channel, role, emoji, webhook, integration, stage instance, sticker, guildScheduledEvent, thread, applicationCommand
  - Time range: since/until (ISO or relative like `7d`, `4h`)
  - Reason contains (free text)
- Pagination via buttons (Next/Prev/Jump)
- Ephemeral responses by default (configurable later if needed)
- Optional export to CSV/JSON (planned)
- Permissions:
  - Requires `ViewAuditLog` for the requesting member
  - Bot must also have `ViewAuditLog`
- Hot-reload safe and respects feature flags

## Slash Commands
- `/modlog search` — Search audit logs with filters and pagination
- `/modlog export` — Export search results as CSV/JSON (optional, may be disabled)

## Environment Variables
See `module.env.example` for feature flags and defaults:
- `MODULE_MODLOG_ENABLED` — enable/disable module
- `MODLOG_DEFAULT_PAGE_SIZE` — page size for embeds (default 10)
- `MODLOG_MAX_FETCH` — hard cap on total logs to fetch per query (default 300)
- `MODLOG_CACHE_TTL_MS` — cache TTL for per-guild result windows (default 15000 ms)
- `MODLOG_EXPORT_MAX` — max rows allowed for export (default 2000)

## Setup
1. Enable the module with `MODULE_MODLOG_ENABLED=true` in your `.env`.
2. Ensure the bot and requesting users have `ViewAuditLog` permission.
3. Deploy commands (your bot core likely handles auto-deploy on startup).

## Hot-Reload & Lifecycle
All handlers and listeners are registered with the lifecycle manager for safe hot-reloading. Disposables are cleaned on module unload.

## Extensibility
- Add new event mappings or aliases in `utils/constants.js`
- Extend filter parsing in `utils/filters.js`
- Swap cache strategy in `services/cacheService.js`

## Troubleshooting
- Ensure the bot has `ViewAuditLog` on the guild
- Audit logs API can be rate-limited; queries apply caps and backoff
- Large filters may be narrowed by choosing an `event` to allow server-side `type` narrowing

## License
MIT
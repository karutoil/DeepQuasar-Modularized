# Temporary Voice Channels Module for DeepQuasar

Temporary, resilient, and self-healing voice channels for Discord.js v14 with per-guild settings and MongoDB persistence. This module follows the same lifecycle and structure as the Tickets module, minimizing slash command usage by providing interactive embeds, buttons, and select menus for both admins and users.

## Status

Scaffolded with module lifecycle, handlers, services, utils, environment defaults, and indexes. Next steps are to implement handlers and services behavior incrementally.

## Features (design)

Admin Configuration (interactive UI via /vc-setup)
- Enable/Disable Temporary VC System
- Select trigger voice channel(s) that users join to auto-create temporary VCs
- Configure naming format: "{username}'s Channel", "Party #{counter}", supports user prefs
- Set base category with auto-sharding (Temp VC A/B/C...) up to configurable shard cap
- Auto-delete empty temp VCs after X seconds; grace period before deletion
- Max number of temp VCs allowed per server or per user, and per-user cooldowns
- Permissions: default template (owner/everyone/bot), role-based templates, admin bypass roles, creator roles
- Logging: event logging toggle, target channel, soft dependency to modlog module if enabled
- Cleanup controls: force delete all temp VCs, idle/timeouts
- Stats & Metrics: view counts, peaks, recoveries, reassignment numbers; export JSON/CSV
- Command control and rate limits

User-Side Features
- Join trigger VC to auto-create a temporary VC
- Channel owner commands (/vc ...):
  - rename, lock/unlock, limit, kick, ban, permit, deny, claim, info
- Interactive control panel in the VC: buttons and selects with ephemeral responses
- Ownership management: auto reassignment; /vc claim
- Notifications: creation notice, pre-deletion reminder
- Persistent user preferences: name pattern, default limit
- i18n-ready responses (English baseline wired to core/i18n)

Reliability & Recovery
- Persistent storage of all VC metadata (MongoDB): owner, settings, permissions, timestamps
- Startup integrity scan: reconcile channels, permissions, ownership, and delete orphans
- Scheduled integrity checks (hourly) and idle checks (every 5 minutes)
- Crash protection: write-through snapshots of presence and lastActiveAt
- Self-healing for missing categories/roles; admin notification and logging
- Downtime metrics and restart summaries; admin override commands for recovery

## Defaults (approved)

- Persistence: MongoDB via core/mongo.js
- Modlog: use modules/modlog if enabled, fallback to configured log channel
- Triggers: multiple trigger channels; optional command-trigger supported
- Categories: auto-shard Yes; Temp VC A/B/C...; max shards 10
- Permissions: default-open; lock toggles to restrict
- i18n: wired keys with English base strings
- Scheduler: idle checks every 5 minutes; integrity scan hourly

## Setup

1) Enable module via environment (see module.env.example):
- MODULE_TEMP_VC_ENABLED=true
- Optionally override default policy values.

2) Ensure MongoDB is configured in core (core/mongo.js).

3) Deploy slash commands:
- /vc-setup — Open the admin setup UI (Manage Guild recommended)
- /vc — User command group (rename, lock, unlock, limit, kick, ban, permit, deny, claim, info)
- /vc module — Admin tools (scan, cleanup, recover, status)

4) Required Discord permissions
- Admin using setup: Manage Server (ManageGuild)
- Bot in VC categories: ViewChannel, Connect, Speak, ManageChannels, MoveMembers, MuteMembers, DeafenMembers, PrioritySpeaker, ManageRoles recommended

## Environment Variables

See modules/temp-vc/module.env.example for all values. Key entries:
- MODULE_TEMP_VC_ENABLED
- TEMP_VC_DEFAULT_IDLE_TIMEOUT_SEC
- TEMP_VC_DEFAULT_GRACE_PERIOD_SEC
- TEMP_VC_MAX_SHARDS
- TEMP_VC_DEFAULT_NAMING_PATTERN
- TEMP_VC_DEFAULT_COOLDOWN_MS
- TEMP_VC_DEFAULT_SCHEDULED_DELETION_HOURS
- TEMP_VC_DEFAULT_LANGUAGE
- TEMP_VC_EVENT_LOGGING_DEFAULT

## Files

- modules/temp-vc/index.js — Module entry; registers commands, interactions, events, scheduler
- modules/temp-vc/handlers/
  - setup.js — /vc-setup and settings embed entry
  - adminMenus.js — Interactive config submenus and selectors
  - userCommands.js — /vc subcommands and router
  - voiceEvents.js — voiceStateUpdate, creation, reassignment, idle tracking
  - uiControls.js — in-channel controls (buttons/selects)
- modules/temp-vc/services/
  - settingsService.js — per-guild settings CRUD and defaults
  - repository.js — Mongo collections and ensureIndexes; data access helpers
  - channelService.js — creation, overwrites, category sharding, cleanup
  - ownerService.js — ownership tracking and reassignment
  - stateService.js — in-memory index with write-through crash snapshots
  - loggingService.js — standard logging; modlog soft dependency
  - integrityService.js — startup scan and scheduled self-healing
  - metricsService.js — counters, peaks, downtime, export
  - cooldownService.js — per-user cooldowns and rate limits
  - scheduler.js — schedules idle and integrity jobs (using core/scheduler)
- modules/temp-vc/utils/
  - components.js — embeds and components factories; i18n-aware
  - ids.js — customId namespacing for controls and menus
  - permissions.js — overwrite templates and reconciliation
  - validators.js — guards, safe replies, permission checks
  - naming.js — formatting for {username}, #{counter}

## Hot-Reload & Lifecycle

All command/interaction registrations and scheduled tasks are tracked via lifecycle disposables and cleaned up on dispose to support hot-reload, mirroring the tickets module approach.

## Smoke Test Checklist

1) Setup via /vc-setup
- Open setup panel (ephemeral) with Manage Guild
- Configure trigger channels, base category, auto-shard, naming pattern
- Set idle timeout, grace period, and delete-after-owner-leaves toggle
- Configure creator roles and admin bypass roles
- Set logging target and enable event logging
- Verify values persisted in MongoDB

2) Create a Temporary VC
- Join configured trigger VC
- Validate a new VC is created in the proper shard category with default-open permissions
- Confirm interactive control panel appears
- Confirm logging entry (modlog or configured log channel)

3) Owner controls
- Use lock/unlock and verify permissions reconcile
- Rename channel and set a user limit
- Kick and ban a member; permit and deny tests
- Use /vc claim when owner leaves and someone else is present

4) Idle and cleanup
- With short timeouts, idle until pre-deletion warning then deletion
- Validate lastActiveAt updated on presence changes

5) Integrity scan
- Restart bot; ensure orphaned channels are cleaned or recovered
- Validate re-applied permissions and ownership reassignment
- Use /vc module scan/cleanup/recover/status; verify summaries and metrics

## Metrics (optional)

If core/reporting is enabled, wire emission points at:
- VC created/deleted
- Ownership reassigned
- Orphans cleaned
- Startup recovery summaries
- Peak concurrent changes

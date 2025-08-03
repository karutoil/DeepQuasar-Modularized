# Tickets Module for DeepQuasar

Embed-first ticketing system for Discord.js v14 with per-guild settings and persistence in MongoDB. This module minimizes slash command usage by providing an interactive control embed with buttons and selects in each ticket channel.

## Status

This module is nearing completion. Core flows are implemented (setup UI, panel/type management, ticket creation, controls, scheduler). Guards and safe replies are enforced; logging is wired for key mutations. Final verification and documentation are included below.

## Features (design)

- One-time setup via `/ticket-setup` to open a settings embed with:
  - Set General Settings (category, log channel, support roles, transcript defaults, auto-closure)
  - Manage Ticket Panels (create/edit/delete panel messages)
  - Manage Ticket Types (create/edit/delete ticket types and map to panel buttons)
- User ticket creation via panel buttons with modal (title, description)
- Control embed per ticket channel with buttons:
  - Close, Add/Remove User, Lock/Unlock, Rename, Transcript, Transfer, Reopen
- Auto inactivity closure: default 48h inactivity, with 12h warning
- Transcript generation: HTML default, optionally text, DM to opener on close
- Reopen window: 24h after close

## Defaults (approved)

- Discord.js v14 components (ButtonBuilder, Selects, ModalBuilder)
- Transcript format default: HTML; DM transcript to user: true
- Inactivity auto-close: 48h; warning at 12h prior to close
- Reopen window: 24h

## Setup

1) Enable module via environment (see `module.env.example`):
- `MODULE_TICKETS_ENABLED=true`
- Optionally override default policy values.

2) Ensure MongoDB is configured in core (`core/mongo.js`).

3) Deploy the slash command:
- `/ticket-setup` — Open the module setup UI (Manage Guild permission recommended)

4) Required Discord permissions
- Admin using setup: Manage Server (ManageGuild)
- Bot in panel/target channels: ViewChannel, SendMessages, ReadMessageHistory, EmbedLinks, AttachFiles, ManageChannels, ManageMessages (for best results)

## Environment Variables

See `module.env.example` for all variables. Key entries:
- `MODULE_TICKETS_ENABLED`
- `TICKETS_DEFAULT_INACTIVITY_MS`
- `TICKETS_DEFAULT_WARNING_MS`
- `TICKETS_DEFAULT_REOPEN_MS`
- `TICKETS_DEFAULT_TRANSCRIPT_FORMAT`
- `TICKETS_DEFAULT_DM_TRANSCRIPT`

## Files

- modules/tickets/index.js — Module entry; registers command(s), interactions, scheduler; hot-reload safe
- modules/tickets/handlers/
  - setup.js — `/ticket-setup` and settings embed entry
  - adminMenus.js — general settings, panels, types submenus
  - panel.js — creating/updating/deleting panel messages
  - ticketInteraction.js — handling Create Ticket buttons and modals
  - ticketControls.js — control embed actions (close, add/remove, lock, rename, transcript, transfer, reopen)
- modules/tickets/services/
  - settingsService.js — per-guild settings in MongoDB
  - panelService.js — panel CRUD
  - typeService.js — ticket types CRUD
  - ticketService.js — lifecycle, channel perms, reopen, archival
  - transcriptService.js — transcript generation, upload, DM
  - inactivityService.js — inactivity tracking helpers
  - scheduler.js — cron-based auto-close checks using `core/scheduler.js`
  - loggingService.js — standardized logging to configured channel
- modules/tickets/utils/
  - components.js — embed/components factories
  - permissions.js — permission overwrites helpers
  - ids.js — customId namespacing and parsing
  - validators.js — guards/validation

## Hot-Reload & Lifecycle

All interaction registrations and scheduled tasks are tracked via the module lifecycle and cleaned up on dispose to support hot-reload.

## Smoke Test Checklist

Run these in a test guild with shortened inactivity thresholds if desired.

1) Setup general settings via `/ticket-setup`
- Open the setup panel; confirm the UI loads ephemerally (requires Manage Guild)
- Set Ticket Category (category channel), Log Channel, and Support Roles
- Open Transcript Options and ensure desired format and DM to user are set
- Open Auto-Closure Settings and set short intervals for testing (e.g., 5–10 minutes inactivity, 2–3 minutes warning lead)

2) Create a Type and set ping roles
- Create a new ticket type (e.g., “Support”)
- Edit the type to set a welcome message
- Configure ping roles for the type using the role select
- Verify a log entry is written for create/edit/pings in the configured log channel

3) Create a Panel and publish to a channel
- From “Manage Panels”, create a panel and pick a channel
- Validate the published embed and that buttons reflect available ticket types
- Confirm a panel record exists in DB; re-open edit and use “Re-publish” to ensure message links refresh if missing

4) Create a Ticket via the panel; verify control actions
- Click the panel button and submit the modal (title/description)
- Verify a new channel is created under the configured category with correct overwrites:
  - @everyone cannot view
  - Opener and support roles can view/send
  - Bot can manage channels/messages
- Validate the intro embed and control embed appear
- Test controls in the ticket channel (ephemeral responses with logging):
  - Lock (deny SendMessages for opener and @everyone), Unlock (restore)
  - Rename channel
  - Add/Remove user
  - Generate Transcript

5) Close the ticket
- Use Close -> provide reason -> Confirm Close
- Verify transcript generated and uploaded; DM to opener sent if configured
- Channel deleted after close; ticket archived in DB; log entry present

6) Inactivity warning and auto-close behavior
- With short thresholds, wait for warning message and verify warnedAt is set
- After inactivity threshold, verify auto-close:
  - Transcript generated
  - Opener DM (if enabled)
  - Channel deleted and ticket archived
  - Log entries present

7) Reopen within window
- Attempt to reopen a recently closed ticket within reopen window
- Verify permission requirements (opener or Manage Guild) and log entry

## Metrics (optional)
If core/reporting is available and enabled, wire emission points at:
- Ticket created/closed/archived
- Transcript generated
- Auto-close
- Panel edits (add/remove/republish)
All metrics calls should be no-ops when disabled.

## Roadmap

- Implement per-guild settings CRUD with validation
- Implement panel and ticket type management flows
- Implement ticket creation and control actions
- Implement transcripts (HTML + text) and logging
- Implement inactivity scheduler with warning and auto-close
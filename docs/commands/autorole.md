---
title: "Autorole"
description: "Interactive /autorole configuration command"
tags: ["module","autorole","commands"]
module: autorole
created: 2025-08-15
updated: 2025-08-15
---
<!--DOC-JSON-->{"title":"Autorole","module":"autorole","tags":["commands","config"],"version":"1.0"}<!--/DOC-JSON-->

# Autorole

Short summary: Opens an ephemeral interactive configuration UI to manage automatic role assignment for new members (role, delay, account age gate, ignore bots).

## Commands

- /autorole
  - Description: Open autorole configuration UI.
  - Permission: Manage Guild

## Usage

`/autorole`

The command opens an ephemeral panel with a Role select menu and multiple buttons/modals to set:

- Role (RoleSelectMenu)
- Delay presets: no delay, 10s, 60s, 5m, custom (modal: seconds)
- Toggle: Ignore bots
- Account age gate toggle and custom days (modal)
- Save (persists settings) and Cancel

## Options (interaction components)

- role (RoleSelectMenu) — required before Save; selects the role to assign.
- delay (buttons) — presets or custom via modal (seconds, 0-86400).
- ignoreBots (button toggle) — boolean.
- minAccountAgeDays (modal) — integer >= 0 or disabled.

## Notes

- Settings persist to guild storage and invalidate the autorole cache.
- The UI maintains an in-memory session per builder message; re-running the command creates a fresh session.

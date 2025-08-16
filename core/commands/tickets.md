---
title: "Tickets"
description: "Ticketing module commands and setup UI"
tags: ["module","tickets","commands"]
module: tickets
created: 2025-08-15
updated: 2025-08-15
---
<!--DOC-JSON-->{"title":"Tickets","module":"tickets","tags":["commands","tickets"],"version":"1.0"}<!--/DOC-JSON-->

# Tickets

Short summary: Ticketing system with `/ticket-setup` command to open a setup panel; additional interactions are provided via buttons and panels.

## Command

- /ticket-setup
  - Description: Open the Tickets module setup panel for this server.
  - Permission: Manage Guild
  - Response: Ephemeral embed with buttons to configure general settings, manage panels, and manage ticket types.

## Behavior & Interactions

- Setup buttons route to admin menus where panels and types can be created/edited.
- Panel messages (public) are used by users to open tickets; handlers for panel interactions and ticket controls are registered by the module.

## Notes

- Several handlers and buttons are registered under the module namespace; the `/ticket-setup` command is the main entry point for admins.
- Data is persisted in MongoDB; indexes are ensured at startup.

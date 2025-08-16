---
title: "Stats"
description: "Bot and host statistics command"
tags: ["module","stats","commands"]
module: stats
created: 2025-08-15
updated: 2025-08-15
---
<!--DOC-JSON-->{"title":"Stats","module":"stats","tags":["commands","diagnostics"],"version":"1.0"}<!--/DOC-JSON-->

# Stats

Short summary: `/stats` shows comprehensive bot and host statistics with refresh and toggle buttons for advanced details.

## Command

- /stats
  - Description: Show comprehensive bot and host statistics
  - Options: none
  - Response: Ephemeral embed with Overview, Memory, CPU/Load (toggle)
  - Buttons: Refresh, Show/Hide Details

## Notes

- Includes uptime, WebSocket ping, guild/channel/user counts, memory and CPU stats, library versions, and command/module counts when available.
- Refresh button is rate-limited client-side (1s minimum between refreshes).

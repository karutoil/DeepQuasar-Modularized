---
title: "Welcome/Leave"
description: "Welcome and leave message setup command"
tags: ["module","welcome-leave","commands"]
module: WelcomeLeaveModule
created: 2025-08-15
updated: 2025-08-15
---
<!--DOC-JSON-->{"title":"WelcomeLeaveModule","module":"WelcomeLeaveModule","tags":["commands","welcome"],"version":"1.0"}<!--/DOC-JSON-->

# Welcome / Leave

Short summary: `/welcome-leave-setup` opens an interactive panel to configure welcome and leave messages, channels, and embed builders.

## Command

- /welcome-leave-setup
  - Description: Open the Welcome/Leave module setup panel for this server.
  - Permission: Manage Guild
  - Response: Ephemeral embed with toggles, channel selectors, and embed-config buttons.

## Interaction controls

- Toggle buttons: enable/disable welcome or leave messages
- Channel select menus: choose channels for welcome/leave
- Configure embed buttons: open the embed builder flow for welcome/leave messages
- Save & Exit button

## Notes

- Uses per-guild settings stored in MongoDB.
- The UI handlers are resilient to hot-reload; button customIds follow the `welcomeleave:` prefix.

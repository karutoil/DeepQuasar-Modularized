---
title: "Moderation"
description: "Moderation commands: kick, ban, warn, mute, modlog"
tags: ["module","moderation","commands"]
module: moderation
created: 2025-08-15
updated: 2025-08-15
---
<!--DOC-JSON-->{"title":"Moderation","module":"moderation","tags":["commands","moderation"],"version":"1.0"}<!--/DOC-JSON-->

# Moderation

Short summary: Exposes common moderation slash commands: `/kick`, `/ban`, `/warn`, `/mute`, and `/moderation` (modlog config).

## Commands

- /kick
  - Description: Kick a guild member.
  - Options:
    - user | user | required | User to kick
    - reason | string | optional | Reason for kick
  - Default permission: Kick Members

- /ban
  - Description: Ban or unban a user.
  - Subcommands:
    - add
      - user | user | required | User to ban
      - reason | string | optional
    - remove
      - userid | string | required (autocomplete) | User ID to unban
      - reason | string | optional
  - Default permission: Ban Members

- /warn
  - Description: Add/remove/list warnings for a user.
  - Subcommands:
    - add
      - user | user | required
      - reason | string | optional
    - remove
      - user | user | required
      - index | integer | required
    - list
      - user | user | required

- /mute
  - Description: Mute (timeout) or unmute a user.
  - Subcommands:
    - add
      - user | user | required
      - duration | integer | required | Minutes
      - reason | string | optional
    - remove
      - user | user | required
      - reason | string | optional

- /moderation
  - Description: Configure or view the moderation log channel (modlog)
  - Subcommands:
    - set
      - channel | channel (text) | required
    - show
      - no options
  - Default permission: Administrator

## Examples

- `/kick user:@User reason:Breaking rules`
- `/ban add user:@User reason:Severe misconduct`
- `/ban remove userid:123456789012345678`
- `/warn add user:@User reason:Spamming`
- `/mute add user:@User duration:30 reason:Spam`
- `/moderation set channel:#mod-log`

## Notes

- Commands perform permission checks and attempt to DM users when possible.
- Autocomplete used for unban target selection.

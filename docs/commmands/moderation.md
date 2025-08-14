## Module: moderation

This document lists the slash commands provided by the Moderation module.

### /kick
- Description: Kicks a user from the server.
- Options:
  - user (User) — required — User to kick
  - reason (String) — optional — Reason for the kick
- Example:
  /kick user:@SomeUser reason:Breaking rules

### /ban
- Description: Ban or unban a user (subcommands).
- Subcommands:
  - add
    - Description: Ban a user.
    - Options:
      - user (User) — required — User to ban
      - reason (String) — optional — Reason for ban
    - Example: /ban add user:@SomeUser reason:Repeated violations

  - remove
    - Description: Unban a user.
    - Options:
      - userid (String) — required — User ID to unban (autocomplete provided)
      - reason (String) — optional — Reason for unban
    - Example: /ban remove userid:123456789012345678 reason:Apology accepted

Notes:
- The `userid` option on the `remove` subcommand supports autocomplete (returns matching banned users).
- Handlers DM users when possible and log actions to the modlog service.

### /warn
- Description: Warn a user or manage warnings (subcommands).
- Subcommands:
  - add
    - Options: user (User, required), reason (String, optional)
    - Example: /warn add user:@SomeUser reason:Inappropriate language

  - remove
    - Options: user (User, required), index (Integer, required) — remove specific warning index
    - Example: /warn remove user:@SomeUser index:1

  - list
    - Options: user (User, required) — lists warnings for the user
    - Example: /warn list user:@SomeUser

### /mute
- Description: Mute (timeout) or unmute a user (subcommands).
- Subcommands:
  - add
    - Options: user (User, required), duration (Integer minutes, required), reason (String, optional)
    - Example: /mute add user:@SomeUser duration:60 reason:Spam

  - remove
    - Options: user (User, required), reason (String, optional)
    - Example: /mute remove user:@SomeUser reason:Time served

### /moderation
- Description: Configure or view the moderation log channel (registered by moderation handler).
- Subcommands:
  - set
    - Options: channel (Channel, required) — channel to send mod logs
    - Example: /moderation set channel:#mod-logs

  - show
    - Description: Show current moderation log channel
    - Example: /moderation show

Permissions and notes:
- Some moderation actions attempt DM delivery and will log actions to the configured mod log channel.
- The module performs permission checks in-code; server administrators should ensure appropriate roles can run these commands.

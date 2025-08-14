## Module: ModerationModule

### /ban
- Description: Ban or unban a user.
- Options:
  - user (User) — optional
  - reason (String) — optional
  - userid (String) — optional
  - reason (String) — optional
- Subcommands:
  - add
  - remove
- Source: modules/ModerationModule/handlers/ban.js

### /kick
- Description: Kicks a user from the server.
- Options:
  - user (User) — optional
  - reason (String) — optional
- Source: modules/ModerationModule/handlers/kick.js

### /moderation
- Description: Configure or view the moderation log channel.
- Options:
  - channel (Channel) — optional
- Subcommands:
  - set
  - show
- Source: modules/ModerationModule/handlers/modlog.js

### /mute
- Description: Mute or unmute a user (timeout).
- Options:
  - user (User) — optional
  - duration (Integer) — optional
  - reason (String) — optional
  - user (User) — optional
  - reason (String) — optional
- Subcommands:
  - add
  - remove
- Source: modules/ModerationModule/handlers/mute.js

### /warn
- Description: Warn a user or manage warnings.
- Options:
  - user (User) — optional
  - reason (String) — optional
  - user (User) — optional
  - index (Integer) — optional
  - user (User) — optional
- Subcommands:
  - add
  - remove
  - list
- Source: modules/ModerationModule/handlers/warn.js

# ModerationModule

## Overview

ModerationModule provides robust moderation tools for Discord servers, including:

- **Kick**: Remove users from the server.
- **Ban**: Ban users (with subcommands for ban/unban and message history deletion).
- **Warn**: Issue, remove, and list persistent warnings for users.
- **Mute**: Timeout users (mute/unmute with duration).
- **Persistent Warnings**: Warnings are stored in MongoDB and survive bot restarts.
- **Moderation Logging**: All actions are logged to a configurable moderation log channel.

## Features

- Slash command interface with subcommands for each moderation action.
- Permission checks for each command.
- DM notifications to affected users.
- Moderation actions are logged for auditability.
- Warnings are stored and managed persistently.

## Setup Instructions

1. **Enable the Module**  
   Set the environment variable `MODERATION_ENABLED=true` in your bot's environment or configuration.

2. **Permissions**  
   Ensure the bot has the following Discord permissions:
   - Kick Members
   - Ban Members
   - Moderate Members (for mute/unmute)
   - Send Messages (for DM notifications)
   - Manage Roles (if required for mute)

3. **MongoDB Requirements**  
   - A MongoDB instance is required for persistent warnings.
   - Configure MongoDB connection in your core bot environment (see core documentation).

4. **Moderation Log Channel**  
   - Set up a moderation log channel in your guild configuration (`modLogChannel`).

## Command and Subcommand Documentation

### `/moderation kick`

- **Options**:
  - `target` (User, required): User to kick.
  - `reason` (String, optional): Reason for kick.
- **Permissions**: Kick Members
- **Flow**: Checks permissions, kicks user, DMs user, logs action.

### `/moderation ban`

- **Subcommands**:
  - `add`: Ban a user.
    - `user` (User, required): User to ban.
    - `reason` (String, optional): Reason for ban.
    - `deleteDays` (Integer, optional): Delete message history (days).
  - `remove`: Unban a user.
    - `userid` (String, required): User ID to unban.
    - `reason` (String, optional): Reason for unban.
- **Permissions**: Ban Members
- **Flow**: Checks permissions, bans/unbans user, DMs user, logs action.

### `/moderation warn`

- **Subcommands**:
  - `add`: Warn a user.
    - `user` (User, required): User to warn.
    - `reason` (String, optional): Reason for warning.
  - `remove`: Remove a warning.
    - `user` (User, required): User to remove warning from.
    - `index` (Integer, required): Warning index to remove.
  - `list`: List warnings.
    - `user` (User, required): User to list warnings for.
- **Permissions**: Moderate Members
- **Flow**: Checks permissions, persists warning, DMs user, logs action.

### `/moderation mute`

- **Subcommands**:
  - `add`: Mute a user.
    - `user` (User, required): User to mute.
    - `duration` (Integer, required): Duration in minutes.
    - `reason` (String, optional): Reason for mute.
  - `remove`: Unmute a user.
    - `user` (User, required): User to unmute.
    - `reason` (String, optional): Reason for unmute.
- **Permissions**: Moderate Members
- **Flow**: Checks permissions, applies/removes timeout, DMs user, logs action.

## Environment Variables

| Variable             | Purpose                                      |
|----------------------|----------------------------------------------|
| MODERATION_ENABLED   | Enables/disables the ModerationModule        |
| MONGODB_URI          | MongoDB connection string (core requirement) |
| MODLOG_CHANNEL_ID    | Discord channel ID for moderation logs       |

*Note: MongoDB and modlog channel configuration are handled via core bot context.*

## Usage Examples

### Kick a user

```
/moderation kick target:@User reason:"Spamming"
```

### Ban a user

```
/moderation ban add user:@User reason:"Abuse" deleteDays:7
```

### Unban a user

```
/moderation ban remove userid:123456789012345678 reason:"Appeal accepted"
```

### Warn a user

```
/moderation warn add user:@User reason:"Inappropriate language"
```

### Remove a warning

```
/moderation warn remove user:@User index:0
```

### List warnings

```
/moderation warn list user:@User
```

### Mute a user

```
/moderation mute add user:@User duration:30 reason:"Flooding chat"
```

### Unmute a user

```
/moderation mute remove user:@User reason:"Mute expired"
```

## Troubleshooting

- **Module not loading**: Ensure `MODERATION_ENABLED=true` and MongoDB is configured.
- **Permission errors**: Check bot and user permissions in Discord.
- **Moderation log not working**: Verify `modLogChannel` is set in guild config.
- **Warnings not persisting**: Confirm MongoDB connection and collection access.
- **DM failures**: Users may have DMs disabled; action still completes and logs.

## Integration Notes

- ModerationModule integrates with the core bot context (`ctx`), using core services for config, permissions, logging, and MongoDB.
- Ensure core bot is properly configured for MongoDB and guild config.
- Logging and warning services are attached to `ctx.moderation` for handler access.

## License

MIT License. See [LICENSE](../../LICENSE) for details.
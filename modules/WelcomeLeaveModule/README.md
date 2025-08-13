# WelcomeLeaveModule for DeepQuasar

Automated, customizable welcome and leave messages for Discord servers. Supports rich embed configuration, per-guild settings, and advanced placeholder replacement. Designed for seamless admin setup and robust integration with core services (localization, logging, MongoDB).

---

## Features

- **One-time setup via `/welcome-leave-setup`**: Interactive UI for configuring welcome/leave messages, channels, and embed content.
- **Per-guild settings**: Enable/disable welcome and leave messages independently, select target channels, and customize embed payloads.
- **Rich embed builder**: Visual builder for message embeds, supporting all standard fields and live preview.
- **Advanced placeholders**: Dynamic values for user, server, channel, inviter, and more (see below).
- **Localization-ready**: All user-facing strings support i18n via core/i18n.js.
- **Logging**: All key actions and errors are logged via core/logger.js.
- **MongoDB persistence**: Settings stored per guild in MongoDB, with in-memory caching for performance.
- **Hot-reload safe**: All handlers and scheduled tasks are cleaned up on module reload.

---

## Setup

1. **Enable the module via environment** (see `module.env.example`):
   - `MODULE_WELCOMELEAVE_ENABLED=true`
2. **Ensure MongoDB is configured** in core (`core/mongo.js`).
3. **Deploy the slash command**:
   - `/welcome-leave-setup` — Opens the setup UI (requires Manage Server permission).
4. **Required Discord permissions**:
   - Admin using setup: Manage Server (ManageGuild)
   - Bot in target channels: ViewChannel, SendMessages, EmbedLinks, ManageMessages (for best results)

---

## Usage Guide

### Admin Setup Flow

1. **Run `/welcome-leave-setup`** in your server.
2. **Configure Welcome and Leave Messages**:
   - Use toggles to enable/disable each message type.
   - Select the target channel for each message.
   - Click "Configure Welcome Embed" or "Configure Leave Embed" to open the embed builder.
3. **Embed Builder**:
   - Edit title, description, color, images, footer, and fields.
   - Insert placeholders (see below) for dynamic content.
   - Preview changes live.
   - Save to apply, or cancel to discard.
4. **Save & Exit**: Click "Save & Exit" to persist all changes.

### Example Configuration Flow

- Enable welcome messages, select a #welcome channel, and configure an embed with `{user.mention}` and `{server}` placeholders in the description.
- Enable leave messages, select a #goodbye channel, and set a custom embed with `{user.name}` and `{date}`.

---

## Placeholders Reference

You can use the following placeholders in any embed field (title, description, etc.):

| Placeholder           | Description                        |
|-----------------------|------------------------------------|
| `{user}`              | User's display name                |
| `{user.mention}`      | Mention the user                   |
| `{user.name}`         | User's username                    |
| `{user.tag}`          | User's tag (username#discrim)      |
| `{user.id}`           | User's Discord ID                  |
| `{user.avatar}`       | User's avatar URL                  |
| `{user.createdAt}`    | User account creation date         |
| `{user.joinedAt}`     | User's join date                   |
| `{user.roles}`        | Comma-separated user roles         |
| `{user.highestRole}`  | User's highest role                |
| `{user.bot}`          | "Yes" if user is a bot, else "No"  |
| `{server}`            | Server name                        |
| `{server.id}`         | Server ID                          |
| `{server.icon}`       | Server icon URL                    |
| `{server.memberCount}`| Server member count                |
| `{server.boostCount}` | Server boost count                 |
| `{server.boostTier}`  | Server boost tier                  |
| `{server.owner}`      | Server owner's username            |
| `{server.owner.mention}` | Mention the server owner         |
| `{channel}`           | Channel name                       |
| `{channel.name}`      | Channel name                       |
| `{channel.id}`        | Channel ID                         |
| `{time}`              | Current time (localized)           |
| `{date}`              | Current date (localized)           |
| `{position}`          | Member's join position (if available)|
| `{inviter}`           | Inviter's username (if available)  |
| `{inviter.mention}`   | Mention the inviter                |
| `{inviter.id}`        | Inviter's ID                       |
| `{inviter.tag}`       | Inviter's tag                      |
| `{invite.code}`       | Invite code (if available)         |
| `{invite.uses}`       | Invite uses (if available)         |

**How placeholders work:**  
Placeholders are replaced with real values at the time the message is sent. You can use them in any embed field, including title, description, footer, etc.

---

## Integration Notes

- **Core Services**:  
  - Uses `core/mongo.js` for settings storage.
  - Uses `core/logger.js` for logging all actions and errors.
  - Uses `core/i18n.js` for localization of all user-facing strings.
- **Embed Builder**:  
  - Leverages `modules/embedbuilder` utilities for embed validation and preview.
- **Hot-Reload**:  
  - All handlers and collectors are registered/disposed via the module lifecycle for safe hot-reload.

---

## Troubleshooting & Known Limitations

- **Bot lacks permissions**:  
  Ensure the bot has permission to send messages and embeds in the configured channels.
- **No message sent**:  
  - Check that the message type (welcome/leave) is enabled.
  - Ensure a channel is selected and an embed is configured.
- **Placeholders not replaced**:  
  - Only supported placeholders (see above) will be replaced.
  - If a placeholder is invalid or context is missing, it will be replaced with an empty string.
- **Embed validation errors**:  
  - The embed builder will prevent saving invalid embeds.
  - If an invalid embed is set via the database, the module will log a warning and skip sending the message.
- **MongoDB required**:  
  - The module requires a working MongoDB connection for settings persistence.
- **No support for DMs**:  
  - Welcome/leave messages are only sent to channels, not to user DMs.

---

## Manual Test Checklist

1. **Setup**:
   - Run `/welcome-leave-setup` as an admin.
   - Enable welcome and leave messages.
   - Select appropriate channels for each.
   - Configure embeds with various placeholders.
   - Save and exit.

2. **Welcome Message**:
   - Add a new member to the server.
   - Confirm a welcome message is sent in the configured channel.
   - Verify placeholders are replaced correctly.

3. **Leave Message**:
   - Remove a member from the server.
   - Confirm a leave message is sent in the configured channel.
   - Verify placeholders are replaced correctly.

4. **Embed Customization**:
   - Edit the embed to include images, colors, and custom fields.
   - Save and test that the message renders as expected.

5. **Permissions**:
   - Remove bot permissions from the target channel and test that errors are logged and no message is sent.

6. **Edge Cases**:
   - Disable welcome/leave messages and confirm no messages are sent.
   - Set an invalid embed (via DB) and confirm the module logs a warning and skips sending.

---

## Files

- `index.js` — Module entry; registers commands, event handlers, and setup UI.
- `handlers/setup.js` — `/welcome-leave-setup` command and interactive setup panel.
- `handlers/memberEvents.js` — Listens for member join/leave and sends messages.
- `services/settingsService.js` — Per-guild settings storage and validation.
- `utils/placeholders.js` — Placeholder replacement logic for embeds.

---

## Roadmap

- Add support for DMing users on join/leave.
- Add more placeholders (e.g., custom invite data).
- Add per-role or per-channel message overrides.
- Add message preview in setup UI.
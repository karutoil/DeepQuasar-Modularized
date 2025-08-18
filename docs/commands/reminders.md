---
title: "Reminders"
description: "User reminders and timezone helper commands"
tags: ["module","reminders","commands"]
module: reminders
created: 2025-08-15
updated: 2025-08-15
---
<!--DOC-JSON-->{"title":"Reminders","module":"reminders","tags":["commands","scheduling"],"version":"1.0"}<!--/DOC-JSON-->

# Reminders

Short summary: Commands to create one-time and recurring reminders, manage reminders, and set user timezone.

## Commands

- /remind
  - message | string | required
  - time | string | required (natural language or ISO)
  - Creates a one-time reminder for the caller.

- /remind_channel
  - message | string | required
  - time | string | required
  - channel | channel | required
  - Creates a one-time reminder targeted to a channel.

- /remind_every
  - message | string | required
  - time | string | required (first run)
  - recurrence | string | required | daily|weekly|monthly
  - Creates a recurring reminder.

- /reminders
  - No options; shows an interactive paginated list of the user's reminders with action buttons (Edit/Delete/Snooze).

- /timezone
  - timezone | string | optional (autocomplete) | Set or view user's timezone

## Examples

- `/remind message:Take out trash time:in 10 minutes`
- `/remind_channel message:Standup time:2025-09-01T09:00 channel:#general`
- `/remind_every message:Pay rent time:2025-09-01T09:00 recurrence:monthly`
- `/timezone timezone:America/New_York`

## Notes

- Time parsing uses a natural language parser with validation and timezone support; timezone can be set per-user via `/timezone` autocomplete.
- `/reminders` uses an interactive paginated UI with buttons to manage entries.

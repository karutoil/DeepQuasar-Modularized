# Reminders Module

## Natural Language Time Parsing with chrono-node

This module uses [chrono-node](https://github.com/wanasit/chrono) for robust natural language time parsing in all reminder commands. Users can set reminders using flexible, human-friendly time expressions.

### Supported Commands

- `/remind` — Set a one-time reminder
- `/remind every` — Set a recurring reminder
- `/remind channel` — Set a reminder in a specific channel

All commands accept natural language time inputs.

### Supported Time Formats

You can use a wide variety of time expressions, including but not limited to:

- `in 10 minutes`
- `tomorrow at 5pm`
- `next Friday at noon`
- `2025-08-08T15:00`
- `August 10th, 2025 3:00pm`
- `2 hours from now`
- `next week`
- `every Monday at 9am` (for recurring reminders)

See the [chrono-node documentation](https://github.com/wanasit/chrono#usage) for more examples.

### Error Handling

- If the time input is missing, invalid, or ambiguous, the bot will respond with a clear error message.
- Ambiguous inputs (e.g., "Monday" when today is Monday) will prompt for clarification.
- Past dates are not accepted.

### Implementation Details

- Time parsing is handled by the utility [`utils/validation.js`](modules/reminders/utils/validation.js), which wraps chrono-node and provides error details.
- All handlers use this utility for consistent parsing and error handling.

### Dependency

- [chrono-node](https://www.npmjs.com/package/chrono-node) is listed in `package.json` and installed automatically.

---
For advanced usage or troubleshooting, refer to the source code in [`utils/validation.js`](modules/reminders/utils/validation.js).
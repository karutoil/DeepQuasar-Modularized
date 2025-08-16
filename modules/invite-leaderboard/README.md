# Invite Leaderboard Module

Tracks invite usage per guild and maintains a leaderboard stored in MongoDB.

Features
- On ready, captures a baseline of current invites per guild.
- Listens to inviteCreate, inviteDelete, and guildMemberAdd to attribute invite uses.
- Periodic reconciliation to catch missed changes.

Data model (collection: `invite_leaderboard`)
- guildId: string
- invites: { [code]: { inviterId, uses, maxUses, createdAt, expiresAt } }
- counts: { [inviterId|'UNKNOWN']: number }

Configuration
- Copy `module.env.example` values into the bot's `.env` as needed.

Notes
- The module attributes deltas based on invite uses differences; it stores counts per guild in the database.
- External-facing commands (e.g., to show leaderboard) are intentionally omitted from v1 and can be added later under `handlers/`.

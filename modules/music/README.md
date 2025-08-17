Music module powered by Rainlink

This module initializes Rainlink after the Discord client is ready and exposes slash commands for basic music control: play, skip, pause, resume, stop, nowplaying, queue.

Configuration
- MODULE_MUSIC_ENABLED: enable/disable module
- MODULE_MUSIC_NODES: JSON array of node configs for Rainlink
- MODULE_MUSIC_DEFAULT_VOLUME: default volume for new players

Notes
- DJ permission checks are intentionally excluded; use Discord slash command permissions instead.
- Rainlink requires forwarding raw voice events; the Rainlink DiscordJS library listens for 'raw' events automatically when constructed with Library.DiscordJS(client) and the library's listen() attaches internal handlers after Rainlink initialization.

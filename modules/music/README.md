# Music Module for DeepQuasar

This module provides advanced music playback and queue management using Moonlink.js and Lavalink.

## Features
- Play, pause, resume, stop, skip, seek
- Queue management (add, remove, view, shuffle, clear)
- Volume control
- Supports YouTube, Spotify, SoundCloud, etc.
- Interactive controls via buttons and selects
- Per-guild queue and playback state
- Hot-reload safe, modular, and respects feature flags

## Setup
1. Configure Lavalink and set environment variables in `.env` (see `module.env.example`).
2. Enable the module with `MODULE_MUSIC_ENABLED=true`.
3. Ensure Moonlink.js and Discord.js are installed.

## Slash Commands
- `/play [query]` — Play a track or add to queue
- `/pause` — Pause playback
- `/resume` — Resume playback
- `/stop` — Stop and clear queue
- `/skip` — Skip current track
- `/queue` — Show current queue
- `/volume [level]` — Set playback volume
- `/nowplaying` — Show current track info
- `/shuffle` — Shuffle queue
- `/clear` — Clear queue

## Environment Variables
See `module.env.example` for required and optional variables.

## Hot-Reload & Lifecycle
All handlers and listeners are registered with the lifecycle manager for safe hot-reloading.

## Extensibility
- Add new sources by extending Moonlink.js node config
- Add new commands or UI components in `handlers/` and `components/`

## Troubleshooting
- Ensure Lavalink is running and accessible
- Check logs for connection or playback errors
- Use `/stop` and `/clear` to reset playback state

## License
MIT

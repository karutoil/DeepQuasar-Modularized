
# Music Module for DeepQuasar

This module provides comprehensive music functionality for the bot using the Shoukaku library to connect to a Lavalink server.

## Features
- Play music from YouTube, Spotify, and other sources supported by Lavalink.
- Per-guild queueing system.
- Full set of playback controls including pause, resume, skip, stop, and volume.
- Autocomplete for `/play` command searches.
- Paginated queue display.
- Graceful error handling and voice channel management.
- Automatically leaves voice channel after a period of inactivity.

## Setup

1.  **Run Lavalink:** Make sure you have a Lavalink server running. You can use the provided `docker-compose-dev.yml`:
    ```sh
    docker-compose -f docker-compose-dev.yml up -d
    ```
2.  **Configure Environment:** Copy the contents of `module.env.example` into your main `.env` file.
3.  Fill in the Lavalink connection details:
    - `LAVALINK_URL`: The address of your Lavalink server (e.g., `localhost:2333`).
    - `LAVALINK_PASSWORD`: The password for your Lavalink server.
    - `LAVALINK_SECURE`: Set to `true` if Lavalink is using SSL/TLS.
4.  **Enable Module:** Ensure `MODULE_MUSIC_ENABLED` is set to `true` in your `.env` file.

## Commands

- `/play <query>`: Play or queue a song/playlist from a URL or search query.
- `/pause`: Pause the current track.
- `/resume`: Resume the current track.
- `/skip`: Skip to the next track in the queue.
- `/stop`: Stop playback, clear the queue, and leave the voice channel.
- `/queue`: Display the current song queue in a paginated embed.
- `/nowplaying`: Show details and a progress bar for the currently playing song.
- `/volume <level>`: Set the playback volume (0-100).
- `/shuffle`: Shuffle the current queue.

## Files

- `index.js`: Module entry point, wires everything together.
- `handlers/play.js`: Handles the `/play` command and playback loop.
- `handlers/controls.js`: Handles playback control commands.
- `handlers/queue.js`: Handles queue display commands.
- `handlers/events.js`: Handles events from the Shoukaku player.
- `services/shoukakuManager.js`: Manages the Shoukaku/Lavalink connection.
- `services/queueManager.js`: Manages per-guild queues.
- `module.env.example`: Example environment variables.

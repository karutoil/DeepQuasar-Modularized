---
title: "Music"
description: "Lavalink-backed music commands"
tags: ["module","music","commands"]
module: music
created: 2025-08-15
updated: 2025-08-15
---
<!--DOC-JSON-->{"title":"Music","module":"music","tags":["commands","audio"],"version":"1.0"}<!--/DOC-JSON-->

# Music

Short summary: Feature-rich music commands powered by Lavalink. Commands include play, skip, stop, queue, nowplaying, pause, resume, loop, volume, seek, disconnect.

## Commands & Options

- /play
  - query | string | required | Song name or URL
  - channel | channel (voice) | optional | Voice channel to join

- /skip
  - no options

- /stop
  - no options

- /queue
  - Subcommands:
    - list [page:int]
    - remove position:int (required)
    - clear
    - shuffle
    - skipto position:int (required)

- /nowplaying
  - no options

- /pause
  - no options

- /resume
  - no options

- /loop
  - mode | string | required | off/song/queue (choices)

- /volume
  - level | integer | optional | 0-100 (shows current if omitted)

- /seek
  - time | string | required | e.g. 1:30, 90s

- /disconnect
  - no options

## Examples

- `/play query:Never Gonna Give You Up`
- `/volume level:80`
- `/queue list page:2`

## Notes

- Module initializes a Lavalink manager and registers handlers; commands check guild and voice preconditions.
- Some options accept several formats (seek parsing accepts mm:ss, hh:mm:ss, seconds, 90s).
- Volume persists to guild settings when set.

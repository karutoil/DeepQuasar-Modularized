## Module: music

### /disconnect
- Description: Disconnects the bot from the voice channel and clears the queue.
- Source: modules/music/handlers/disconnect.js

### /loop
- Description: Sets the loop mode for the player.
- Options:
  - mode (String) — optional
- Source: modules/music/handlers/loop.js

### /nowplaying
- Description: Displays the currently playing song.
- Source: modules/music/handlers/nowplaying.js

### /pause
- Description: Pauses the currently playing song.
- Source: modules/music/handlers/pause.js

### /play
- Description: Plays a song or adds it to the queue.
- Options:
  - query (String) — optional
  - channel (Channel) — optional
- Source: modules/music/handlers/play.js

### /queue
- Description: Manage the music queue.
- Options:
  - page (Integer) — optional
  - position (Integer) — optional
  - position (Integer) — optional
- Source: modules/music/handlers/queue.js

### /resume
- Description: Resumes the currently paused song.
- Source: modules/music/handlers/resume.js

### /seek
- Description: Seeks to a specific timestamp in the current song.
- Options:
  - time (String) — optional
- Source: modules/music/handlers/seek.js

### /skip
- Description: Skips the current song.
- Source: modules/music/handlers/skip.js

### /stop
- Description: Stops the music and clears the queue.
- Source: modules/music/handlers/stop.js

### /volume
- Description: Sets the player volume.
- Options:
  - level (Integer) — optional
- Source: modules/music/handlers/volume.js

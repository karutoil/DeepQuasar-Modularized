# Music Module

This module provides feature-rich music playback capabilities using Lavalink.

## Configuration

To enable and configure the music module, copy `module.env.example` to your main `.env` file and adjust the variables as needed.

### Environment Variables

*   `MODULE_MUSIC_ENABLED`: Set to `true` to enable the music module. Default is `true`.
*   `LAVALINK_NODES`: A JSON array of Lavalink node configurations. Each object in the array should have the following properties:
    *   `id`: A unique identifier for the node.
    *   `host`: The hostname or IP address of the Lavalink server.
    *   `port`: The port of the Lavalink server.
    *   `password`: The password for the Lavalink server.
    *   `secure`: (Optional) Set to `true` if the connection to Lavalink should be secure (WSS). Default is `false`.

**Example `LAVALINK_NODES` configuration:**

```json
[
  {
    "id": "main",
    "host": "localhost",
    "port": 2333,
    "password": "youshallnotpass",
    "secure": false
  }
]
```

## Usage

(Coming soon: Details on available music commands and how to use them.)

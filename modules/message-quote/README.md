# Message Quote Module

Automatically converts valid in-guild Discord message links into rich embeds with a jump button.

Scope:
- Only processes links of the form: https://discord.com/channels/<guild_id>/<channel_id>/<message_id>
- Only handles links where <guild_id> matches the current guild
- Processes up to 3 links per message to avoid rate limits

Features:
- Posts two embeds per link in a single reply:
  1) Header embed: "Quoted by {username}" with the quoter's avatar icon.
  2) Main embed: original author in author field, truncated content, timestamp footer, channel mention + compact message ID, optional first image (attachment or inline URL).
- Button: a single Link-style button "Go to message" that jumps to the original message.
- Error handling: concise warnings for missing permissions or fetch failures.
- Recursion prevention and idempotency guards to avoid loops and duplicates.
- Per-guild configuration to enable/disable and optional deletion of link-only triggering message.
- Localization-ready strings centralized with keys under `message-quote.*`.


## Setup

1) Ensure your bot uses the core and loads modules like other modules in this repository, per docs/create_a_module.md.

2) Import and initialize the module at startup (if using a central loader, add it there). Example:
```js
import MessageQuote from "./modules/message-quote/index.js";

client.once("ready", async () => {
  const ctx = core; // core context
  await MessageQuote(ctx);
});
```

3) Make sure your Discord client has intents:
- Guilds
- GuildMessages
- MessageContent
as needed for the `messageCreate` event and content parsing.

4) Optional env flag:
- MODULE_MESSAGE_QUOTE_ENABLED=true (default: true)


## Required Permissions

At minimum:
- In source channel (where the original message resides):
  - ViewChannel
  - ReadMessageHistory

- In destination channel (where the user posted the link and bot replies):
  - SendMessages
  - EmbedLinks
  - AttachFiles (only if you expect images; not strictly required for link-style button and embeds without attachments)

If the bot lacks read access to the source channel or cannot fetch the message, it replies with a brief warning embed.


## Configuration (Per Guild)

Stored via `ctx.guildConfig`:
- `message_quote_enabled` (boolean, default true): enable or disable quoting behavior.
- `message_quote_delete_original` (boolean, default false): if true, delete the original triggering message after successful quoting when it contains only links and whitespace.

Behavioral safeguards:
- Only delete when all links processed successfully and the content was link-only (no additional text).


## Behavior Details

- Parsing:
  - Strict regex that only accepts `discord.com/channels/guild/channel/message` (ptb/canary also accepted).
- Guild validation:
  - Ignores links that refer to another guild.
- Multiple links:
  - Processes up to 3 links in the order they appear; replies separately for each link with its own two embeds and single link button.
- Rate limits:
  - Conservatively capped; replies are sequential. Logging warns if sending fails.
- Length limits:
  - Content truncated with ellipsis to remain within Discord embed description limits.
  - Author names truncated to author field limit.
- Recursion prevention:
  - Ignores the bot’s own messages.
  - Maintains a short TTL cache to avoid reprocessing the same trigger message and to skip likely loops when someone links the bot’s fresh quote message.
- Errors:
  - Missing permissions in source channel: posts a concise warning embed listing missing perms.
  - Fetch failures: concise warning embed.
  - Malformed or cross-guild links: ignored to reduce noise.


## Localization

All user-facing strings reference keys in `modules/message-quote/utils/i18n.js`. The inline English map documents intent and can be migrated to your global i18n solution.

Keys:
- message-quote.errors.missingPermsTitle
- message-quote.errors.missingPerms
- message-quote.errors.fetchFailedTitle
- message-quote.errors.fetchFailed
- message-quote.header.quotedBy
- message-quote.main.channel
- message-quote.main.messageId
- message-quote.main.noContent
- message-quote.main.timestampFooter
- message-quote.button.goTo


## Example Payloads

See `examples/payloads.json` for representative embed and component payloads the module replies with.

Example (abridged, one link):
```json
{
  "embeds": [
    {
      "title": "Quoted by ExampleUser",
      "author": { "name": "ExampleUser", "icon_url": "https://cdn.discordapp.com/..." }
    },
    {
      "author": { "name": "Original Display Name", "icon_url": "https://cdn.discordapp.com/..." },
      "description": "Original message content…",
      "fields": [
        { "name": "Channel", "value": "#general · ID: 4f3a2b", "inline": true }
      ],
      "footer": { "text": "Original message • <t:1723035590:t>" },
      "url": "https://discord.com/channels/123/456/789",
      "image": { "url": "https://i.imgur.com/example.png" }
    }
  ],
  "components": [
    {
      "type": 1,
      "components": [
        { "type": 2, "style": 5, "label": "Go to message", "url": "https://discord.com/channels/123/456/789" }
      ]
    }
  ]
}
```

## Limitations

- Only links to messages in the same guild are processed.
- Thread channels are supported for reading if the bot has permission via the parent channel.
- The idempotency/recursion guard uses in-memory TTL; in clustered deployments, duplicate handling could occur across nodes.
- The module does not group multiple links into a single reply; it replies once per link to respect the 2-embeds-per-link requirement.

## File Map

- index.js: module entry and wiring
- handlers/events.js: messageCreate handler orchestration
- utils/parse.js: regex parsing, link-only detection
- utils/fetch.js: permission checks and message fetch with retries
- utils/images.js: image URL extraction
- utils/embeds.js: embed and component builders
- utils/guard.js: recursion/idempotency guard
- utils/i18n.js: localization keys and default English strings

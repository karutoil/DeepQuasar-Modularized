# Music Module Tasklist

This file lists identified issues, prioritized tasks, and concrete steps to fix the `modules/music` module. Each task includes purpose, files affected, implementation notes, tests, and validation steps.

---

## Priority: Critical

### 1) Fix event listener removal bug for `raw` event
- Purpose: Prevent memory leaks and duplicate handling when module is unloaded/reloaded.
- Files: `modules/music/index.js`
- Problem: `ctx.client.on("raw", d => manager.sendRawData(d));` and the corresponding `off` uses a different arrow function reference, so the listener isn't removed.
- Implementation:
  - Replace with:
    - `const rawHandler = d => manager.sendRawData(d);`
    - `ctx.client.on('raw', rawHandler);`
    - `lifecycle.addDisposable(() => ctx.client.off('raw', rawHandler));`
- Tests / Validation:
  - Load/unload module repeatedly and assert `ctx.client.listenerCount('raw')` does not grow.
  - Manual run: start bot, load module, unload module, observe no lingering listeners and no duplicate handling.

### 2) Guard `sendToShard` and handle missing guilds
- Purpose: Prevent crashes when guild is not in cache and ensure payload is still delivered when possible.
- Files: `modules/music/index.js`
- Problem: `const guild = ctx.client.guilds.cache.get(guildId); if (guild) guild.shard.send(payload);` will throw if guild is undefined and guild.shard missing, and will silently drop payload.
- Implementation:
  - Add robust sending logic:
    - If guild found and guild.shard exists, use `guild.shard.send(payload)`.
    - Else if `ctx.client.shard` or `ctx.client.ws` supports a broadcast/send with `guild_id`, use that.
    - Wrap in try/catch. Log warn when guild not in cache and fallback can't be used.
- Tests / Validation:
  - Simulate sendToShard with guild not in cache — should not throw and should log a warning.

---

## Priority: High

### 4) Consolidate and make disposal idempotent
- Purpose: Avoid duplicate logs and duplicate node disconnect calls on unload.
- Files: `modules/music/index.js`
- Problem: Both lifecycle disposable and returned `dispose` call log "Module unloaded." and call `manager.nodeManager.disconnectAll(...)`, leading to duplicate operations.
- Implementation:
  - Implement a single `async function disposeModule()` stored in a variable and call it from lifecycle and return.dispose. Make it idempotent (guard with `if (disposed) return`).
  - Remove duplicate semicolon `;;`.
- Tests / Validation:
  - Call dispose once and twice; ensure it is safe and logs only once.

### 5) Defensive event handling (trackStart, trackEnd, nodeError)
- Purpose: Prevent runtime exceptions when event payloads are unexpected.
- Files: `modules/music/index.js`
- Implementation:
  - Check `track?.info` exists before accessing `title`, `author`.
  - Log `error.stack` at debug level; include extra context (node id, guild id).
  - Add listeners for other player events like `playerError` if supported.
- Tests / Validation:
  - Force malformed track events in tests and verify no crash.

### 6) Validate Lavalink config values and secure option
- Purpose: Fail fast with clear messages for invalid envs and support TLS if needed.
- Files: `modules/music/index.js`, `modules/music/module.env.example`
- Implementation:
  - Parse and validate port: `Number(lavalinkPort)` and ensure 1-65535.
  - Support `LAVALINK_SECURE` or `LAVALINK_USE_TLS` boolean env to set `secure` option.
  - Consider `LAVALINK_NODES` CSV/JSON for multiple nodes.
- Tests / Validation:
  - Start with invalid port, confirm descriptive error message; test secure option toggles `secure` in node config.

---

## Priority: Medium

### 7) Prevent track/queue race conditions
- Purpose: Avoid double play, or play attempts against destroyed players when `trackEnd`, `queueEnd`, and `onEmptyQueue` interplay.
- Files: `modules/music/index.js`, handlers that manipulate queue
- Implementation:
  - Use a small lock or state on player (e.g., `player._transitioning = true`) to prevent concurrent play/destroy.
  - Rely on one source to manage transitions — preferably use manager/player queue behavior and only call `player.play()` when necessary.
- Tests / Validation:
  - Test sequences of short tracks and ensure no double starts or exceptions.

### 8) Handler-level precondition checks and user-friendly errors
- Purpose: Improve UX and prevent crashes when users are missing voice channel or bot lacks permissions.
- Files: `modules/music/handlers/*.js`
- Implementation:
  - For each handler, add checks:
    - Is user in voice channel?
    - Does bot have CONNECT/SPEAK permissions?
    - Is manager ready and node available?
    - Validate numeric inputs (volume, seek) and clamp ranges.
  - Wrap handler logic in try/catch and respond with ephemeral error messages.
- Tests / Validation:
  - Unit tests for missing permissions, invalid values, and manager-down scenarios.

### 9) Ensure disposables are safe (registration may fail)
- Purpose: Prevent disposal from throwing if registration partially failed.
- Files: `modules/music/index.js`
- Implementation:
  - Wrap every `v2.register(...)` in try/catch and store `disposeCmd = typeof result === 'function' ? result : () => {}`.
  - During dispose loop, call safely.
- Tests / Validation:
  - Simulate registration failure and ensure disposal runs without exceptions.

### 10) Expose helper API on `ctx.music`
- Purpose: Centralize common operations and checks used by handlers.
- Files: `modules/music/index.js`, handlers
- Implementation:
  - Provide `ctx.music.getPlayer(guildId)`, `ctx.music.ensurePlayer(guildId, voiceChannelId)`, `ctx.music.isReady()`.
  - Use these helpers in handlers.
- Tests / Validation:
  - Unit tests for helpers; refactor one handler to use helpers and confirm behavior unchanged.

---

## Priority: Low / Improvements

### 11) Multi-node configuration and reconnection strategy
- Purpose: Add resilience via multiple Lavalink nodes and configurable backoff.
- Files: `modules/music/index.js`, `modules/music/module.env.example`
- Implementation:
  - Allow `LAVALINK_NODES` env (JSON or CSV) to configure multiple nodes with id/host/port/secure.
  - Expose reconnection options.
- Tests / Validation:
  - Start manager with multiple nodes configured; simulate node failure.

### 13) Documentation: env vars and troubleshooting
- Purpose: Help operators configure Lavalink and debug issues.
- Files: `modules/music/module.env.example`, `modules/music/README.md`, `docs/*`
- Implementation:
  - Add required env keys: `LAVALINK_HOST`, `LAVALINK_PORT`, `LAVALINK_PASSWORD`, optional `LAVALINK_SECURE`, `LAVALINK_NODES`.
  - Add troubleshooting steps for connection failures and common errors.
- Tests / Validation:
  - Manual verification of docs by following them to connect to a test Lavalink server.

### 14) Logging improvements and sensitive info handling
- Purpose: Avoid leaking secrets and reduce noisy logs in production.
- Files: `modules/music/index.js`
- Implementation:
  - Remove logging of password presence or ensure strictly masked and only in debug mode.
  - Use `logger.debug` for verbose track info and `logger.info` for high-level events.
- Tests / Validation:
  - Run with production log level and ensure no secrets present in logs.

### 15) Minor style fixes and linting
- Purpose: Maintain code quality.
- Files: `modules/music/**/*`
- Implementation:
  - Remove stray `;;` and fix lint issues.
  - Run ESLint / Prettier and fix all warnings.
- Tests / Validation:
  - Lint passes in CI.

---

## Workflow suggestions
- Tackle critical issues first (listener leak, sendToShard guard, manager readiness). Implement unit tests alongside each bug fix.
- Use feature branches and small commits per task. Suggested commit messages:
  - "music: fix raw event listener removal"
  - "music: add sendToShard fallback and guard"
  - "music: validate lavalink config and support secure option"
- After implementing fixes, add integration tests that repeatedly load/unload module to catch leaks and race conditions.

---

## Example patch for `raw` listener (concept)
Replace:

```js
ctx.client.on("raw", d => manager.sendRawData(d));
lifecycle.addDisposable(() => ctx.client.off("raw", d => manager.sendRawData(d)));
```

With:

```js
const rawHandler = d => manager.sendRawData(d);
ctx.client.on('raw', rawHandler);
lifecycle.addDisposable(() => ctx.client.off('raw', rawHandler));
```

---

# Command Deployment Optimization

## Overview

The bot now supports **batched command deployment** for significantly faster startup times. Instead of making individual API calls for each command add/update/remove operation, the bot can deploy all commands in a single bulk operation.

## Performance Comparison

| Method | API Calls | Typical Time | Use Case |
|--------|-----------|--------------|----------|
| **Batch (Default)** | 1 per guild/global | ~200-500ms | Production, fast deploys |
| **Individual** | 1 per command change | ~2-10 seconds | Development, detailed logging |

## Configuration

Preferred: strategy selector via COMMAND_DEPLOY_STRATEGY (default bulk)

```bash
# Bulk replace in a single PUT (recommended)
COMMAND_DEPLOY_STRATEGY=bulk

# Per-item create/patch/delete (slower; granular logging)
COMMAND_DEPLOY_STRATEGY=diff

# Alias of bulk for both guild and global in this project
COMMAND_DEPLOY_STRATEGY=auto
```

Legacy compatibility:

```bash
# If present, it will be ignored in favor of COMMAND_DEPLOY_STRATEGY
# BATCH_COMMAND_DEPLOY=true|false
```

## How It Works

### Batch Mode (Fast)
```javascript
// Single API call overwrites all commands
await rest.put(Routes.applicationCommands(appId), { body: allCommands });
```

In this codebase, bulk is used for both guild and global when:
```text
COMMAND_DEPLOY_STRATEGY = bulk | auto | undefined
```

### Individual Mode (Detailed)
```javascript
// Multiple API calls for granular operations
for (const cmd of toCreate) await rest.post(route, { body: cmd });
for (const update of toUpdate) await rest.patch(`${route}/${update.id}`, { body: update.body });
for (const id of toDelete) await rest.delete(`${route}/${id}`);
```

## When to Use Each Mode

### Use Batch Mode When:
- ✅ Production deployments
- ✅ Development with many modules
- ✅ Fast startup is critical
- ✅ You trust the command definitions

### Use Individual Mode When:
- 🔍 Debugging command registration issues
- 🔍 You need detailed logs of what changed
- 🔍 Working with experimental command configurations
- 🔍 Troubleshooting deployment problems

## Command Change Detection

The system still performs intelligent change detection to provide clear telemetry and avoid unnecessary work:

1. **Hash Calculation**: Each command is hashed to detect changes
2. **Delta Analysis**: Compares current vs. last deployed state
3. **Strategy Execution**:
   - bulk: Always PUT full command array once (fastest)
   - diff: Per-item create/patch/delete (granular), using live fetch of existing commands

```javascript
const delta = diffHashes(currentHashes);
logger.info(`Deploy delta: +${delta.added.length} ~${delta.updated.length} -${delta.removed.length}`);
```

Bulk summary logging uses the delta as the effective counts:
```text
Guild commands (bulk): created=+N, updated=~M, deleted=-K
Global commands (bulk): created=+N, updated=~M, deleted=-K
```

## Logging Output

### Batch Mode
```
[INFO] Guild command deploy delta: +3 ~2 -1
[INFO] Bulk PUT completed in 234ms (route=/applications/.../commands)
[INFO] Guild commands (bulk): created=3, updated=2, deleted=1
```

### Individual Mode
```
[INFO] Global command deploy delta: +1 ~1 -0
[INFO] Created command 'play'
[INFO] Updated command 'queue'
[INFO] Global commands (diff): created=1, updated=1, deleted=0 (propagation can take up to 1 hour)
```

## Migration Notes

- **Backward Compatible**: Existing configurations continue to work
- **Default Behavior**: Batch mode is enabled by default for all new deployments
- **Environment Override**: Can be changed per environment without code changes
- **Hot Reload**: Setting changes take effect on next deployment cycle

## Troubleshooting

If you experience issues with batch deployment:

1. **Enable Individual Mode**: Set `BATCH_COMMAND_DEPLOY=false`
2. **Check Logs**: Look for detailed command-by-command operations
3. **Verify Commands**: Ensure all command definitions are valid JSON
4. **Discord API**: Check for Discord API status at https://discordstatus.com

The individual mode provides more granular error reporting and can help identify problematic command definitions.

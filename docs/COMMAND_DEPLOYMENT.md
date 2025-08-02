# Command Deployment Optimization

## Overview

The bot now supports **batched command deployment** for significantly faster startup times. Instead of making individual API calls for each command add/update/remove operation, the bot can deploy all commands in a single bulk operation.

## Performance Comparison

| Method | API Calls | Typical Time | Use Case |
|--------|-----------|--------------|----------|
| **Batch (Default)** | 1 per guild/global | ~200-500ms | Production, fast deploys |
| **Individual** | 1 per command change | ~2-10 seconds | Development, detailed logging |

## Configuration

Set `BATCH_COMMAND_DEPLOY=true` in your `.env` file (default behavior):

```bash
# Fast batch deployment (recommended)
BATCH_COMMAND_DEPLOY=true

# Slower individual deployment with detailed logging
BATCH_COMMAND_DEPLOY=false
```

## How It Works

### Batch Mode (Fast)
```javascript
// Single API call overwrites all commands
await rest.put(Routes.applicationCommands(appId), { body: allCommands });
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

The system still performs intelligent change detection to avoid unnecessary deployments:

1. **Hash Calculation**: Each command is hashed to detect changes
2. **Delta Analysis**: Compares current vs. last deployed state
3. **Smart Deployment**: Only deploys when changes are detected

```javascript
const delta = diffHashes(currentHashes);
logger.info(`Deploy delta: +${delta.added.length} ~${delta.updated.length} -${delta.removed.length}`);
```

## Logging Output

### Batch Mode
```
[INFO] Batch deploying 15 commands...
[INFO] Batch deployment completed in 234ms
[INFO] Guild commands (batch): created=15, updated=0, deleted=0, duration=234ms
```

### Individual Mode
```
[INFO] Using individual command deployment (slower but detailed)...
[INFO] Created command 'play'
[INFO] Updated command 'queue'
[INFO] Deleted command id='123456789'
[INFO] Guild commands (individual): created=1, updated=1, deleted=1, duration=3456ms
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

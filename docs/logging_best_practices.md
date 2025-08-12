# Logging Best Practices for Grafana Loki

This document outlines how to use the improved logger system for better log parsing and analysis in Grafana Loki.

## Overview

The logger has been enhanced with:
- Structured JSON logging for Loki
- Rich label support for filtering
- Correlation ID support for request tracing
- Specialized logging methods for common use cases
- Environment and service metadata

## Environment Variables

Set these environment variables for optimal Loki integration:

```bash
# Loki Configuration
LOKI_URL=http://localhost:3100
LOKI_USERNAME=admin
LOKI_PASSWORD=secret

# Service Information
SERVICE_NAME=deepquasar
SERVICE_VERSION=1.0.0
NODE_ENV=production
```

## Basic Usage

```javascript
import { getLogger, childLogger, createRequestLogger, createUserLogger } from '../core/logger.js';
import config from '../core/config.js';

// Get the base logger
const logger = getLogger('info', config);

// Basic logging
logger.info('Application started');
logger.warn('This is a warning');
logger.error('This is an error');
```

## Module-Specific Logging

```javascript
// Create a module-specific logger
const moduleLogger = childLogger(logger, 'music-player');

moduleLogger.info('Music module initialized');
moduleLogger.debug('Processing play command', { songTitle: 'Example Song' });
```

## Request Tracing

```javascript
// Create a request-scoped logger with correlation ID
const requestLogger = createRequestLogger(logger, null, { 
  endpoint: '/api/music/play' 
});

requestLogger.info('Request started');
requestLogger.info('Validating user permissions');
requestLogger.info('Request completed', { duration: 150 });
```

## User-Specific Logging

```javascript
// Create a user-scoped logger
const userLogger = createUserLogger(logger, 'user123', 'guild456');

userLogger.info('User command executed', { command: 'play' });
```

## Structured Logging Methods

### Error Logging
```javascript
try {
  // Some operation
} catch (error) {
  logger.logError(error, {
    operation: 'playMusic',
    songId: 'song123',
    guildId: 'guild456'
  });
}
```

### HTTP Request Logging
```javascript
// Log HTTP requests (useful for API endpoints)
logger.logRequest(req, res, 150, {
  userId: 'user123',
  endpoint: '/api/music/queue'
});
```

### Discord Event Logging
```javascript
// Log Discord-specific events
logger.logDiscordEvent('messageCreate', 'guild456', 'user123', {
  channelId: 'channel789',
  messageLength: 50
});
```

### Performance Logging
```javascript
// Log performance metrics
const startTime = Date.now();
// ... some operation
const duration = Date.now() - startTime;

logger.logPerformance('database_query', duration, {
  query: 'getUserSettings',
  recordCount: 1
});
```

## Grafana Loki Queries

With the improved logger, you can create powerful queries in Grafana:

### Filter by Application and Environment
```logql
{app="deepquasar", environment="production"}
```

### Filter by Module
```logql
{app="deepquasar", module="music-player"}
```

### Filter by Log Level
```logql
{app="deepquasar", level="error"}
```

### Filter by User
```logql
{app="deepquasar", user_id="user123"}
```

### Filter by Guild
```logql
{app="deepquasar", guild_id="guild456"}
```

### Filter by Request ID (for tracing)
```logql
{app="deepquasar", request_id="550e8400-e29b-41d4-a716-446655440000"}
```

### Filter by Error Type
```logql
{app="deepquasar", level="error", error_type="ValidationError"}
```

### Complex Queries
```logql
# All errors in production for music module
{app="deepquasar", environment="production", module="music-player", level="error"}

# Performance metrics taking longer than 1 second
{app="deepquasar"} |= "Performance Metric" | json | duration > 1000

# All events for a specific user
{app="deepquasar", user_id="user123"} 

# Request tracing - all logs for a specific request
{app="deepquasar", request_id="550e8400-e29b-41d4-a716-446655440000"}
```

## Log Aggregation Examples

### Error Rate by Module
```logql
sum(rate({app="deepquasar", level="error"}[5m])) by (module)
```

### Request Duration Percentiles
```logql
histogram_quantile(0.95, 
  sum(rate({app="deepquasar"} |= "Performance Metric" | json [5m])) by (le)
)
```

### Top Error Types
```logql
topk(10, sum by (error_type) (count_over_time({app="deepquasar", level="error"}[24h])))
```

## Dashboard Variables

Create these variables in Grafana for dynamic filtering:

- **Environment**: `label_values({app="deepquasar"}, environment)`
- **Module**: `label_values({app="deepquasar"}, module)`
- **Guild**: `label_values({app="deepquasar"}, guild_id)`
- **Service Version**: `label_values({app="deepquasar"}, service_version)`

## Alerting Rules

Example alerting rules based on the structured logs:

### High Error Rate
```logql
sum(rate({app="deepquasar", level="error"}[5m])) > 0.1
```

### Long Request Duration
```logql
{app="deepquasar"} |= "Performance Metric" | json | duration > 5000
```

### Service Down
```logql
absent_over_time({app="deepquasar"}[5m])
```

## Best Practices

1. **Use Correlation IDs**: Always use `createRequestLogger()` for request tracing
2. **Include Context**: Add relevant metadata to all log messages
3. **Use Appropriate Log Levels**: 
   - `error`: For actual errors that need attention
   - `warn`: For potential issues
   - `info`: For general application flow
   - `debug`: For detailed debugging information
4. **Module Naming**: Use consistent module names across your application
5. **Error Logging**: Always use `logger.logError()` for exceptions
6. **Performance Tracking**: Use `logger.logPerformance()` for monitoring slow operations

## Migration from Old Logger

Replace old logging patterns:

```javascript
// Old way
logger.info(`User ${userId} executed command ${command}`);

// New way
const userLogger = createUserLogger(logger, userId, guildId);
userLogger.info('Command executed', { command, metadata: additionalData });
```

This structured approach makes your logs much more powerful for analysis, debugging, and monitoring in Grafana Loki.

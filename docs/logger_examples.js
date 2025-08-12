// Example usage of the improved logger for Grafana Loki
import { getLogger, childLogger, createRequestLogger, createUserLogger, generateCorrelationId } from '../core/logger.js';
import config from '../core/config.js';

// Initialize the logger
const logger = getLogger('info', config);

// Example 1: Basic module logging
const musicLogger = childLogger(logger, 'music-player');
musicLogger.info('Music module started');

// Example 2: Request tracing with correlation ID
const correlationId = generateCorrelationId();
const requestLogger = createRequestLogger(logger, correlationId, {
  endpoint: '/api/music/play',
  method: 'POST'
});

requestLogger.info('Request received');
requestLogger.info('Validating permissions');
requestLogger.info('Starting playback');

// Example 3: User-specific logging
const userLogger = createUserLogger(logger, 'user123', 'guild456');
userLogger.info('User command executed', {
  command: 'play',
  songTitle: 'Never Gonna Give You Up'
});

// Example 4: Structured error logging
try {
  throw new Error('Failed to connect to music service');
} catch (error) {
  logger.logError(error, {
    operation: 'connectMusicService',
    service: 'lavalink',
    guildId: 'guild456'
  });
}

// Example 5: Performance logging
const startTime = Date.now();
// Simulate some operation
await new Promise(resolve => setTimeout(resolve, 150));
const duration = Date.now() - startTime;

logger.logPerformance('database_query', duration, {
  query: 'getUserSettings',
  userId: 'user123'
});

// Example 6: Discord event logging
logger.logDiscordEvent('messageCreate', 'guild456', 'user123', {
  channelId: 'channel789',
  messageLength: 25,
  hasAttachments: false
});

// Example 7: HTTP request logging (for API endpoints)
const mockReq = { method: 'GET', url: '/api/status', headers: { 'user-agent': 'DiscordBot' } };
const mockRes = { statusCode: 200 };
logger.logRequest(mockReq, mockRes, 45, {
  userId: 'user123',
  cached: true
});

export { logger, musicLogger, requestLogger, userLogger };

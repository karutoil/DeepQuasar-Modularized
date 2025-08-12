# Implementing Grafana Loki for Core Logging and Error Reporting

This document outlines a detailed task list for integrating Grafana Loki into the core of the DeepQuasar-Modularized project for comprehensive logging and error tracking.

## 1. Prerequisites & Understanding

*   **Grafana Loki Instance:** Ensure you have access to a running Grafana Loki instance. You will need its URL and potentially authentication credentials.
*   **Project Structure:** Familiarize yourself with the `core/` directory, especially `core/config.js`, `core/index.js`, `core/logger.js`, and `core/reporting.js`.
*   **Environment Variables:** Understand how environment variables are managed (`.env.example`, `config.js`).

## 2. Configuration Updates

### 2.1. Update `.env.example`

Add the following Loki-related environment variables to your `.env.example` file. These will be used by the `config` service.

```ini
# ---------------------------
# Grafana Loki Logging (Optional)
# ---------------------------
# Loki URL for log ingestion. If unset, Loki logging will be disabled.
# LOKI_URL=http://localhost:3100
# Optional: Loki username for basic authentication
# LOKI_USERNAME=
# Optional: Loki password for basic authentication
# LOKI_PASSWORD=
```

### 2.2. Verify `core/config.js` Usage

Ensure that `core/config.js` can correctly read these new environment variables. The existing `config.get()` and `config.getBool()` methods should handle them.

## 3. Install Loki Transport for Winston

Install the necessary `winston-loki` package.

```bash
npm install winston-loki
```

## 4. Configure Loki Transport in `core/logger.js`

This is where the logging transport to Loki is configured. The `createLogger` function in `core/logger.js` will now conditionally add a `LokiTransport` if `LOKI_URL` is provided in the configuration.

### 4.1. Import `LokiTransport`

In `core/logger.js`, add the `LokiTransport` import at the top:

```javascript
import LokiTransport from 'winston-loki';
```

### 4.2. Add Loki Transport to Logger

Within the `buildBaseLogger` function, add the `LokiTransport` to the `transports` array, conditionally based on the `LOKI_URL` environment variable. Include `LOKI_USERNAME` and `LOKI_PASSWORD` for basic authentication if provided.

```javascript
function buildBaseLogger(level = "info", config) {
  // ... existing code ...

  const transports = [
    consoleTransport,
  ];

  const lokiUrl = config.get("LOKI_URL");
  if (lokiUrl) {
    const lokiUsername = config.get("LOKI_USERNAME");
    const lokiPassword = config.get("LOKI_PASSWORD");
    transports.push(
      new LokiTransport({
        host: lokiUrl,
        json: true,
        format: winston.format.json(),
        labels: { app: 'deepquasar' }, // Customize your labels as needed
        ...(lokiUsername && lokiPassword && { basicAuth: { username: lokiUsername, password: lokiPassword } }),
        onConnectionError: (err) => console.error('Loki connection error:', err)
      })
    );
  }

  const baseLogger = winston.createLogger({
    level,
    format: combine(
      errors({ stack: true }),
      splat(),
      metadata({ fillExcept: ["message", "level", "timestamp", "label"] }),
      timestamp(),
      colorize({ all: true }),
      fmt
    ),
    defaultMeta: {},
    transports,
  });

  // ... rest of your logger setup ...
}

// Ensure createLogger and getLogger pass the config object
export function getLogger(level = "info", config) { /* ... */ }
export function createLogger(level = "info", config) { /* ... */ }
```

## 5. Integrate Error Reporting

The `core/reporting.js` module is designed to provide a unified error reporting mechanism. With Loki integration, errors will now be sent to Loki via the Winston logger.

### 5.1. Update `core/reporting.js`

Remove any direct Sentry calls from `core/reporting.js`. The `report` function should now primarily rely on the `logger.error` call, which will automatically send the error to Loki if the Loki transport is configured in `core/logger.js`.

```javascript
export function createErrorReporter({ config, logger }) {
  async function report(error, context = {}) {
    try {
      // Always log locally, which will be sent to Loki if configured
      const message = error?.message || String(error);
      logger?.error?.(`Reported error: ${message}`, { stack: error?.stack, ...context });
    } catch (e) {
      logger?.warn?.(`Error while reporting error: ${e?.message}`);
    }
  }
  return { report };
}

export async function reportError(error, context = {}) {
  try {
    const logger = (globalThis.logger && typeof globalThis.logger.error === 'function')
      ? globalThis.logger
      : { error: (...args) => console.error(...args), warn: (...args) => console.warn(...args) };

    const message = error?.message || String(error);
    logger.error?.(`Reported error: ${message}`, { stack: error?.stack, ...context });
  } catch (e) {
    const logger = (globalThis.logger && typeof global.logger.warn === 'function')
      ? globalThis.logger
      : { warn: (...args) => console.warn(...args) };
    logger.warn?.(`Error while reporting error: ${e?.message}`);
  }
}
```

## 6. Remove Sentry Initialization from `core/index.js`

Remove the Sentry initialization block from `core/index.js`. The `createLogger` function will now handle the conditional setup of the Loki transport.

```javascript
export function createCore(client, baseLoggerLevel = "info") {
  const config = createConfig();
  // Pass config to createLogger for Loki transport setup
  const logger = createLogger(config.get("LOG_LEVEL") ?? baseLoggerLevel, config);

  // ... rest of your core service initializations (Sentry block removed)
}
```

## 7. Testing the Integration

After implementing, it's crucial to test that logs and errors are being reported correctly to Grafana Loki.

### 7.1. Manual Error Trigger

Introduce a deliberate error in a test command or a temporary handler to verify Loki captures it.

**Example (temporary in `core/commands/autocomplete-debug.js` or similar):**

```javascript
// Inside an onExecute handler for a test command
.onExecute(async (interaction) => {
  // ... existing code ...
  if (interaction.options.getString("test-option") === "trigger-error") {
    throw new Error("This is a test error from the Loki integration!");
  }
  // ... rest of the code ...
})
```

Run your bot, trigger this command, and then check your Grafana Loki dashboard for the new error event.

## 8. Cleanup and Considerations

*   **Data Privacy:** Be mindful of what data you send to Loki. Avoid sending sensitive user information unless absolutely necessary and properly anonymized/scrubbed.
*   **Performance Impact:** Monitor your application's resource usage.
*   **Environment-Specific Configuration:** Use environment variables to enable/disable Loki logging and adjust settings for different environments (development, staging, production).
*   **Local Development:** You might want to disable Loki logging in your local development environment to avoid cluttering your Loki project with development logs.
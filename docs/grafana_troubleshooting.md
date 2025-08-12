# Grafana Loki Dashboard Troubleshooting Guide

If you're seeing "No data" in your Grafana dashboard panels, follow these steps to diagnose and fix the issue:

## Step 1: Test Loki Connection

1. **Import the Basic Test Dashboard** (`grafana_basic_test_dashboard.json`)
   - This dashboard uses simple queries that should work with any Loki setup
   - If this shows data, your Loki connection is working

2. **Check Loki Datasource Configuration**
   ```
   - URL should be: http://localhost:3100 (or your Loki URL)
   - Access: Server (default)
   - No authentication needed for basic setup
   ```

## Step 2: Verify Your Application is Logging to Loki

### Check if logs are reaching Loki:
1. **Direct Loki Query** (in browser):
   ```
   http://your-loki-url:3100/loki/api/v1/query?query={job="your-job"}
   ```

2. **Use Grafana Explore**:
   - Go to Grafana → Explore
   - Select your Loki datasource
   - Try simple queries:
     ```logql
     {}                    # All logs
     {level="info"}        # If you have level labels
     {app="deepquasar"}    # If you have app labels
     ```

## Step 3: Update Your Logger Configuration

Your current logger might not be sending to Loki yet. Here's how to enable it:

### Environment Variables
Make sure you have these set:
```bash
LOKI_URL=http://localhost:3100
# Optional:
LOKI_USERNAME=your-username
LOKI_PASSWORD=your-password
```

### Test Logger Integration
Create a test file to verify logging:

```javascript
// test-logger.js
import { getLogger } from './core/logger.js';
import config from './core/config.js';

const logger = getLogger('info', config);

// Test basic logging
logger.info('Test log message');
logger.warn('Test warning message');
logger.error('Test error message');

// Test structured logging
logger.info('Structured test', { 
  module: 'test', 
  userId: 'test123',
  testData: { value: 42 }
});

console.log('Test logs sent. Check Loki in a few seconds...');
```

Run this test:
```bash
node test-logger.js
```

## Step 4: Debug Dashboard Queries

### Common Issues:

1. **Wrong Label Names**
   - Your logs might not have `app="deepquasar"` label
   - Check what labels your logs actually have

2. **Case Sensitivity**
   - LogQL is case-sensitive
   - `{App="DeepQuasar"}` ≠ `{app="deepquasar"}`

3. **Time Range**
   - Check if you're looking at the right time range
   - Try "Last 1 hour" or "Last 24 hours"

### Test Queries in Grafana Explore:

```logql
# 1. Check if ANY logs exist
{}

# 2. Check for your application specifically
{app=~".*deepquasar.*"}

# 3. Check by level (if available)
{level!=""}

# 4. Check recent logs only
{} |= "info" | line_format "{{.}}"
```

## Step 5: Fix Dashboard Based on Your Data

Once you can see logs in Explore, modify the dashboard queries to match your actual label structure.

### If your logs have different labels:
1. Go to Grafana → Explore
2. Run `{}` to see all logs
3. Click on a log entry to see its labels
4. Update dashboard queries to use your actual labels

### Example Fixes:

If your logs use `service` instead of `app`:
```logql
# Change from:
{app="deepquasar"}
# To:
{service="deepquasar"}
```

If your logs don't have module labels:
```logql
# Change from:
sum by (module) (count_over_time({app="deepquasar"}[5m]))
# To:
sum by (job) (count_over_time({service="deepquasar"}[5m]))
```

## Step 6: Start Your Application

Make sure your DeepQuasar application is actually running and generating logs:

```bash
# In your project directory
npm start
# or
node index.js
```

The application needs to be running and generating log entries for the dashboard to show data.

## Quick Verification Checklist

- [ ] Loki is running (check http://localhost:3100/metrics)
- [ ] Grafana can connect to Loki datasource
- [ ] Environment variables are set (LOKI_URL, etc.)
- [ ] Your application is running and generating logs
- [ ] You can see logs in Grafana Explore with `{}`
- [ ] Dashboard time range includes when logs were generated

## Common Working Queries

Once you have logs flowing, these queries should work:

```logql
# Total log rate
sum(rate({}[5m]))

# Logs by level (if available)
sum by (level) (rate({level!=""}[5m]))

# Recent logs
{} | line_format "{{.timestamp}} {{.level}} {{.message}}"

# Error logs only
{level="error"}
```

If you're still having issues after these steps, the problem is likely in the Loki connection or your application isn't generating logs yet.

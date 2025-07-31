# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# Install tini for proper signal handling (optional but recommended)
RUN apk add --no-cache tini

# Copy package manifests first to leverage Docker layer caching
COPY package*.json ./

# Install deps for production
RUN npm ci --omit=dev

# Copy the rest of the source code
COPY . .

# Ensure the CLI is executable (if needed for container builds)
RUN chmod +x ./bin/scaffold-module.js || true

# Use tini as entrypoint to handle SIGTERM/SIGINT gracefully
ENTRYPOINT ["/sbin/tini", "--"]

# Environment variables expected at runtime:
# - DISCORD_TOKEN
# - GUILD_ID (optional)
# - LOG_LEVEL (optional)
# - HOT_RELOAD_REINSTALL (optional)
# - MODULE_* flags (optional)

CMD ["node", "index.js"]
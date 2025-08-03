#!/usr/bin/env node
/**
 * Clear Discord application commands (global or guild) using Discord API.
 *
 * Scope selection:
 * - Env-driven default:
 *    COMMANDS_TARGET=guild|global
 *    If guild: requires GUILD_ID
 * - CLI overrides:
 *    --scope=guild|global
 *    --guild=<GUILD_ID>
 *
 * Safety:
 * - Global clears require FORCE=yes (env var) unless --yes is passed explicitly.
 *
 * Requirements:
 * - DISCORD_TOKEN
 * - DISCORD_CLIENT_ID (application id)
 *
 * Usage examples:
 *   node bin/clear-commands.js
 *   npm run clear
 *   npm run clear -- --scope=guild --guild=1234567890
 *   FORCE=yes npm run clear -- --scope=global
 */

import 'dotenv/config';
import { fetch } from 'undici';

// Simple argv parser for --key=value and --key value
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      const key = a.slice(2, eq);
      const val = a.slice(eq + 1);
      args[key] = val;
    } else {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function exitWith(msg, code = 1) {
  console.error(`[clear-commands] ${msg}`);
  process.exit(code);
}

function getEnv(name) {
  return process.env[name] ?? '';
}

async function putJson(url, body, headers) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  }).catch((err) => ({ ok: false, status: 0, _error: err }));

  if (!res || res._error) {
    throw new Error(`Network error: ${res?._error?.message || 'unknown'}`);
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  let data = null;
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    try {
      data = await res.text();
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const info = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Discord API error ${res.status}: ${info || res.statusText}`);
  }

  return { status: res.status, data };
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));

  const token = getEnv('DISCORD_TOKEN');
  const appId = getEnv('DISCORD_CLIENT_ID'); // aka application id
  if (!token) exitWith('DISCORD_TOKEN is required');
  if (!appId) exitWith('DISCORD_CLIENT_ID is required');

  // Determine scope: CLI override wins, then env COMMANDS_TARGET
  let scope = (argv.scope || getEnv('COMMANDS_TARGET') || '').toLowerCase();
  if (scope !== 'guild' && scope !== 'global') {
    // Fallback heuristic: if GUILD_ID is present, assume guild; else global
    scope = getEnv('GUILD_ID') ? 'guild' : 'global';
  }

  // Guild id from CLI or env
  const cliGuild = argv.guild;
  const envGuild = getEnv('GUILD_ID');
  const guildId = cliGuild || envGuild;

  if (scope === 'guild' && !guildId) {
    exitWith('GUILD_ID is required for guild scope (set env GUILD_ID or pass --guild=ID)');
  }

  // Safety for global clears
  const forceEnvYes = (getEnv('FORCE') || '').toLowerCase() === 'yes';
  const forceFlag = argv.yes === true || String(argv.yes || '').toLowerCase() === 'yes';

  if (scope === 'global' && !(forceEnvYes || forceFlag)) {
    exitWith('Global clear requires confirmation. Set FORCE=yes in env or pass --yes');
  }

  const base = 'https://discord.com/api/v10';
  const headers = {
    Authorization: `Bot ${token}`,
    'User-Agent': 'modular-discord-bot/clear-commands (v0.1)',
  };

  const targetUrl =
    scope === 'guild'
      ? `${base}/applications/${encodeURIComponent(appId)}/guilds/${encodeURIComponent(guildId)}/commands`
      : `${base}/applications/${encodeURIComponent(appId)}/commands`;

  console.log(
    `[clear-commands] Scope=${scope}${scope === 'guild' ? ` guild=${guildId}` : ''} url=${targetUrl}`
  );

  // The canonical "wipe" is PUT [] (replace commands with empty list)
  try {
    const { status, data } = await putJson(targetUrl, [], headers);
    // For PUT [], Discord typically returns the new list ([]) with 200
    const count = Array.isArray(data) ? data.length : 0;
    console.log(
      `[clear-commands] Success. HTTP ${status}. Commands now present: ${count} (expected 0)`
    );
    process.exit(0);
  } catch (err) {
    exitWith(`Failed to clear commands: ${err.message}`);
  }
}

main().catch((e) => exitWith(`Unhandled error: ${e.message}`));
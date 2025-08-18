import { SlashCommandBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

function formatBytes(b) {
  if (b === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Math.abs(b)) / Math.log(k));
  const v = b / Math.pow(k, i);
  return `${v.toFixed(2)} ${sizes[i]}`;
}

function formatDuration(s) {
  s = Math.floor(s);
  const days = Math.floor(s / 86400);
  s -= days * 86400;
  const hrs = Math.floor(s / 3600);
  s -= hrs * 3600;
  const mins = Math.floor(s / 60);
  const secs = s - mins * 60;
  const pieces = [];
  if (days) pieces.push(`${days}d`);
  if (hrs) pieces.push(`${hrs}h`);
  if (mins) pieces.push(`${mins}m`);
  pieces.push(`${secs}s`);
  return pieces.join(' ');
}

export function register(core) {
  const { commands, logger, config } = core;
  const MODULE_NAME = 'core-utilities';

  commands.registerSlash(
    MODULE_NAME,
    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Show runtime and system statistics for the bot')
      .setDMPermission(true)
      .toJSON()
  );

  // Helper to compute module enablement flags like index.js
  function moduleFlagName(moduleName) {
    return `MODULE_${String(moduleName).toUpperCase()}_ENABLED`;
  }

  commands.v2RegisterExecute('stats', async (interaction) => {
    try {
      await interaction.deferReply({ ephemeral: false });

      // Process & system info
      const mem = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

      // Modules: inspect modules directory
      const modulesDir = path.resolve(process.cwd(), 'modules');
      let totalModules = 0;
      let enabled = 0;
      let disabled = 0;
      try {
        const folders = await fs.promises.readdir(modulesDir, { withFileTypes: true });
        for (const d of folders) {
          if (!d.isDirectory()) continue;
          totalModules++;
          const flag = moduleFlagName(d.name);
          if (config.isEnabled(flag, true)) enabled++; else disabled++;
        }
      } catch (err) {
        logger.warn(`stats: failed to read modules dir: ${err?.message}`);
      }

      const load = os.loadavg();
      const cpus = os.cpus();

      const embed = {
        title: 'Bot / System Stats',
        color: 0x2b2d31,
        timestamp: new Date().toISOString(),
        fields: [
          {
            name: 'Uptime',
            value:
              `Process: ${formatDuration(process.uptime())}\n` +
              `System: ${formatDuration(os.uptime())}`,
            inline: true,
          },
          {
            name: 'Memory (process)',
            value:
              `RSS: ${formatBytes(mem.rss)}\n` +
              `Heap: ${formatBytes(mem.heapUsed)} / ${formatBytes(mem.heapTotal)}` +
              (mem.external != null ? `\nExternal: ${formatBytes(mem.external)}` : ''),
            inline: true,
          },
          {
            name: 'CPU',
            value:
              `Cores: ${cpus.length}\n` +
              `LoadAvg (1m/5m/15m): ${load.map((n) => n.toFixed(2)).join(' / ')}\n` +
              `Process CPU time: ${(cpuUsage.user + cpuUsage.system) / 1e6} s`,
            inline: false,
          },
          {
            name: 'Modules',
            value: `Enabled: ${enabled} \nDisabled: ${disabled} \nTotal: ${totalModules}`,
            inline: true,
          },
          {
            name: 'Runtime',
            value:
              `Node: ${process.version}\n` +
              `Platform: ${process.platform} ${process.arch}\n` +
              `PID: ${process.pid}`,
            inline: true,
          },
        ],
      };

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      try {
        logger.error(`stats command error: ${err?.message}`, { stack: err?.stack });
        await interaction.editReply({ content: `Failed to compute stats: ${err?.message}` });
      } catch (e) {
        // ignore
      }
    }
  });

  logger.info('Registered /stats command (core-utilities)');
}

export default { register };

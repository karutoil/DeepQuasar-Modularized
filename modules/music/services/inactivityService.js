// InactivityService: schedules auto-leave when a voice channel becomes empty and warns before disconnect
// Uses MusicSettings for per-guild timeout; integrates with module lifecycle for cleanup.

import { createMusicSettings } from "./musicSettings.js";

export class InactivityService {
  constructor(ctx, moonlink) {
    this.ctx = ctx;
    this.logger = ctx.logger;
    this.client = ctx.client;
    this.embed = ctx.embed;
    this.moonlink = moonlink;
    this.settings = createMusicSettings(ctx);

    this.timers = new Map(); // guildId -> { timeout, warnTimeout }
  }

  clear(guildId) {
    const t = this.timers.get(guildId);
    if (t?.timeout) { try { clearTimeout(t.timeout); } catch {} }
    if (t?.warnTimeout) { try { clearTimeout(t.warnTimeout); } catch {} }
    this.timers.delete(guildId);
  }

  async schedule(guildId, player) {
    try {
      this.clear(guildId);

      const timeoutMs = await this.settings.getInactivityTimeoutMs(guildId).catch(() => 300000);
      const warnMs = Math.max(1000, Math.min(timeoutMs - 60000, timeoutMs - 60000)); // warn ~60s prior if possible

      // Schedule warning
      const warnTimeout = setTimeout(async () => {
        try {
          const chId = player?.textChannelId || player?.textChannel;
          const ch = this.client?.channels?.cache?.get?.(chId);
          if (ch?.send && this.embed) {
            await ch.send({ embeds: [this.embed.warn({ title: "Leaving soon", description: "Everyone left the voice channel. Disconnecting in ~60s unless someone rejoins." })] }).catch(() => {});
          }
        } catch (e) {
          this.logger?.debug?.("[InactivityService] warn send failed", { error: e?.message });
        }
      }, Math.max(0, warnMs));

      // Schedule disconnect
      const timeout = setTimeout(async () => {
        try {
          const p = this.moonlink?.players?.get?.(guildId);
          if (p) {
            this.logger?.info?.("[InactivityService] Auto-leave destroying player", { guildId });
            try { p.destroy?.(); } catch {}
          }
        } catch (e) {
          this.logger?.warn?.("[InactivityService] auto-leave error", { error: e?.message });
        } finally {
          this.clear(guildId);
        }
      }, Math.max(1000, timeoutMs));

      this.timers.set(guildId, { timeout, warnTimeout });
      this.logger?.debug?.("[InactivityService] Scheduled", { guildId, timeoutMs });
    } catch (e) {
      this.logger?.warn?.("[InactivityService] schedule failed", { guildId, error: e?.message });
    }
  }
}

export function createInactivityService(ctx, moonlink) {
  return new InactivityService(ctx, moonlink);
}
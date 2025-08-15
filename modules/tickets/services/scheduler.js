// Ticket scheduler wiring using core/scheduler to run inactivity warning and auto-close checks
import { findInactiveTickets, findWarningDueTickets, markWarned, updateTicket, archiveTicket, finalizeClosed, getTicketById } from "./ticketService.js";
import { getGuildSettings } from "./settingsService.js";

/**
 * Create ticket scheduler jobs.
 * Returns a disposer function to stop all jobs.
 */
export function createTicketScheduler(ctx, scheduler) {
  const { logger, client, lifecycle } = ctx;

  const stops = [];

  // Every 5 minutes: send inactivity warnings where due
  stops.push(
    scheduler.schedule("*/5 * * * *", async () => {
      try {
        const guilds = client.guilds?.cache?.values?.() ? Array.from(client.guilds.cache.values()) : [];
        for (const g of guilds) {
          const guildId = g.id;
          const settings = await getGuildSettings(ctx, guildId);
          if (settings.autoClosure.warningMs <= 0) continue;

          const tickets = await findWarningDueTickets(ctx, guildId);
          for (const t of tickets) {
            try {
              const channel = await client.channels.fetch(t.channelId).catch(() => null);
              if (!channel) continue;
              await channel.send(settings.autoClosure.warningMessage || "This ticket will be closed due to inactivity. Reply to keep it open.");
              await markWarned(ctx, guildId, t.ticketId);
            } catch (e) {
              logger.warn("[Tickets] warning send failed", { guildId, ticketId: t.ticketId, error: e?.message });
            }
          }
        }
      } catch (err) {
        logger.error("[Tickets] warning job error", { error: err?.message });
      }
    })
  );

  // Every 10 minutes: auto-close tickets past inactivity threshold
  stops.push(
    scheduler.schedule("*/10 * * * *", async () => {
      try {
        const guilds = client.guilds?.cache?.values?.() ? Array.from(client.guilds.cache.values()) : [];
        for (const g of guilds) {
          const guildId = g.id;
          const tickets = await findInactiveTickets(ctx, guildId);
          for (const t of tickets) {
            try {
              // Close and archive
              const channel = await client.channels.fetch(t.channelId).catch(() => null);
              let transcript = null;
              try {
                const { generateTranscriptAndUpload } = await import("./transcriptService.js");
                transcript = await generateTranscriptAndUpload(ctx, t.guildId, t.channelId);
              } catch (e) {
                logger.warn("[Tickets] transcript generation failed in scheduler", { ticketId: t.ticketId, error: e?.message });
              }

              await finalizeClosed(ctx, guildId, t.ticketId, { reason: "Auto-closed due to inactivity", transcript });
              // Attempt DM to opener
              try {
                const opener = await client.users.fetch(t.openerId);
                const settings = await getGuildSettings(ctx, guildId);
                if (settings?.transcript?.dmUser && transcript?.url) {
                  await opener.send(`Your ticket has been closed due to inactivity. Transcript: ${transcript.url}`);
                } else {
                  await opener.send(`Your ticket has been closed due to inactivity.`);
                }
              } catch (err) { void err; }

              // Delete channel after closing if still exists
              if (channel && channel.deletable) {
                await channel.delete("Ticket auto-closed due to inactivity");
              }
              await archiveTicket(ctx, guildId, t.ticketId);
            } catch (e) {
              logger.warn("[Tickets] auto-close failed", { guildId, ticketId: t.ticketId, error: e?.message });
            }
          }
        }
      } catch (err) {
        logger.error("[Tickets] auto-close job error", { error: err?.message });
      }
    })
  );

  const stopAll = () => {
    for (const stop of stops) {
      try { stop?.(); } catch (err) { void err; }
    }
  };

  lifecycle?.addDisposable?.(() => {
    try { stopAll(); } catch (err) { void err; }
  });

  return stopAll;
}
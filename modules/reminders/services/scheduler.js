/**
 * Reminder Scheduler Service
 * - Periodically checks for due reminders (one-time and recurring)
 * - Triggers reminders at the correct local time (using user timezones)
 * - Handles recurring reminders by rescheduling
 * - Uses robust error handling and lifecycle cleanup
 * - Extensible for future features
 */

import { getDueReminders, updateReminder, deleteReminder } from "./reminderService.js";
import { getUserTimezone } from "./timezoneService.js";
import cronParser from "cron-parser";

import { DateTime } from "luxon";
import { createEmbed } from "../../../core/embed.js";

/**
 * Calculate the next occurrence for a recurring reminder.
 * Supports simple recurrence strings: "daily", "weekly", "monthly", or cron (future extensibility).
 * @param {string} recurrence
 * @param {Date} fromDate
 * @returns {Date|null}
 */
function getNextOccurrence(recurrence, fromDate) {
  if (!recurrence) return null;
  const date = new Date(fromDate);
  switch (recurrence) {
    case "daily":
      date.setUTCDate(date.getUTCDate() + 1);
      return date;
    case "weekly":
      date.setUTCDate(date.getUTCDate() + 7);
      return date;
    case "monthly":
      date.setUTCMonth(date.getUTCMonth() + 1);
      return date;
    default:
      // Try to parse as a cron expression
      try {
        const interval = cronParser.parseExpression(recurrence, { currentDate: date });
        return interval.next().toDate();
      } catch (err) {
        // Invalid cron expression
        // Optionally log error here if context available
        return null;
      }
  }
}

/**
 * Convert a UTC ISO time to a user's local time.
 * If timezone is not set, fallback to UTC.
 * @param {string} isoTime
 * @param {string|null} timezone
 * @returns {Date}
 */
function toUserLocalTime(isoTime, timezone) {
  try {
    // Use provided timezone, fallback to UTC if not set
    const zone = timezone || "UTC";
    const dt = DateTime.fromISO(isoTime, { zone });
    if (!dt.isValid) {
      // Invalid timezone or ISO string
      // Optionally log error here if context available
      return new Date(isoTime); // fallback to UTC
    }
    return dt.toJSDate();
  } catch (err) {
    // Error in conversion (invalid timezone, etc.)
    // Optionally log error here if context available
    return new Date(isoTime); // fallback to UTC
  }
}

/**
 * Send a reminder using Discord.js APIs.
 * If channelId is set, send to channel; else DM user.
 * Handles delivery errors.
 * @param {object} ctx - Module context (provides Discord client, logger, errorReporter)
 * @param {object} reminder - Reminder object ({ userId, message, time, recurrence, channelId })
 * @param {string|null} timezone - User's timezone
 */
async function sendReminder(ctx, reminder, timezone) {
  try {
    // Use Luxon to format times in user's timezone
    const zone = timezone || "UTC";
    const reminderTime = reminder.time
      ? DateTime.fromISO(reminder.time, { zone })
      : null;
    const createdTime = reminder.createdAt
      ? DateTime.fromISO(reminder.createdAt, { zone })
      : null;

    // Absolute time string
    const absoluteTime = reminderTime
      ? reminderTime.toLocaleString(DateTime.DATETIME_MED)
      : "Unknown";
    // Relative time string (e.g., "Today at 10:00 AM")
    let relativeTime = "Unknown";
    if (reminderTime) {
      const now = DateTime.now().setZone(zone);
      if (reminderTime.hasSame(now, "day")) {
        relativeTime = `Today at ${reminderTime.toLocaleString(DateTime.TIME_SIMPLE)}`;
      } else if (reminderTime.hasSame(now.plus({ days: 1 }), "day")) {
        relativeTime = `Tomorrow at ${reminderTime.toLocaleString(DateTime.TIME_SIMPLE)}`;
      } else {
        relativeTime = reminderTime.toRelativeCalendar({ base: now });
        if (relativeTime) {
          relativeTime = `${relativeTime} at ${reminderTime.toLocaleString(DateTime.TIME_SIMPLE)}`;
        } else {
          relativeTime = absoluteTime;
        }
      }
    }

    // Initialize embed API with config from context or default
    const embedApi = createEmbed(ctx.config);
    // Use standardized embed format for reminder delivery
    const embed = embedApi.info({
      title: "Reminder",
      description: reminder.message,
      fields: [
        {
          name: "Scheduled Time",
          value: `**${absoluteTime}** (${zone})\n${relativeTime}`,
          inline: false,
        },
        {
          name: "Requested At",
          value: createdTime
            ? createdTime.toLocaleString(DateTime.DATETIME_MED)
            : "Unknown",
          inline: false,
        },
      ],
      timestamp: reminder.time || reminder.createdAt,
    });

    if (reminder.channelId) {
      // Send embed to channel
      const channel = await ctx.client.channels.fetch(reminder.channelId);
      if (!channel || !channel.send) throw new Error("Channel not found or cannot send messages");
      await channel.send({ embeds: [embed] });
      ctx.logger.info(`[Reminders] Sent embed reminder to channel ${reminder.channelId} for user ${reminder.userId}`);
    } else {
      // Send embed DM to user
      const user = await ctx.client.users.fetch(reminder.userId);
      if (!user || !user.send) throw new Error("User not found or cannot send DMs");
      await user.send({ embeds: [embed] });
      ctx.logger.info(`[Reminders] Sent embed DM reminder to user ${reminder.userId}`);
    }
  } catch (err) {
    ctx.logger.error(`[Reminders] Failed to deliver reminder ${reminder._id} to user ${reminder.userId}: ${err?.message || err}`);
    await ctx.errorReporter?.report?.(err, { scope: "reminders", op: "deliver", reminderId: reminder._id });
  }
}

/**
 * Setup function to be called by the module.
 * @param {object} ctx - Module context
 */
export function setup(ctx) {
  ctx.logger.info("[Reminders] Scheduler service starting");

  // Schedule job every 5 seconds for timely delivery of short-duration reminders
  const stop = ctx.scheduler.schedule("*/5 * * * * *", async () => {
    await ctx.utils.safeAsync(async () => {
      const now = new Date();
      const _nextCheck = new Date(now.getTime() + 5 * 1000);

      // Fetch reminders due up to now
      const dueReminders = await getDueReminders(ctx, now);

      for (const reminder of dueReminders) {
        try {
          // Fetch user timezone
          const timezone = await getUserTimezone(ctx, reminder.userId);

          // Convert scheduled time to user's local time (placeholder, currently UTC)
          const scheduledTime = toUserLocalTime(reminder.time, timezone);

          // Check if reminder is due (allow a 1-minute window)
          if (scheduledTime <= now) {
            // Trigger reminder (placeholder)
            await sendReminder(ctx, reminder, timezone);

            if (reminder.recurrence) {
              // Recurring: reschedule next occurrence
              const nextTime = getNextOccurrence(reminder.recurrence, scheduledTime);
              if (nextTime) {
                await updateReminder(ctx, reminder._id, { time: nextTime.toISOString() });
                ctx.logger.info(`[Reminders] Rescheduled recurring reminder ${reminder._id} for user ${reminder.userId} to ${nextTime.toISOString()}`);
              } else {
                // If recurrence is invalid, delete reminder
                await deleteReminder(ctx, reminder._id);
                ctx.logger.warn(`[Reminders] Deleted invalid recurring reminder ${reminder._id} for user ${reminder.userId}`);
              }
            } else {
              // One-time: delete reminder
              await deleteReminder(ctx, reminder._id);
              ctx.logger.info(`[Reminders] Deleted one-time reminder ${reminder._id} for user ${reminder.userId}`);
            }
          }
        } catch (err) {
          ctx.logger.error(`[Reminders] Error processing reminder ${reminder._id}: ${err?.message || err}`);
          await ctx.errorReporter?.report?.(err, { scope: "reminders", op: "process", reminderId: reminder._id });
        }
      }
    }, (err) => {
      ctx.logger.error("[Reminders] Scheduler job failed", { error: err?.message || err });
      ctx.errorReporter?.report?.(err, { scope: "reminders", op: "scheduler" });
    });
  }, { immediate: true });

  // Ensure cleanup on module unload/hot-reload
  ctx.lifecycle.addDisposable(stop);

  ctx.logger.info("[Reminders] Scheduler service started");
}
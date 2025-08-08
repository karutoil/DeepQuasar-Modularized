import { createReminder } from "../services/reminderService.js";
import { getUserTimezone } from "../services/timezoneService.js";
import { parseNaturalLanguageTime } from "../utils/validation.js";
import { DateTime } from "luxon";

export function setup(ctx) {
  const builder = ctx.v2.createInteractionCommand()
    .setName("remind")
    .setDescription("Set a one-time reminder")
    .addStringOption(opt => opt.setName("message").setDescription("Reminder message").setRequired(true))
    .addStringOption(opt => opt.setName("time").setDescription("When to remind (e.g. 2025-08-08T15:00)").setRequired(true))
    .onExecute(ctx.dsl.withTryCatch(
      ctx.dsl.withDeferredReply(async (i) => {
        const userId = i.user.id;
        const message = i.options.getString("message");
        const time = i.options.getString("time");
        const timezone = await getUserTimezone(ctx, userId);

        // Validate message
        if (!message || message.trim().length === 0) {
          await i.editReply({ embeds: [ctx.embed.error({ title: "Missing message", description: "Please provide a reminder message." })], ephemeral: true });
          return;
        }

        // Validate time
        if (!time || time.trim().length === 0) {
          await i.editReply({ embeds: [ctx.embed.error({ title: "Missing time", description: "Please provide when to remind (e.g. 'in 10 minutes', 'tomorrow at 5pm', '2025-08-08T15:00')." })], ephemeral: true });
          return;
        }
        const { date: parsedDate, error: timeError } = parseNaturalLanguageTime(time);
        if (timeError) {
          await i.editReply({ embeds: [ctx.embed.error({ title: "Invalid or ambiguous time", description: timeError })], ephemeral: true });
          return;
        }
        const isoTime = parsedDate.toISOString();

        try {
          const reminder = await createReminder(ctx, { userId, message, time: isoTime, recurrence: null, channelId: null });
          // Format scheduled time using Luxon
          const luxonDate = DateTime.fromJSDate(parsedDate, { zone: timezone || "UTC" });
          const absolute = luxonDate.toLocaleString(DateTime.DATETIME_FULL);
          const relative = luxonDate.toRelativeCalendar();
          const zoneDisplay = luxonDate.zoneName;

          await i.editReply({ embeds: [ctx.embed.success({
            title: "Reminder Created",
            description:
              `Your reminder is scheduled for:\n` +
              `• **${absolute}** (${zoneDisplay})\n` +
              `• _${relative}_\n\n` +
              `Message: ${message}`
          })], ephemeral: true });
        } catch (err) {
          await i.editReply({ embeds: [ctx.embed.error({ title: "Failed to create reminder", description: err?.message || "An unexpected error occurred." })], ephemeral: true });
        }
      })
    ));

  const off = builder.register(ctx, "reminders", { stateManager: ctx.v2.state });
  ctx.lifecycle.addDisposable(off);
}
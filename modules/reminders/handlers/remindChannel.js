import { createReminder } from "../services/reminderService.js";
import { getUserTimezone } from "../services/timezoneService.js";
import { parseNaturalLanguageTime } from "../utils/validation.js";

export function setup(ctx) {
  const builder = ctx.v2.createInteractionCommand()
    .setName("remind_channel")
    .setDescription("Set a reminder in a specific channel")
    .addStringOption(opt => opt.setName("message").setDescription("Reminder message").setRequired(true))
    .addStringOption(opt => opt.setName("time").setDescription("When to remind (ISO)").setRequired(true))
    .addChannelOption(opt => opt.setName("channel").setDescription("Channel to send reminder").setRequired(true))
    .onExecute(ctx.dsl.withTryCatch(
      ctx.dsl.withDeferredReply(async (i) => {
        const userId = i.user.id;
        const message = i.options.getString("message");
        const time = i.options.getString("time");
        const channel = i.options.getChannel("channel");
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

        // Validate channel
        if (!channel || !channel.id) {
          await i.editReply({ embeds: [ctx.embed.error({ title: "Missing channel", description: "Please select a valid channel for the reminder." })], ephemeral: true });
          return;
        }

        try {
          const _reminder = await createReminder(ctx, { userId, message, time: isoTime, recurrence: null, channelId: channel.id });
          await i.editReply({ embeds: [ctx.embed.success({
            title: "Channel Reminder Created",
            description: `Your reminder will be sent in <#${channel.id}> at **${isoTime}**${timezone ? " (" + timezone + ")" : ""}.\n\nMessage: ${message}`
          })], ephemeral: true });
        } catch (err) {
          await i.editReply({ embeds: [ctx.embed.error({ title: "Failed to create channel reminder", description: err?.message || "An unexpected error occurred." })], ephemeral: true });
        }
      })
    ));

  const off = builder.register(ctx, "reminders", { stateManager: ctx.v2.state });
  ctx.lifecycle.addDisposable(off);
}
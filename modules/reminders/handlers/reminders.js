import { getRemindersForUser, deleteReminder, updateReminder } from "../services/reminderService.js";
import { getUserTimezone } from "../services/timezoneService.js";
import { ButtonStyle } from "discord.js";
import { DateTime } from "luxon";

export function setup(ctx) {
  const builder = ctx.v2.createInteractionCommand()
    .setName("reminders")
    .setDescription("View and manage your reminders")
    .onExecute(ctx.dsl.withTryCatch(
      ctx.dsl.withDeferredReply(async (i) => {
        const userId = i.user.id;
        const timezone = await getUserTimezone(ctx, userId);
        const reminders = await getRemindersForUser(ctx, userId);

        if (!reminders.length) {
          await i.editReply({ embeds: [ctx.embed.info({ title: "No reminders", description: "You have no active reminders." })], ephemeral: true });
          return;
        }

        // Helper to build action row for a reminder
        function buildActionRow(reminderId) {
          return {
            type: 1,
            components: [
              ctx.v2.createInteractionCommand().button(ctx, "reminders", "edit", "Edit", ButtonStyle.Primary, { reminderId }),
              ctx.v2.createInteractionCommand().button(ctx, "reminders", "delete", "Delete", ButtonStyle.Danger, { reminderId }),
              ctx.v2.createInteractionCommand().button(ctx, "reminders", "snooze", "Snooze", ButtonStyle.Secondary, { reminderId }),
            ]
          };
        }

        // Build embed pages for each reminder, with action buttons
        const totalReminders = reminders.length;
        const pages = reminders.map((rem, idx) => ({
          title: "Reminder",
          description: rem.message,
          fields: [
            {
              name: "Time",
              value: (() => {
                const luxonDate = DateTime.fromISO(rem.time, { zone: timezone || "UTC" });
                const absolute = luxonDate.toLocaleString(DateTime.DATETIME_FULL);
                const relative = luxonDate.toRelativeCalendar();
                const zoneDisplay = luxonDate.zoneName;
                return `• **${absolute}** (${zoneDisplay})\n• _${relative}_`;
              })(),
              inline: true
            },
            { name: "Type", value: rem.recurrence ? `Recurring (${rem.recurrence})` : "One-time", inline: true },
            ...(rem.channelId ? [{ name: "Channel", value: `<#${rem.channelId}>`, inline: true }] : [])
          ],
          footerText: `ID: ${rem._id} | Page ${idx + 1}/${totalReminders} | Total reminders: ${totalReminders}`,
          components: [buildActionRow(rem._id)]
        }));

        // Use paginated embed UI
        const { message, dispose, refresh } = ctx.v2.ui.createPaginatedEmbed(ctx, builder, "reminders", pages, { ephemeral: true });
        await i.editReply(message);
        ctx.lifecycle.addDisposable(dispose);

        // Helper to refresh reminders list after actions
        async function refreshReminders(interaction) {
          const userId = interaction.user.id;
          const timezone = await getUserTimezone(ctx, userId);
          const reminders = await getRemindersForUser(ctx, userId);
          if (!reminders.length) {
            await interaction.update({ embeds: [ctx.embed.info({ title: "No reminders", description: "You have no active reminders." })], components: [] });
            return;
          }
          const totalReminders = reminders.length;
          const pages = reminders.map((rem, idx) => ({
            title: "Reminder",
            description: rem.message,
            fields: [
              {
                name: "Time",
                value: (() => {
                  const luxonDate = DateTime.fromISO(rem.time, { zone: timezone || "UTC" });
                  const absolute = luxonDate.toLocaleString(DateTime.DATETIME_FULL);
                  const relative = luxonDate.toRelativeCalendar();
                  const zoneDisplay = luxonDate.zoneName;
                  return `• **${absolute}** (${zoneDisplay})\n• _${relative}_`;
                })(),
                inline: true
              },
              { name: "Type", value: rem.recurrence ? `Recurring (${rem.recurrence})` : "One-time", inline: true },
              ...(rem.channelId ? [{ name: "Channel", value: `<#${rem.channelId}>`, inline: true }] : [])
            ],
            footerText: `ID: ${rem._id} | Page ${idx + 1}/${totalReminders} | Total reminders: ${totalReminders}`,
            components: [buildActionRow(rem._id)]
          }));
          const { message, dispose } = ctx.v2.ui.createPaginatedEmbed(ctx, builder, "reminders", pages, { ephemeral: true });
          await interaction.update(message);
          ctx.lifecycle.addDisposable(dispose);
        }
      })
    ))
    // Button: Delete (with confirmation dialog)
    .onButton("delete", async (i) => {
      const parsed = ctx.ids.parse(i.customId);
      const reminderId = parsed.extras?.reminderId;
      if (!reminderId) {
        await i.update({ embeds: [ctx.embed.error({ title: "Invalid reminder ID", description: "Could not find the reminder to delete." })], components: [] });
        return;
      }
      // Confirmation dialog
      const { message, dispose } = ctx.v2.ui.createConfirmationDialog(
        ctx,
        builder,
        "reminders",
        "Are you sure you want to delete this reminder?",
        async (confirmInteraction) => {
          const success = await deleteReminder(ctx, reminderId);
          await refreshReminders(confirmInteraction);
          await confirmInteraction.followUp({
            embeds: [success
              ? ctx.embed.success({ title: "Reminder Deleted", description: "Your reminder has been deleted successfully." })
              : ctx.embed.error({ title: "Delete Failed", description: "Could not delete the reminder. It may not exist or an error occurred." })
            ],
            ephemeral: true
          });
        },
        async (cancelInteraction) => {
          await cancelInteraction.update({ embeds: [ctx.embed.info({ title: "Delete Cancelled", description: "Reminder was not deleted." })], components: [] });
        },
        { ephemeral: true }
      );
      await i.update(message);
      ctx.lifecycle.addDisposable(dispose);
    })
    // Button: Snooze
    .onButton("snooze", async (i) => {
      const parsed = ctx.ids.parse(i.customId);
      const reminderId = parsed.extras?.reminderId;
      if (!reminderId) {
        await i.update({ embeds: [ctx.embed.error({ title: "Invalid reminder ID", description: "Could not find the reminder to snooze." })], components: [] });
        return;
      }
      try {
        const reminder = await updateReminder(ctx, reminderId, { time: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
        await refreshReminders(i);
        await i.followUp({
          embeds: [reminder
            ? ctx.embed.success({ title: "Reminder Snoozed", description: "Your reminder has been snoozed for 10 minutes." })
            : ctx.embed.error({ title: "Snooze Failed", description: "Could not snooze the reminder. It may not exist or an error occurred." })
          ],
          ephemeral: true
        });
      } catch (err) {
        await i.update({ embeds: [ctx.embed.error({ title: "Snooze Error", description: err?.message || "An unexpected error occurred while snoozing." })], components: [] });
      }
    })
    // Button: Edit (opens modal form)
    .onButton("edit", async (i) => {
      const parsed = ctx.ids.parse(i.customId);
      const reminderId = parsed.extras?.reminderId;
      if (!reminderId) {
        await i.update({ embeds: [ctx.embed.error({ title: "Invalid reminder ID", description: "Could not find the reminder to edit." })], components: [] });
        return;
      }
      // Fetch reminder
      const reminder = await ctx.v2.state.withKey(`reminder:${reminderId}`).get("data") ||
        await ctx.v2.state.withKey(`reminder:${reminderId}`).set("data", await ctx.v2.state.withKey(`reminder:${reminderId}`).get("data") || await ctx.v2.state.withKey(`reminder:${reminderId}`).get("data"));
      let rem = reminder;
      if (!rem) {
        rem = await ctx.v2.state.withKey(`reminder:${reminderId}`).get("data");
        if (!rem) rem = await ctx.v2.state.withKey(`reminder:${reminderId}`).set("data", await ctx.v2.state.withKey(`reminder:${reminderId}`).get("data"));
      }
      if (!rem) {
        rem = await getRemindersForUser(ctx, i.user.id).then(list => list.find(r => String(r._id) === String(reminderId)));
      }
      if (!rem) {
        await i.update({ embeds: [ctx.embed.error({ title: "Reminder Not Found", description: "Could not find the reminder to edit." })], components: [] });
        return;
      }
      // Modal form for editing
      const { modal, open, dispose } = ctx.v2.ui.createForm(ctx, builder, "reminders", {
        title: "Edit Reminder",
        fields: [
          { customId: "message", label: "Message", style: "SHORT", required: true, value: rem.message },
          { customId: "time", label: "Time (ISO)", style: "SHORT", required: true, value: rem.time }
        ]
      });
      await open(i);
      ctx.lifecycle.addDisposable(dispose);
      // Register modal handler
      builder.onModal("reminders", async (modalInteraction) => {
        const values = ctx.v2.ui.parseModal(modalInteraction);
        // Validate time
        const parsedTime = new Date(values.time);
        if (isNaN(parsedTime.getTime())) {
          await modalInteraction.reply({ embeds: [ctx.embed.error({ title: "Invalid time format", description: "Please use a valid ISO format (e.g. 2025-08-08T15:00)." })], ephemeral: true });
          return;
        }
        const updated = await updateReminder(ctx, reminderId, { message: values.message, time: parsedTime.toISOString() });
        await refreshReminders(modalInteraction);
        await modalInteraction.followUp({
          embeds: [updated
            ? ctx.embed.success({ title: "Reminder Updated", description: "Your reminder has been updated." })
            : ctx.embed.error({ title: "Update Failed", description: "Could not update the reminder. It may not exist or an error occurred." })
          ],
          ephemeral: true
        });
      });
    });

  const off = builder.register(ctx, "reminders", { stateManager: ctx.v2.state });
  ctx.lifecycle.addDisposable(off);
}
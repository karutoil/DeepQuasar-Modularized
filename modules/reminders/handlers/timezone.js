import { setUserTimezone, getUserTimezone } from "../services/timezoneService.js";

export function setup(ctx) {
  const builder = ctx.v2.createInteractionCommand()
    .setName("timezone")
    .setDescription("Set or view your timezone")
    .addStringOption(opt => opt.setName("timezone").setDescription("Your timezone (e.g. America/New_York)").setRequired(false))
    .onExecute(ctx.dsl.withTryCatch(
      ctx.dsl.withDeferredReply(async (i) => {
        const userId = i.user.id;
        const tzInput = i.options.getString("timezone");

        if (tzInput) {
          // Validate timezone input (basic validation: non-empty string)
          if (typeof tzInput !== "string" || tzInput.trim().length === 0) {
            await i.editReply({ embeds: [ctx.embed.error({ title: "Invalid timezone", description: "Please provide a valid timezone (e.g. America/New_York)." })], ephemeral: true });
            return;
          }
          try {
            await setUserTimezone(ctx, userId, tzInput);
            await i.editReply({ embeds: [ctx.embed.success({ title: "Timezone Set", description: `Your timezone is now set to \`${tzInput}\`.` })], ephemeral: true });
          } catch (err) {
            await i.editReply({ embeds: [ctx.embed.error({ title: "Failed to set timezone", description: err?.message || "An unexpected error occurred." })], ephemeral: true });
          }
        } else {
          // Get timezone
          try {
            const timezone = await getUserTimezone(ctx, userId);
            if (timezone) {
              await i.editReply({ embeds: [ctx.embed.info({ title: "Your Timezone", description: `Your timezone is set to \`${timezone}\`.` })], ephemeral: true });
            } else {
              await i.editReply({ embeds: [ctx.embed.warn({ title: "No Timezone Set", description: "You have not set a timezone yet. Use `/timezone <your zone>` to set one." })], ephemeral: true });
            }
          } catch (err) {
            await i.editReply({ embeds: [ctx.embed.error({ title: "Failed to retrieve timezone", description: err?.message || "An unexpected error occurred." })], ephemeral: true });
          }
        }
      })
    ));

  const off = builder.register(ctx, "reminders", { stateManager: ctx.v2.state });
  ctx.lifecycle.addDisposable(off);
}
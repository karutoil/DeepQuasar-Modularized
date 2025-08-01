// Queue command handler
export function createQueueCommand(ctx, queueManager) {
  const { v2, embed, lifecycle } = ctx;
  const moduleName = "music";

  const queueCmd = v2.createInteractionCommand()
    .setName("queue")
    .setDescription("Show current music queue")
    .onExecute(async (interaction) => {
      const guildId = interaction.guildId;
      const queue = queueManager.getQueue(guildId);
      if (!queue.length) {
        await interaction.reply({ embeds: [embed.info({ title: "Queue is empty." })], ephemeral: true });
        return;
      }
      const desc = queue.map((t, i) => `${i + 1}. ${t.title} [${t.author}]`).join("\n");
      await interaction.reply({ embeds: [embed.base(0x00FF00, { title: "Current Queue", description: desc })], ephemeral: true });
    });

  // Support both core context and direct context
  let registrar;
  if (typeof ctx.createModuleContext === "function") {
    registrar = ctx.createModuleContext(moduleName).v2;
  } else {
    registrar = v2;
  }
  lifecycle.addDisposable(registrar.register(queueCmd));
  return queueCmd;
}

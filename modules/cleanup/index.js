// Cleanup module for DeepQuasar
import { PermissionFlagsBits } from "discord.js";

export default async function init(ctx) {
  const { logger, config, v2, embed, dsl, lifecycle, _mongo } = ctx;
  const moduleName = "cleanup";

  // Feature flag
  if (!config.isEnabled("MODULE_CLEANUP_ENABLED", true)) {
    logger.info("MODULE_CLEANUP_ENABLED=false, skipping initialization");
    return { name: moduleName, description: "Cleanup module (disabled)" };
  }

  // Main command builder
  const cleanupCmd = v2.createInteractionCommand()
    .setName("cleanup")
    .setDescription("Bulk cleanup actions for channels and messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addOption(builder => {
      builder
        .addSubcommand(sub =>
          sub.setName("all")
            .setDescription("Delete and recreate this channel")
        )
        .addSubcommand(sub =>
          sub.setName("messages")
            .setDescription("Delete X most recent messages")
            .addIntegerOption(opt =>
              opt.setName("count")
                .setDescription("Number of messages to delete (max 100)")
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub.setName("user")
            .setDescription("Delete X messages from a user")
            .addUserOption(opt =>
              opt.setName("target")
                .setDescription("User whose messages to delete")
                .setRequired(true)
            )
            .addIntegerOption(opt =>
              opt.setName("count")
                .setDescription("Number of messages to delete (max 100)")
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub.setName("bots")
            .setDescription("Delete X messages from bots")
            .addIntegerOption(opt =>
              opt.setName("count")
                .setDescription("Number of messages to delete (max 100)")
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub.setName("contains")
            .setDescription("Delete X messages containing a keyword")
            .addStringOption(opt =>
              opt.setName("keyword")
                .setDescription("Keyword to search for")
                .setRequired(true)
            )
            .addIntegerOption(opt =>
              opt.setName("count")
                .setDescription("Number of messages to delete (max 100)")
                .setRequired(true)
            )
        );
    })
    // Handler
    .onExecute(dsl.withTryCatch(async (interaction, _args) => {
      const sub = interaction.options.getSubcommand();
      const channel = interaction.channel;
      if (!channel || !channel.isTextBased()) {
        await interaction.reply({ embeds: [embed.error({ title: "Not a text channel." })], ephemeral: true });
        return;
      }
      switch (sub) {
        case "all": {
          // Confirm before deleting
          const { message, dispose } = v2.ui.createConfirmationDialog(
            ctx, cleanupCmd, moduleName,
            "Are you sure you want to delete and recreate this channel? This cannot be undone.",
            async (i) => {
              // Save channel settings
              const perms = channel.permissionOverwrites.cache.map(po => po.toJSON());
              const name = channel.name;
              const type = channel.type;
              const topic = channel.topic;
              const position = channel.position;
              const parentId = channel.parentId ?? null;
              try {
                // Delete channel
                await channel.delete("Cleanup: recreate channel");
              } catch (err) {
                await i.reply({
                  embeds: [embed.error({ title: "Failed to delete channel.", description: err?.message || "This channel may be required for community servers or protected by Discord." })],
                  ephemeral: true
                });
                dispose();
                return;
              }
              // Recreate channel
              try {
                const newChannel = await channel.guild.channels.create({
                  name,
                  type,
                  topic,
                  permissionOverwrites: perms,
                  parent: parentId,
                  reason: "Cleanup: channel recreated"
                });
                // Move to original position if possible
                if (typeof position === "number" && newChannel.position !== position) {
                  await newChannel.setPosition(position);
                }
                await newChannel.send({ embeds: [embed.success({ title: `Channel recreated successfully.` })] });
              } catch (err) {
                // If recreation fails, send error to guild's system channel if available
                const systemChannel = channel.guild.systemChannel;
                if (systemChannel) {
                  await systemChannel.send({
                    embeds: [embed.error({ title: "Channel deleted, but failed to recreate.", description: err?.message || "An error occurred while recreating the channel." })]
                  });
                }
              }
              dispose();
            },
            async (i) => {
              await i.reply({ embeds: [embed.info({ title: "Cancelled." })], ephemeral: true });
              dispose();
            },
            { ephemeral: true }
          );
          await interaction.reply(message);
          break;
        }
        case "messages": {
          const count = interaction.options.getInteger("count");
          if (count < 1 || count > 100) {
            await interaction.reply({ embeds: [embed.error({ title: "Count must be 1-100." })], ephemeral: true });
            return;
          }
          const messages = await channel.messages.fetch({ limit: count });
          const toDelete = messages.filter(m => !m.pinned);
          await channel.bulkDelete(toDelete, true);
          await interaction.reply({ embeds: [embed.success({ title: `Deleted ${toDelete.size} messages.` })], ephemeral: true });
          break;
        }
        case "user": {
          const user = interaction.options.getUser("target");
          const count = interaction.options.getInteger("count");
          if (count < 1 || count > 100) {
            await interaction.reply({ embeds: [embed.error({ title: "Count must be 1-100." })], ephemeral: true });
            return;
          }
          const messages = await channel.messages.fetch({ limit: 100 });
          const toDelete = messages.filter(m => m.author.id === user.id && !m.pinned).first(count);
          await channel.bulkDelete(toDelete, true);
          await interaction.reply({ embeds: [embed.success({ title: `Deleted ${toDelete.length} messages from ${user.tag}.` })], ephemeral: true });
          break;
        }
        case "bots": {
          const count = interaction.options.getInteger("count");
          if (count < 1 || count > 100) {
            await interaction.reply({ embeds: [embed.error({ title: "Count must be 1-100." })], ephemeral: true });
            return;
          }
          const messages = await channel.messages.fetch({ limit: 100 });
          const toDelete = messages.filter(m => m.author.bot && !m.pinned).first(count);
          await channel.bulkDelete(toDelete, true);
          await interaction.reply({ embeds: [embed.success({ title: `Deleted ${toDelete.length} bot messages.` })], ephemeral: true });
          break;
        }
        case "contains": {
          const keyword = interaction.options.getString("keyword");
          const count = interaction.options.getInteger("count");
          if (count < 1 || count > 100) {
            await interaction.reply({ embeds: [embed.error({ title: "Count must be 1-100." })], ephemeral: true });
            return;
          }
          const messages = await channel.messages.fetch({ limit: 100 });
          const toDelete = messages.filter(m => m.content.includes(keyword) && !m.pinned).first(count);
          await channel.bulkDelete(toDelete, true);
          await interaction.reply({ embeds: [embed.success({ title: `Deleted ${toDelete.length} messages containing '${keyword}'.` })], ephemeral: true });
          break;
        }
        default:
          await interaction.reply({ embeds: [embed.error({ title: "Unknown subcommand." })], ephemeral: true });
      }
    }));

  // Register and manage lifecycle
  const disposeCmd = v2.register(cleanupCmd, moduleName);
  lifecycle.addDisposable(disposeCmd);

  //logger.info("Cleanup module loaded.");

  return {
    name: moduleName,
    description: "Bulk cleanup actions for channels and messages.",
    dispose: async () => {
      logger.info("Cleanup module unloaded.");
    }
  };
}

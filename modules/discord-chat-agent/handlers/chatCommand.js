import { PermissionsBitField, ChannelType } from "discord.js";
import { getGuildSettings, setGuildSettings, getAllGuildSettings } from "../services/guildSettingsService.js";
import { clearConversationHistory } from "../services/conversationService.js";

export function registerChatCommand(ctx) {
  const { v2, lifecycle, embed } = ctx;
  const moduleName = "discord-chat-agent";

  const cmd = v2.createInteractionCommand()
    .setName("chat")
    .setDescription("Commands for the AI chat agent.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addPrecondition(async (interaction) => {
      const has = interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
      return has ? true : "You need Administrator permission to use chat agent commands.";
    });

  cmd.addOption(root => { 
    root.addSubcommandGroup(group =>
      group.setName("config")
        .setDescription("Configure the AI chat agent for this server.")
        .addSubcommand(sub =>
          sub.setName("set")
            .setDescription("Set a configuration value.")
            .addStringOption(opt => 
              opt.setName("key").setDescription("Configuration key to set.").setRequired(true)
                .addChoices(
                  { name: "API Key", value: "apiKey" },
                  { name: "Base URL", value: "baseUrl" },
                  { name: "Model", value: "model" },
                  { name: "Temperature", value: "temperature" },
                  { name: "System Prompt", value: "systemPrompt" },
                  { name: "Active Channel", value: "activeChannel" },
                  { name: "History Limit", value: "historyLimit" }
                )
            )
            .addStringOption(opt => opt.setName("value").setDescription("Value to set.").setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName("get")
            .setDescription("Get a configuration value.")
            .addStringOption(opt => 
              opt.setName("key").setDescription("Configuration key to get.").setRequired(true)
                .addChoices(
                  { name: "API Key", value: "apiKey" },
                  { name: "Base URL", value: "baseUrl" },
                  { name: "Model", value: "model" },
                  { name: "Temperature", value: "temperature" },
                  { name: "System Prompt", value: "systemPrompt" },
                  { name: "Active Channel", value: "activeChannel" },
                  { name: "History Limit", value: "historyLimit" }
                )
            )
        )
        .addSubcommand(sub =>
          sub.setName("list")
            .setDescription("List all configuration values for this server.")
        )
    );
  });

  cmd.addOption(root => {
    root.addSubcommand(sub =>
      sub.setName("reset")
        .setDescription("Clear your conversation history with the AI agent in this channel.")
    );
  });

  cmd.onExecute(async (interaction) => {
    if (!interaction.guildId) {
      return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    }
    const group = interaction.options.getSubcommandGroup();
    const sub = interaction.options.getSubcommand();
    try {
      if (group === "config") {
        const key = interaction.options.getString("key");
        let value = interaction.options.getString("value");
        if (sub === "set") {
          switch (key) {
            case "temperature":
              value = parseFloat(value);
              if (isNaN(value) || value < 0 || value > 2) {
                return interaction.reply({ content: "Temperature must be between 0 and 2.", ephemeral: true });
              }
              break;
            case "historyLimit":
              value = parseInt(value, 10);
              if (isNaN(value) || value < 0) {
                return interaction.reply({ content: "History limit must be a non-negative integer.", ephemeral: true });
              }
              break;
            case "activeChannel":
              if (value.toLowerCase() === "none") {
                value = null;
              } else {
                const m = value.match(/^<#(\d+)>$/) || value.match(/^(\d+)$/);
                if (m) {
                  const ch = interaction.guild.channels.cache.get(m[1]);
                  if (!ch || ch.type !== ChannelType.GuildText) {
                    return interaction.reply({ content: "Invalid text channel.", ephemeral: true });
                  }
                  value = ch.id;
                } else {
                  return interaction.reply({ content: "Invalid channel mention or ID.", ephemeral: true });
                }
              }
              break;
            default:
          }
          await setGuildSettings(ctx, interaction.guildId, { [key]: value });
          return interaction.reply({ content: `Configuration ${key} set to ${value === null ? 'none' : value}.`, ephemeral: true });
        }
        if (sub === "get") {
          const settings = await getGuildSettings(ctx, interaction.guildId);
          const val = settings[key];
          if (val === undefined) {
            return interaction.reply({ content: `Key ${key} not found.`, ephemeral: true });
          }
          return interaction.reply({ content: `Current ${key}: ${val === null ? 'none' : val}.`, ephemeral: true });
        }
        if (sub === "list") {
          const all = await getAllGuildSettings(ctx, interaction.guildId);
          const fields = Object.entries(all).map(([k, v]) => ({ name: k, value: `\`${v === null ? 'none' : v}\``, inline: true }));
          const em = embed.neutral({ title: "AI Chat Agent Configuration", description: "Current settings:", fields });
          return interaction.reply({ embeds: [em], ephemeral: true });
        }
      }
      if (sub === "reset") {
        await clearConversationHistory(ctx, interaction.guildId, interaction.channelId, interaction.user.id);
        return interaction.reply({ content: "Conversation history cleared.", ephemeral: true });
      }
    } catch (err) {
      return interaction.reply({ content: `Error: ${err.message}`, ephemeral: true });
    }
  });

  const dispose = v2.register(cmd, moduleName);
  lifecycle.addDisposable(dispose);
  return dispose;
}

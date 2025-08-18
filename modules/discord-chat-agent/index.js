import { ensureIndexes as ensureGuildSettingsIndexes } from "./services/guildSettingsService.js";
import { ensureIndexes as ensureConversationIndexes } from "./services/conversationService.js";
import { registerChatCommand } from "./handlers/chatCommand.js";
import { registerMessageHandler } from "./handlers/messageHandler.js";

export default async function init(ctx) {
  const { logger, config, lifecycle } = ctx;
  const moduleName = "discord-chat-agent";

  if (!config.isEnabled("MODULE_DISCORD_CHAT_AGENT_ENABLED", true)) {
    logger.info(`[${moduleName}] Module disabled via config.`);
    return { name: moduleName, description: "Discord Chat Agent module (disabled)" };
  }

  const disposers = [];

  // Ensure MongoDB indexes for both services
  await ensureGuildSettingsIndexes(ctx);
  await ensureConversationIndexes(ctx);

  // Register slash command handler
  try {
    const disposeChatCommand = registerChatCommand(ctx);
    if (typeof disposeChatCommand === "function") disposers.push(disposeChatCommand);
  } catch (e) {
    logger.error(`[${moduleName}] Failed to register chat command`, { error: e?.message || e });
  }

  // Register message handler
  try {
    const disposeMessageHandler = registerMessageHandler(ctx);
    if (typeof disposeMessageHandler === "function") disposers.push(disposeMessageHandler);
  } catch (e) {
    logger.error(`[${moduleName}] Failed to register message handler`, { error: e?.message || e });
  }

  // Add all disposers to the lifecycle for proper cleanup
  lifecycle.addDisposable(() => {
    for (const d of disposers) {
      try { d?.(); } catch (e) { logger.warn(`[${moduleName}] Error during disposer cleanup`, { error: e?.message || e }); }
    }
  });

  //logger.info(`[${moduleName}] Module loaded.`);
  return {
    name: moduleName,
    description: "A highly customizable conversational AI agent for Discord.js bots.",
    dispose: async () => {
      logger.info(`[${moduleName}] Module unloaded.`);
      for (const d of disposers) {
        try { d?.(); } catch (e) { logger.warn(`[${moduleName}] Error during dispose cleanup`, { error: e?.message || e }); }
      }
    }
  };
}

import { getGuildSettings } from "../services/guildSettingsService.js";
import { getConversationHistory, addMessageToHistory } from "../services/conversationService.js";
import { callOpenAI } from "../services/aiService.js";

export function registerMessageHandler(ctx) {
  const { client, logger } = ctx;
  const moduleName = "discord-chat-agent";

  async function onMessageCreate(message) {
    // Ignore bot messages to prevent loops
    if (message.author.bot) return;
    // Ignore DMs for now, focus on guild channels
    if (!message.guildId) return;

    const guildId = message.guildId;
    const channelId = message.channel.id;
    const userId = message.author.id;

    const guildSettings = await getGuildSettings(ctx, guildId);
    const botId = client.user.id;

    let shouldTriggerAI = false;

    // 1. Direct Mention Interaction
    if (message.mentions.has(botId)) {
      shouldTriggerAI = true;
    }

    // 2. Reply to Bot's Message
    if (!shouldTriggerAI && message.reference?.messageId) {
      try {
        const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
        if (repliedMessage.author.id === botId) {
          shouldTriggerAI = true;
        }
      } catch (e) {
        logger.debug("[ChatAgent] Could not fetch replied message", { error: e.message });
      }
    }

    // 3. Dedicated AI Channel
    if (!shouldTriggerAI && guildSettings.activeChannel === channelId) {
      shouldTriggerAI = true;
    }

    if (!shouldTriggerAI) return;

    // Show typing indicator
    await message.channel.sendTyping();

    try {
      // Get conversation history
      let conversation = await getConversationHistory(ctx, guildId, channelId, userId, guildSettings.historyLimit);

      // Add system prompt if available and not already in history
      if (guildSettings.systemPrompt && !conversation.some(msg => msg.role === "system")) {
        conversation.unshift({ role: "system", content: guildSettings.systemPrompt });
      }

      // Add current user message to conversation
      conversation.push({ role: "user", content: message.content });

      // Call AI service
      const aiResponse = await callOpenAI(ctx, guildId, conversation);

      if (aiResponse) {
        // Add AI response to history
        await addMessageToHistory(ctx, guildId, channelId, userId, "user", message.content); // Store user's message
        await addMessageToHistory(ctx, guildId, channelId, userId, "assistant", aiResponse.content); // Store AI's response

        // Reply to the user
        if (aiResponse.file) {
          // Log file details for debugging
          logger.debug("[ChatAgent] Attempting to upload file", { file: aiResponse.file });

          try {
            await message.reply({
              content: aiResponse.content || "Here is the requested file:",
              files: [aiResponse.file],
            });
            logger.info("[ChatAgent] File uploaded successfully");
          } catch (uploadError) {
            logger.error("[ChatAgent] File upload failed", { error: uploadError.message });
            await message.reply("Failed to upload the file. Please try again later.");
          }
        } else if (aiResponse.content.length > 2000) {
          const splitMessage = (message, maxLength) => {
            const chunks = [];
            let currentChunk = "";
            for (const word of message.split(" ")) {
              if ((currentChunk + word).length + 1 > maxLength) {
                chunks.push(currentChunk.trim());
                currentChunk = word + " ";
              } else {
                currentChunk += word + " ";
              }
            }
            if (currentChunk.trim()) chunks.push(currentChunk.trim());
            return chunks;
          };

          const chunks = splitMessage(aiResponse.content, 2000);
          for (const chunk of chunks) {
            await message.reply(chunk);
          }
        } else {
          await message.reply(aiResponse.content);
        }
      } else {
        await message.reply("Sorry, I couldn't get a response from the AI at the moment. Please check the configuration or try again later.");
      }
    } catch (e) {
      logger.error("[ChatAgent] Error processing message for AI", { error: e.message, guildId, channelId, userId });
      await message.reply("An unexpected error occurred while trying to get an AI response.");
    }

    // Check for file attachments in the user's message
    if (message.attachments.size > 0) {
      const attachments = Array.from(message.attachments.values());
      const fileUrls = attachments.map(attachment => attachment.url);

      logger.debug("[ChatAgent] User uploaded files", { files: fileUrls });

      try {
        // Get conversation history
        let conversation = await getConversationHistory(ctx, guildId, channelId, userId, guildSettings.historyLimit);

        // Add system prompt if available and not already in history
        if (guildSettings.systemPrompt && !conversation.some(msg => msg.role === "system")) {
          conversation.unshift({ role: "system", content: guildSettings.systemPrompt });
        }

        // Log file URLs for debugging
        logger.debug("[ChatAgent] Validating file URLs", { fileUrls });

        // Ensure file URLs are valid before passing to AI service
        const validFileUrls = fileUrls.filter(url => url.startsWith("https://"));

        if (validFileUrls.length === 0) {
          await message.reply("I couldn't process the uploaded files because they are not accessible.");
          return;
        }

        // Add file upload information to the conversation
        const aiResponse = await callOpenAI(ctx, guildId, [
          ...conversation,
          { role: "user", content: `User uploaded files: ${validFileUrls.join(", ")}` },
        ]);

        if (aiResponse) {
          await message.reply(aiResponse.content || "Files received and processed.");
        } else {
          await message.reply("Sorry, I couldn't process the uploaded files at the moment.");
        }
      } catch (e) {
        logger.error("[ChatAgent] Error processing uploaded files", { error: e.message });
        await message.reply("An error occurred while processing your files. Please try again later.");
      }

      return; // Exit early since the file upload is handled
    }
  }

  client.on("messageCreate", onMessageCreate);

  // Return disposer function
  return () => {
    client.off("messageCreate", onMessageCreate);
  };
}

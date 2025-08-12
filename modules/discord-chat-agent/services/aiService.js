import { getGuildSettings } from "./guildSettingsService.js";

/**
 * Calls the OpenAI-compatible API endpoint.
 * @param {object} ctx - The module context.
 * @param {string} guildId - The ID of the guild.
 * @param {Array<object>} messages - The conversation messages in OpenAI format.
 * @returns {Promise<object|null>} - The AI's response content or null if an error occurs.
 */
export async function callOpenAI(ctx, guildId, messages) {
  const { http, config, logger } = ctx;

  const guildSettings = await getGuildSettings(ctx, guildId);

  const apiKey = guildSettings.apiKey || config.get("OPENAI_API_KEY");
  const baseUrl = guildSettings.baseUrl || config.get("OPENAI_API_BASE_URL");
  const model = guildSettings.model;
  const temperature = guildSettings.temperature;

  if (!apiKey || !baseUrl) {
    logger.warn("[ChatAgent] AI Service: Missing API Key or Base URL for guild", { guildId });
    return null;
  }

  const url = `${baseUrl}/chat/completions`;
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };
  const body = {
    model: model,
    messages: messages,
    temperature: temperature,
  };

  try {
    const res = await http.post(url, body, { headers, timeoutMs: 30000 });

    if (!res.ok) {
      logger.error("[ChatAgent] AI Service: API call failed", {
        status: res.status,
        data: res.data,
        guildId,
      });
      return null;
    }

    const response = res.data.choices[0].message;
    return {
      content: response.content,
      file: response.file || null, // Check if the response includes a file
    };
  } catch (e) {
    logger.error("[ChatAgent] AI Service: Exception during API call", { error: e?.message || e, guildId });
    return null;
  }
}

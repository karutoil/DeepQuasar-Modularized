// Transcript generation (HTML and plain text) and upload to log channel or CDN
import { AttachmentBuilder } from "discord.js";
import { getGuildSettings } from "./settingsService.js";
import discordHtmlTranscripts from "discord-html-transcripts";

/**
 * Generate a transcript of the channel and upload it to the configured log channel.
 * Returns { url, format } when successful, or null on failure.
 * Uses discord-html-transcripts for all transcript generation.
 */
export async function generateTranscriptAndUpload(ctx, guildId, channelId, { format } = {}) {
  const { client, logger } = ctx;
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) return null;

    const settings = await getGuildSettings(ctx, guildId);
    const fmt = (format || settings?.transcript?.format || "html").toLowerCase() === "text" ? "text" : "html";

    // Use discord-html-transcripts to generate transcript
    let attachment;
    if (fmt === "html") {
      attachment = await discordHtmlTranscripts.createTranscript(channel, {
        limit: 5000,
        filename: `transcript-${channel.id}-${Date.now()}.html`,
        saveImages: false,
      });
    } else {
      // Generate HTML transcript, convert to plain text, and wrap as AttachmentBuilder
      const htmlBuffer = await discordHtmlTranscripts.createTranscript(channel, {
        limit: 5000,
        filename: `transcript-${channel.id}-${Date.now()}.html`,
        saveImages: false,
        returnBuffer: true,
      });
      let html;
      if (Array.isArray(htmlBuffer)) {
        html = htmlBuffer.map(b => b.toString("utf8")).join("");
      } else if (Buffer.isBuffer(htmlBuffer)) {
        html = htmlBuffer.toString("utf8");
      } else if (htmlBuffer && typeof htmlBuffer === "object" && htmlBuffer.buffer) {
        html = htmlBuffer.buffer.toString("utf8");
      } else if (typeof htmlBuffer === "string") {
        html = htmlBuffer;
      } else {
        logger.warn("[Tickets] transcript conversion failed: unexpected transcriptBuffer type", { type: typeof htmlBuffer });
        html = "";
      }
      const text = html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      const textBuffer = Buffer.from(text, "utf8");
      attachment = new AttachmentBuilder(textBuffer).setName(`transcript-${channel.id}-${Date.now()}.txt`);
    }

    // Upload to the log channel to obtain a URL
    const logChannelId = settings.ticketLogChannelId;
    const logChan = logChannelId ? await client.channels.fetch(logChannelId).catch(() => null) : null;
    if (!logChan || !logChan.send) {
      logger.warn("[Tickets] No valid ticket log channel configured; returning attachment-less result");
      return { url: null, format: fmt };
    }
    const sent = await logChan.send({ content: `Transcript for #${channel.name} (${channel.id})`, files: [attachment] });
    const file = sent.attachments.first();
    const url = file?.url || null;

    return { url, format: fmt };
  } catch (e) {
    logger.warn("[Tickets] transcript generation failed", { error: e?.message });
    return null;
  }
}


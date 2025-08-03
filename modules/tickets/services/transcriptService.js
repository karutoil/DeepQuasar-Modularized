// Transcript generation (HTML and plain text) and upload to log channel or CDN
import { AttachmentBuilder } from "discord.js";
import { getGuildSettings } from "./settingsService.js";

/**
 * Generate a transcript of the channel and upload it to the configured log channel.
 * Returns { url, format } when successful, or null on failure.
 */
export async function generateTranscriptAndUpload(ctx, guildId, channelId, { format } = {}) {
  const { client, logger } = ctx;

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.messages) return null;

    const settings = await getGuildSettings(ctx, guildId);
    const fmt = (format || settings?.transcript?.format || "html").toLowerCase() === "text" ? "text" : "html";

    // Fetch recent message history (Discord limits apply)
    const msgs = await fetchAllMessages(channel);

    const content = fmt === "html"
      ? renderHtmlTranscript(channel, msgs)
      : renderTextTranscript(channel, msgs);

    const fileName = `transcript-${channel.id}-${Date.now()}.${fmt === "html" ? "html" : "txt"}`;
    const attachment = new AttachmentBuilder(Buffer.from(content, "utf8"), { name: fileName });

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

async function fetchAllMessages(channel, limit = 5000) {
  const out = [];
  let lastId = undefined;
  while (out.length < limit) {
    const batch = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
    if (!batch || batch.size === 0) break;
    for (const m of batch.values()) out.push(m);
    lastId = out[out.length - 1]?.id;
    if (batch.size < 100) break;
  }
  // Chronological
  out.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return out;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&")
    .replaceAll("<", "<")
    .replaceAll(">", ">");
}

function renderHtmlTranscript(channel, messages) {
  const header = `<Transcript for #${escapeHtml(channel.name)} (${channel.id})>`;
  const body = messages.map((m) => {
    const ts = new Date(m.createdTimestamp || Date.now()).toISOString();
    const author = escapeHtml(m.author?.tag || m.author?.username || m.author?.id || "Unknown");
    const content = escapeHtml(m.content || "");
    const attachments = Array.from(m.attachments?.values?.() || []).map(a => `<div class="att">Attachment: <a href="${escapeHtml(a.url)}">${escapeHtml(a.name || a.url)}</a></div>`).join("");
    return `<div class="msg"><span class="ts">${ts}</span> <span class="author">${author}</span>: <span class="content">${content}</span>${attachments}</div>`;
  }).join("\n");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Transcript #${escapeHtml(channel.name)} (${channel.id})</title>
<style>
body { font-family: Inter, Arial, sans-serif; background: #0f1113; color: #e5e7eb; padding: 16px; }
.msg { margin: 6px 0; }
.ts { color: #9ca3af; margin-right: 6px; }
.author { color: #93c5fd; margin-right: 6px; }
.content { white-space: pre-wrap; }
.att a { color: #a7f3d0; }
</style>
</head>
<body>
<h2>${header}</h2>
${body}
</body>
</html>`;
}

function renderTextTranscript(channel, messages) {
  const lines = [`Transcript for #${channel.name} (${channel.id})`];
  for (const m of messages) {
    const ts = new Date(m.createdTimestamp || Date.now()).toISOString();
    const author = m.author?.tag || m.author?.username || m.author?.id || "Unknown";
    let line = `[${ts}] ${author}: ${m.content || ""}`;
    const atts = Array.from(m.attachments?.values?.() || []);
    for (const a of atts) {
      line += `\n  Attachment: ${a.url}`;
    }
    lines.push(line);
  }
  return lines.join("\n");
}
/**
 * preview.js
 * Builds a safe Discord embed JSON from a draft for live preview.
 * Delegates strict validation to utils/schema.validate when needed.
 */

export function toDiscordEmbed(draft) {
  const d = sanitizeDraft(draft);

  let embed = {};
  if (d.title) embed.title = d.title;
  if (d.description !== undefined) embed.description = d.description; // keep empty string if present
  if (d.url) embed.url = d.url;
  if (typeof d.color === "number") embed.color = d.color;
  if (d.thumbnail) embed.thumbnail = { url: d.thumbnail };
  if (d.image) embed.image = { url: d.image };
  if (d.footerText || d.footerIcon) embed.footer = { text: d.footerText || "", icon_url: d.footerIcon || undefined };
  if (d.authorName || d.authorIcon || d.authorUrl) embed.author = { name: d.authorName || "", icon_url: d.authorIcon || undefined, url: d.authorUrl || undefined };
  if (d.fields?.length) embed.fields = d.fields.map(f => ({ name: f.name, value: f.value, inline: !!f.inline }));

  // Final safeguard: if embed has no textual content, set minimal non-empty description
  const titleEmpty = !embed.title || String(embed.title).length === 0;
  const descEmpty = !embed.description || String(embed.description).length === 0;
  if (titleEmpty && descEmpty) {
    embed.description = ".";
  }

  return embed;
}

function sanitizeDraft(d) {
  const LIMITS = {
    title: 256,
    description: 4096,
    fields: 25,
    fieldName: 256,
    fieldValue: 1024,
    footerText: 2048,
    authorName: 256
  };

  // Do NOT trim description to allow a single space—however Discord may still reject empty; we'll set "." later.
  return {
    title: String(d?.title ?? "").trim().slice(0, LIMITS.title),
    description: String(d?.description ?? "").slice(0, LIMITS.description),
    color: clampColor(d?.color),
    url: sanitizeUrl(d?.url),
    thumbnail: sanitizeUrl(d?.thumbnail),
    image: sanitizeUrl(d?.image),
    footerText: String(d?.footerText ?? "").trim().slice(0, LIMITS.footerText),
    footerIcon: sanitizeUrl(d?.footerIcon),
    authorName: String(d?.authorName ?? "").trim().slice(0, LIMITS.authorName),
    authorIcon: sanitizeUrl(d?.authorIcon),
    authorUrl: sanitizeUrl(d?.authorUrl),
    fields: Array.isArray(d?.fields) ? d.fields.slice(0, LIMITS.fields).map(f => ({
      name: String(f?.name ?? "").slice(0, LIMITS.fieldName),
      value: String(f?.value ?? "").slice(0, LIMITS.fieldValue),
      inline: !!f?.inline
    })) : []
  };
}

function sanitizeUrl(u) {
  const s = String(u ?? "").trim();
  if (!s) return "";
  try {
    const url = new URL(s.startsWith("http") ? s : ("https://" + s));
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function clampColor(n) {
  if (n == null) return null;
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(0xFFFFFF, Math.floor(x)));
}
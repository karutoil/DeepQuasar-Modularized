/**
 * Validation and normalization for Discord embed payloads.
 * Enforces Discord limits and returns a sanitized embed JSON ready for API.
 */

const LIMITS = {
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footerText: 2048,
  authorName: 256,
  totalChars: 6000
};

/**
 * Validate a draft object and return { ok, error?, embed }
 * The returned embed is API-compatible (Discord JSON shape).
 */
export function validate(draft) {
  const d = normalizeDraftCopy(draft);

  const counts = {
    title: d.title.length,
    description: d.description.length,
    footer: d.footerText.length,
    author: d.authorName.length,
    fields: (d.fields || []).reduce((acc, f) => acc + f.name.length + f.value.length, 0)
  };
  const total = counts.title + counts.description + counts.footer + counts.author + counts.fields;
  if (total > LIMITS.totalChars) {
    return { ok: false, error: `Total characters exceed ${LIMITS.totalChars} (=${total}).` };
  }
  if (d.title.length > LIMITS.title) return { ok: false, error: `Title exceeds ${LIMITS.title}.` };
  if (d.description.length > LIMITS.description) return { ok: false, error: `Description exceeds ${LIMITS.description}.` };
  if (d.fields.length > LIMITS.fields) return { ok: false, error: `Too many fields (max ${LIMITS.fields}).` };
  for (const f of d.fields) {
    if (f.name.length > LIMITS.fieldName) return { ok: false, error: `A field name exceeds ${LIMITS.fieldName}.` };
    if (f.value.length > LIMITS.fieldValue) return { ok: false, error: `A field value exceeds ${LIMITS.fieldValue}.` };
  }
  if (d.footerText.length > LIMITS.footerText) return { ok: false, error: `Footer text exceeds ${LIMITS.footerText}.` };
  if (d.authorName.length > LIMITS.authorName) return { ok: false, error: `Author name exceeds ${LIMITS.authorName}.` };

  // Build API embed
  const embed = {};
  if (d.title) embed.title = d.title;
  if (d.description) embed.description = d.description;
  if (d.url) embed.url = d.url;
  if (typeof d.color === "number") embed.color = d.color;
  if (d.thumbnail) embed.thumbnail = { url: d.thumbnail };
  if (d.image) embed.image = { url: d.image };
  if (d.footerText || d.footerIcon) embed.footer = { text: d.footerText || "", icon_url: d.footerIcon || undefined };
  if (d.authorName || d.authorIcon || d.authorUrl) embed.author = { name: d.authorName || "", icon_url: d.authorIcon || undefined, url: d.authorUrl || undefined };
  if (d.fields?.length) embed.fields = d.fields.map(f => ({ name: f.name, value: f.value, inline: !!f.inline }));

  return { ok: true, embed };
}

function normalizeDraftCopy(d) {
  const out = {
    title: String(d?.title ?? "").trim().slice(0, LIMITS.title),
    description: String(d?.description ?? "").trim().slice(0, LIMITS.description),
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
  return out;
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
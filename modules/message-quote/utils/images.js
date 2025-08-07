/**
 * Image extraction utilities:
 * - Prefer first image attachment (contentType starts with image/)
 * - Else, find first image URL in the content via regex
 */

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "svg"];
const IMG_URL_REGEX = new RegExp(
  String.raw`https?:\/\/[^\s)]+?\.(?:${IMAGE_EXT.join("|")})(?:\?[^\s)]*)?`,
  "i"
);

/**
 * Extract first image URL from a Discord.js Message.
 * @param {import('discord.js').Message} message
 * @returns {string|undefined}
 */
export function extractFirstImage(message) {
  try {
    // Attachments first
    const attachments = Array.from(message.attachments?.values?.() ?? []);
    for (const a of attachments) {
      const ct = a.contentType ?? "";
      if (typeof ct === "string" && ct.toLowerCase().startsWith("image/")) {
        return a.url;
      }
      // Fallback by file extension
      const url = a.url || a.proxyURL;
      if (url && isImageUrl(url)) return url;
    }

    // Then content URLs
    const content = message.content || "";
    const match = IMG_URL_REGEX.exec(content);
    if (match) return match[0];

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Basic image URL extension check.
 * @param {string} url
 */
export function isImageUrl(url) {
  try {
    const u = new URL(url);
    const pathname = u.pathname.toLowerCase();
    return IMAGE_EXT.some((ext) => pathname.endsWith("." + ext));
  } catch {
    return false;
  }
}
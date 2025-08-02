// TrackFactory: normalize Moonlink/Lavalink track objects into a consistent shape
// Ensures all handlers access fields uniformly and attach requester attribution.

export function normalizeTrack(raw, { requesterId = null } = {}) {
  if (!raw || typeof raw !== "object") return null;

  // Prefer top-level props then fall back to .info where applicable
  const info = raw.info || {};
  const title = sanitizeString(raw.title ?? info.title ?? "Unknown");
  const author = sanitizeString(raw.author ?? info.author ?? "Unknown");
  const uri = sanitizeString(raw.uri ?? raw.url ?? info.uri ?? info.url ?? "");
  const artwork =
    sanitizeString(
      raw.thumbnail ??
      raw.artworkUrl ??
      info.artworkUrl ??
      (info?.thumbnail && typeof info.thumbnail === "string" ? info.thumbnail : "")
    ) || null;

  const length = toNumber(raw.length ?? info.length ?? 0);
  const identifier = sanitizeString(raw.identifier ?? info.identifier ?? extractIdFromUri(uri));

  return {
    id: identifier || generatePseudoId(title, author, uri),
    source: detectSource(uri),
    title,
    author,
    uri,
    artwork,
    length: Number.isFinite(length) && length >= 0 ? length : 0,
    requesterId: requesterId || null,
    requestedAt: new Date().toISOString(),
    // retain original for library operations if needed
    _raw: raw,
  };
}

export function normalizeTracks(list, opts = {}) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const t of list) {
    const n = normalizeTrack(t, opts);
    if (n) out.push(n);
  }
  return out;
}

// Helpers

function sanitizeString(v) {
  if (v == null) return "";
  try { return String(v); } catch { return ""; }
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function extractIdFromUri(uri) {
  try {
    if (!uri) return "";
    const u = new URL(uri);
    // Basic YouTube patterns
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      // youtube.com/shorts/{id}
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "shorts" && parts[1]) return parts[1];
    }
    if (u.hostname === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id) return id;
    }
    return uri;
  } catch {
    return sanitizeString(uri);
  }
}

function detectSource(uri) {
  const u = sanitizeString(uri).toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("spotify.com")) return "spotify";
  if (u.includes("soundcloud.com")) return "soundcloud";
  if (u.includes("apple.com")) return "apple";
  if (u.startsWith("ytsearch:")) return "ytsearch";
  if (u.startsWith("scsearch:")) return "scsearch";
  if (u.startsWith("ytrec:")) return "ytrec";
  return "unknown";
}

function generatePseudoId(title, author, uri) {
  const basis = `${title}::${author}::${uri}`.slice(0, 256);
  let hash = 0;
  for (let i = 0; i < basis.length; i++) {
    const chr = basis.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return `t_${Math.abs(hash)}`;
}
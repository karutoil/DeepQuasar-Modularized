/**
 * Consistent customId generator and parser for interactions.
 * Shape: module:type:name[:kv1=val1][:kv2=val2]...
 */
export function createIds() {
  function make(moduleName, type, name, extras = {}) {
    const parts = [`${moduleName}:${type}:${name}`];
    for (const [k, v] of Object.entries(extras)) {
      if (v === undefined || v === null) continue;
      const val = String(v).replace(/[:=]/g, "_");
      parts.push(`${k}=${val}`);
    }
    // Discord customId max length is 100
    return parts.join(":").slice(0, 100);
  }

  function parse(customId) {
    const segments = String(customId || "").split(":");
    if (segments.length < 3) return { module: "", type: "", name: "", extras: {} };
    const [moduleName, type, name, ...kv] = segments;
    const extras = {};
    for (const pair of kv) {
      const idx = pair.indexOf("=");
      if (idx > 0) {
        const k = pair.slice(0, idx);
        const v = pair.slice(idx + 1);
        extras[k] = v;
      }
    }
    return { module: moduleName, type, name, extras };
  }

  return { make, parse };
}
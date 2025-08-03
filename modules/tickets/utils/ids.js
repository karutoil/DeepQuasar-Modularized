// Consistent customId namespaces and parsing for Tickets module
// Pattern: tickets:{scope}:{action}:{kvpairs}
// Example: tickets:setup:general
// Example: tickets:panel:create
// Example: tickets:control:close:ticketId=abc123
// Example: tickets:type:edit:typeId=bug

const NS = "tickets";

function encodeKV(obj = {}) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join("&");
}

function decodeKV(s = "") {
  const out = {};
  if (!s) return out;
  for (const seg of s.split("&")) {
    const [k, v] = seg.split("=");
    if (!k) continue;
    out[decodeURIComponent(k)] = v != null ? decodeURIComponent(v) : "";
  }
  return out;
}

export function makeId(scope, action, kv = {}) {
  const base = [NS, scope, action].join(":");
  const tail = encodeKV(kv);
  return tail ? `${base}:${tail}` : base;
}

export function parseId(customId = "") {
  const parts = customId.split(":");
  if (parts[0] !== NS) return null;
  const [, scope, action, tail] = parts;
  return { ns: NS, scope, action, data: decodeKV(tail || "") };
}

// Common factories
export const SetupIds = {
  General: () => makeId("setup", "general"),
  Panels: () => makeId("setup", "panels"),
  Types: () => makeId("setup", "types"),
};

export const PanelIds = {
  Create: () => makeId("panel", "create"),
  Edit: (panelId) => makeId("panel", "edit", { panelId }),
  Delete: (panelId) => makeId("panel", "delete", { panelId }),
  PublishTo: (panelId) => makeId("panel", "publishTo", { panelId }),
};

export const TypeIds = {
  Create: () => makeId("type", "create"),
  Edit: (typeId) => makeId("type", "edit", { typeId }),
  Delete: (typeId) => makeId("type", "delete", { typeId }),
};

export const ControlIds = {
  Close: (ticketId) => makeId("control", "close", { ticketId }),
  AddUser: (ticketId) => makeId("control", "addUser", { ticketId }),
  RemoveUser: (ticketId) => makeId("control", "removeUser", { ticketId }),
  Lock: (ticketId) => makeId("control", "lock", { ticketId }),
  Unlock: (ticketId) => makeId("control", "unlock", { ticketId }),
  Rename: (ticketId) => makeId("control", "rename", { ticketId }),
  Transcript: (ticketId) => makeId("control", "transcript", { ticketId }),
  Transfer: (ticketId) => makeId("control", "transfer", { ticketId }),
  Reopen: (ticketId) => makeId("control", "reopen", { ticketId }),
};

// Prefixes for dynamic routing support via core/interactions prefix mode
export const Prefix = {
  AnyControl: "tickets:control:",
  AnyPanel: "tickets:panel:",
  AnyType: "tickets:type:",
  AnySetup: "tickets:setup:",
};
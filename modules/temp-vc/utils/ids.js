/**
 * CustomId and command namespacing for TempVC module.
 */
export const ids = {
  module: "tempvc",
  admin: {
    // Page navigation
    page: {
      general: "tempvc:admin:page:general",
      timeouts: "tempvc:admin:page:timeouts",
      limits: "tempvc:admin:page:limits",
      logging: "tempvc:admin:page:logging",
      templates: "tempvc:admin:page:templates",
    },
    // Toggles
    toggle: {
      enabled: "tempvc:admin:toggle:enabled",
      autoShard: "tempvc:admin:toggle:autoShard",
      deleteAfterOwnerLeaves: "tempvc:admin:toggle:deleteAfterOwnerLeaves",
      eventLoggingEnabled: "tempvc:admin:toggle:eventLoggingEnabled",
      ownerTransferEnabled: "tempvc:admin:toggle:ownerTransferEnabled",
    },
    // Selects
    select: {
      triggers: "tempvc:admin:select:triggers",
      baseCategory: "tempvc:admin:select:baseCategory",
      modlog: "tempvc:admin:select:modlog",
      roleCreators: "tempvc:admin:select:roleCreators",
      roleAdminBypass: "tempvc:admin:select:roleAdminBypass",
    },
    // Modal prefix for all inputs
    modalPrefix: "tempvc:admin:modal:", // e.g., tempvc:admin:modal:namingPattern
  },
  ui: {
    // Legacy stub
    panelPrefix: "tempvc:ui:",

    // Panel component prefixes (all include channelId as the last segment)
    selectPrefix: "tempvc:sel:",         // e.g. tempvc:sel:privacy:{channelId}
    userSelectPrefix: "tempvc:usr:",     // e.g. tempvc:usr:kick:{channelId}
    buttonPrefix: "tempvc:btn:",         // e.g. tempvc:btn:rename:{channelId}
    modalPrefix: "tempvc:modal:",        // e.g. tempvc:modal:rename:{channelId}

    // Concrete action ids (suffix after the prefix)
    select: {
      privacy: "privacy",
      limit: "limit",
      bitrate: "bitrate",
      region: "region",
      transfer: "transfer",
    },
    user: {
      kick: "kick",
      ban: "ban",
    },
    button: {
      rename: "rename",
      delete: "delete",
    },
    modal: {
      rename: "rename",
    },
  },
};

/**
 * Helpers to build dynamic ids if needed later.
 */
export function makeId(...parts) {
  return parts.join(":");
}
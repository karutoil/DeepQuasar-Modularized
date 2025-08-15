/**
 * Unified interaction registries and dispatcher.
 * Supports: buttons, select menus, modals, user/message context menus.
 * v2 enhancement: optional prefix-based lookup to support scoped customIds.
 */
import {
  InteractionType,
  ComponentType,
} from "discord.js";

export function createInteractions(client, logger) {
  // Registries keyed by module for cleanup
  const buttonsByModule = new Map(); // module -> Map(customId -> handler)
  const selectsByModule = new Map(); // module -> Map(customId -> handler)
  const modalsByModule = new Map();  // module -> Map(customId -> handler)
  const userCtxByModule = new Map(); // module -> Map(commandName -> handler)
  const msgCtxByModule = new Map();  // module -> Map(commandName -> handler)

  // v2: allow prefix registrations for dynamic customIds (e.g., extras appended)
  const buttonPrefixesByModule = new Map(); // module -> Map(prefix -> handler)
  const selectPrefixesByModule = new Map(); // module -> Map(prefix -> handler)
  const modalPrefixesByModule = new Map();  // module -> Map(prefix -> handler)

  // Convenience accessors
  const ensure = (map, moduleName) => {
    let inner = map.get(moduleName);
    if (!inner) { inner = new Map(); map.set(moduleName, inner); }
    return inner;
  };

  function registerButton(moduleName, customId, handler, { prefix = false } = {}) {
    if (prefix) {
      const map = ensure(buttonPrefixesByModule, moduleName);
      map.set(customId, handler);
      return () => map.delete(customId);
    }
    const map = ensure(buttonsByModule, moduleName);
    map.set(customId, handler);
    return () => map.delete(customId);
  }

  function registerSelect(moduleName, customId, handler, { prefix = false } = {}) {
    if (prefix) {
      const map = ensure(selectPrefixesByModule, moduleName);
      map.set(customId, handler);
      return () => map.delete(customId);
    }
    const map = ensure(selectsByModule, moduleName);
    map.set(customId, handler);
    return () => map.delete(customId);
  }

  function registerModal(moduleName, customId, handler, { prefix = false } = {}) {
    if (prefix) {
      const map = ensure(modalPrefixesByModule, moduleName);
      map.set(customId, handler);
      return () => map.delete(customId);
    }
    const map = ensure(modalsByModule, moduleName);
    map.set(customId, handler);
    return () => map.delete(customId);
  }

  function registerUserContext(moduleName, commandName, handler) {
    const map = ensure(userCtxByModule, moduleName);
    map.set(commandName, handler);
    return () => map.delete(commandName);
  }

  function registerMessageContext(moduleName, commandName, handler) {
    const map = ensure(msgCtxByModule, moduleName);
    map.set(commandName, handler);
    return () => map.delete(commandName);
  }

  function removeModule(moduleName) {
    buttonsByModule.delete(moduleName);
    selectsByModule.delete(moduleName);
    modalsByModule.delete(moduleName);
    userCtxByModule.delete(moduleName);
    msgCtxByModule.delete(moduleName);
    buttonPrefixesByModule.delete(moduleName);
    selectPrefixesByModule.delete(moduleName);
    modalPrefixesByModule.delete(moduleName);
  }

  function findByExactOrPrefix(id, maps, prefixMaps) {
    for (const map of maps.values()) {
      const h = map.get(id);
      if (h) return h;
    }
    // prefix scan: try each registered prefix across modules
    for (const pmap of prefixMaps.values()) {
      for (const [prefix, h] of pmap.entries()) {
        if (id.startsWith(prefix)) return h;
      }
    }
    return null;
  }

  async function dispatch(interaction) {
    try {
      // Context menus (user/message)
      if (interaction.isContextMenuCommand?.()) {
        const name = interaction.commandName;
        if (interaction.isUserContextMenuCommand?.()) {
          for (const map of userCtxByModule.values()) {
            const h = map.get(name);
            if (h) return await h(interaction);
          }
        } else if (interaction.isMessageContextMenuCommand?.()) {
          for (const map of msgCtxByModule.values()) {
            const h = map.get(name);
            if (h) return await h(interaction);
          }
        }
        return;
      }

      // Buttons
      if (interaction.isButton?.()) {
        const id = interaction.customId;
        let foundModule = null;
        let foundHandler = null;
        for (const [mod, map] of buttonsByModule.entries()) {
          if (map.has(id)) {
            foundModule = mod;
            foundHandler = map.get(id);
            break;
          }
        }
        logger.debug("[Core] Button dispatch", {
          customId: id,
          foundModule,
          handlerExists: !!foundHandler,
          allModules: Array.from(buttonsByModule.keys())
        });
        const h = findByExactOrPrefix(id, buttonsByModule, buttonPrefixesByModule);
        if (h) return await h(interaction);
        return;
      }

      // User/member select menu (componentType: 5)
      if ((typeof interaction.isUserSelectMenu === "function" && interaction.isUserSelectMenu()) || interaction.componentType === 5) {
        logger.debug("[Core] UserSelectMenu dispatch", {
          customId: interaction.customId,
          componentType: interaction.componentType,
          isUserSelectMenu: typeof interaction.isUserSelectMenu === "function" ? interaction.isUserSelectMenu() : undefined,
          isAnySelectMenu: typeof interaction.isAnySelectMenu === "function" ? interaction.isAnySelectMenu() : undefined,
          values: interaction.values,
          type: interaction.type
        });
        let id = interaction.customId;
        // Remap our builder "usel" ids to the same handler registered for "sel" when an exact match is not found.
        let h = findByExactOrPrefix(id, selectsByModule, selectPrefixesByModule);
        if (!h && id.includes(":usel:")) {
          const remap = id.replace(":usel:", ":sel:");
          if (remap !== id) {
            h = findByExactOrPrefix(remap, selectsByModule, selectPrefixesByModule);
          }
        }
        logger.debug("[Core] About to call handler for select menu", { customId: interaction.customId, handlerExists: !!h });
        if (h) return await h(interaction);
        return;
      }

      // ChannelSelectMenu (componentType: 8)
      if (interaction.componentType === 8) {
        logger.debug("[Core] ChannelSelectMenu dispatch", {
          customId: interaction.customId,
          componentType: interaction.componentType,
          isAnySelectMenu: typeof interaction.isAnySelectMenu === "function" ? interaction.isAnySelectMenu() : undefined,
          values: interaction.values,
          type: interaction.type
        });
        const id = interaction.customId;
        const h = findByExactOrPrefix(id, selectsByModule, selectPrefixesByModule);
        logger.debug("[Core] About to call handler for select menu", { customId: interaction.customId, handlerExists: !!h });
        if (h) return await h(interaction);
        return;
      }

      // Other select menus (string, role, mentionable)
      if (interaction.isAnySelectMenu?.()) {
        const id = interaction.customId;
        const h = findByExactOrPrefix(id, selectsByModule, selectPrefixesByModule);
        logger.debug("[Core] About to call handler for select menu", { customId: interaction.customId, handlerExists: !!h });
        if (h) return await h(interaction);
        return;
      }

      // Modals
      if (interaction.type === InteractionType.ModalSubmit) {
        const id = interaction.customId;
        const h = findByExactOrPrefix(id, modalsByModule, modalPrefixesByModule);
        if (h) return await h(interaction);
        return;
      }
    } catch (err) {
      logger.error(`Interaction dispatch error: ${err?.message}`, { stack: err?.stack });
      try {
        if (interaction.isRepliable?.() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "An error occurred while handling this interaction.", ephemeral: true });
        }
      } catch (err) { void err; }
    }
  }

  // Wire a single dispatcher once
  client.on("interactionCreate", async (interaction) => {
    await dispatch(interaction);
  });

  return {
    registerButton,
    registerSelect,
    registerSelectMenu: registerSelect,
    registerModal,
    registerUserContext,
    registerMessageContext,
    removeModule,
    _debug: {
      buttonsByModule,
      selectsByModule,
      modalsByModule,
      userCtxByModule,
      msgCtxByModule,
    }
  };
}
/**
 * Unified interaction registries and dispatcher.
 * Supports: buttons, select menus, modals, user/message context menus.
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

  // Convenience accessors
  const ensure = (map, moduleName) => {
    let inner = map.get(moduleName);
    if (!inner) { inner = new Map(); map.set(moduleName, inner); }
    return inner;
  };

  function registerButton(moduleName, customId, handler) {
    const map = ensure(buttonsByModule, moduleName);
    map.set(customId, handler);
    return () => map.delete(customId);
  }

  function registerSelect(moduleName, customId, handler) {
    const map = ensure(selectsByModule, moduleName);
    map.set(customId, handler);
    return () => map.delete(customId);
  }

  function registerModal(moduleName, customId, handler) {
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
        for (const map of buttonsByModule.values()) {
          const h = map.get(id);
          if (h) return await h(interaction);
        }
        return;
      }

      // Select menus (string, user, role, channel, mentionable)
      if (interaction.isAnySelectMenu?.()) {
        const id = interaction.customId;
        for (const map of selectsByModule.values()) {
          const h = map.get(id);
          if (h) return await h(interaction);
        }
        return;
      }

      // Modals
      if (interaction.type === InteractionType.ModalSubmit) {
        const id = interaction.customId;
        for (const map of modalsByModule.values()) {
          const h = map.get(id);
          if (h) return await h(interaction);
        }
        return;
      }
    } catch (err) {
      logger.error(`Interaction dispatch error: ${err?.message}`, { stack: err?.stack });
      try {
        if (interaction.isRepliable?.() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "An error occurred while handling this interaction.", ephemeral: true });
        }
      } catch {}
    }
  }

  // Wire a single dispatcher once
  client.on("interactionCreate", async (interaction) => {
    await dispatch(interaction);
  });

  return {
    registerButton,
    registerSelect,
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
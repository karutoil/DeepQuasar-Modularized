/**
 * Core event registry to attach/detach Discord client (or other emitter) listeners per module.
 * Ensures cleanup on unload/hot-reload and protects against unhandled errors.
 */
export function createEvents(client, logger) {
  const listenersByModule = new Map(); // module -> Array<{ emitter, event, handler, once }>

  function track(moduleName, emitter, event, handler, once) {
    const arr = listenersByModule.get(moduleName) || [];
    arr.push({ emitter, event, handler, once });
    listenersByModule.set(moduleName, arr);
  }

  function wrapHandler(moduleName, event, handler) {
    return async (...args) => {
      try {
        await handler(...args);
      } catch (err) {
        logger.error(`Event handler error in module '${moduleName}' for '${event}': ${err?.message}`, { stack: err?.stack });
      }
    };
  }

  function on(moduleName, event, handler) {
    const wrapped = wrapHandler(moduleName, event, handler);
    client.on(event, wrapped);
    track(moduleName, client, event, wrapped, false);
    return () => off(moduleName, event, wrapped);
  }

  function once(moduleName, event, handler) {
    const wrapped = wrapHandler(moduleName, event, handler);
    client.once(event, wrapped);
    track(moduleName, client, event, wrapped, true);
    return () => off(moduleName, event, wrapped);
  }

  function off(moduleName, event, handler) {
    // Remove this specific handler for this module
    const arr = listenersByModule.get(moduleName);
    if (!arr) return;
    for (let i = arr.length - 1; i >= 0; i--) {
      const rec = arr[i];
      if (rec.event === event && rec.handler === handler) {
        try {
          rec.emitter.off(rec.event, rec.handler);
        } catch {}
        arr.splice(i, 1);
      }
    }
    if (arr.length === 0) listenersByModule.delete(moduleName);
  }

  function addListener(moduleName, emitter, event, handler, { once = false } = {}) {
    const wrapped = wrapHandler(moduleName, event, handler);
    if (once) {
      emitter.once(event, wrapped);
    } else {
      emitter.on(event, wrapped);
    }
    track(moduleName, emitter, event, wrapped, !!once);
    return () => {
      try { emitter.off(event, wrapped); } catch {}
    };
  }

  function removeModule(moduleName) {
    const arr = listenersByModule.get(moduleName);
    if (!arr) return;
    for (const rec of arr) {
      try {
        rec.emitter.off(rec.event, rec.handler);
      } catch {}
    }
    listenersByModule.delete(moduleName);
  }

  return {
    on,
    once,
    off,
    addListener,
    removeModule,
    _debug: { listenersByModule }
  };
}
import { EventEmitter } from "node:events";

export function createBus(baseLogger) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);

  function wrap(handler, event) {
    return async (payload) => {
      try {
        await handler(payload);
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        baseLogger.error(`Bus handler error on '${event}': ${msg}`, { stack: err?.stack });
      }
    };
  }

  function subscribe(event, handler) {
    const wrapped = wrap(handler, event);
    emitter.on(event, wrapped);
    return () => emitter.off(event, wrapped);
  }

  function once(event, handler) {
    const wrapped = wrap(handler, event);
    emitter.once(event, wrapped);
    return () => emitter.off(event, wrapped);
  }

  function publish(event, payload) {
    emitter.emit(event, payload);
  }

  return {
    publish,
    subscribe,
    once,
    _emitter: emitter
  };
}
/**
 * Pluggable interaction state manager with TTL-based cleanup.
 * Default: in-memory. Optional: file JSON or Mongo provider.
 */
import fs from "node:fs";
import path from "node:path";

export function createStateManager(logger, { provider = "memory", options = {} } = {}) {
  const defaultTtlMs = options.defaultTtlMs ?? 15 * 60 * 1000; // 15 minutes
  const now = () => Date.now();

  function createMemoryProvider() {
    const store = new Map(); // key -> { data: Map, expiresAt: number }
    return {
      getEntry(key) { return store.get(key); },
      setEntry(key, entry) { store.set(key, entry); },
      deleteKey(key) { store.delete(key); },
      clearAll() { store.clear(); },
      entries() { return store.entries(); },
      kind: "memory",
    };
  }

  function createFileJsonProvider(filePath) {
    const file = path.resolve(filePath || path.join(process.cwd(), ".dq_state.json"));
    /** @type {Record<string,{ data: Record<string, any>, expiresAt: number }>} */
    let cache = {};
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, "utf8");
        cache = JSON.parse(raw || "{}");
      }
    } catch (e) {
      logger?.warn?.(`state(file): failed to read ${file}: ${e?.message}`);
    }
    function persist() {
      try {
        fs.writeFileSync(file, JSON.stringify(cache), "utf8");
      } catch (e) {
        logger?.warn?.(`state(file): failed to write ${file}: ${e?.message}`);
      }
    }
    return {
      getEntry(key) {
        const e = cache[key];
        if (!e) return undefined;
        return { data: new Map(Object.entries(e.data || {})), expiresAt: e.expiresAt };
      },
      setEntry(key, entry) {
        cache[key] = { data: Object.fromEntries(entry.data.entries()), expiresAt: entry.expiresAt };
        persist();
      },
      deleteKey(key) { delete cache[key]; persist(); },
      clearAll() { cache = {}; persist(); },
      entries() {
        // materialize iterator compatible with memory provider
        const m = new Map(Object.entries(cache).map(([k, v]) => [k, { data: new Map(Object.entries(v.data || {})), expiresAt: v.expiresAt }]));
        return m.entries();
      },
      kind: "file",
      _file: file,
    };
  }

  function createMongoProvider(mongoOptions) {
    // Thin optional wrapper using core/mongo.js if available at runtime
    let mongo = null;
    try {
      // dynamic import to avoid hard dependency
      // eslint-disable-next-line global-require, import/no-unresolved
      mongo = require?.("../core/mongo.js") || null;
    } catch {}
    if (!mongo || !mongo.getDb) {
      logger?.warn?.("state(mongo): core/mongo.js not available; falling back to memory");
      return createMemoryProvider();
    }
    const db = mongo.getDb(mongoOptions?.uri, mongoOptions?.dbName);
    const col = db.collection(mongoOptions?.collection || "dq_state");
    return {
      async getEntry(key) {
        const doc = await col.findOne({ _id: key });
        if (!doc) return undefined;
        return { data: new Map(Object.entries(doc.data || {})), expiresAt: doc.expiresAt || 0 };
      },
      async setEntry(key, entry) {
        await col.updateOne(
          { _id: key },
          { $set: { data: Object.fromEntries(entry.data.entries()), expiresAt: entry.expiresAt } },
          { upsert: true }
        );
      },
      async deleteKey(key) { await col.deleteOne({ _id: key }); },
      async clearAll() { await col.deleteMany({}); },
      async *entries() {
        const cursor = col.find({});
        for await (const doc of cursor) {
          yield [doc._id, { data: new Map(Object.entries(doc.data || {})), expiresAt: doc.expiresAt || 0 }];
        }
      },
      kind: "mongo",
      _collection: col,
    };
  }

  // Normalize provider to sync-like facade. For async providers, we wrap calls.
  const prov =
    provider === "file"
      ? createFileJsonProvider(options.filePath)
      : provider === "mongo"
        ? createMongoProvider(options.mongo)
        : createMemoryProvider();

  const isAsync =
    prov.kind === "mongo"; // mongo methods can be async/iterators

  async function cleanup() {
    const t = now();
    if (isAsync) {
      for await (const [key, entry] of prov.entries()) {
        if (entry.expiresAt <= t) {
          await prov.deleteKey(key);
        }
      }
    } else {
      for (const [key, entry] of prov.entries()) {
        if (entry.expiresAt <= t) {
          prov.deleteKey(key);
        }
      }
    }
  }

  const interval = setInterval(() => { void cleanup(); }, 60 * 1000);

  async function ensure(key, ttlMs = defaultTtlMs) {
    const existing = isAsync ? await prov.getEntry(key) : prov.getEntry(key);
    let entry = existing;
    if (!entry) {
      entry = { data: new Map(), expiresAt: now() + ttlMs };
    } else {
      entry.expiresAt = now() + ttlMs;
    }
    if (isAsync) {
      await prov.setEntry(key, entry);
    } else {
      prov.setEntry(key, entry);
    }
    return entry.data;
  }

  function wrapDataAPI(getData) {
    return {
      get: (k) => getData().then ? getData().then(d => d.get(k)) : getData().get(k),
      set: async (k, v) => {
        const data = getData().then ? await getData() : getData();
        data.set(k, v);
        // write-through update of entry
        const entry = { data, expiresAt: now() + defaultTtlMs };
        if (isAsync) await prov.setEntry(currentKey, entry); else prov.setEntry(currentKey, entry);
        return v;
      },
      has: async (k) => {
        const data = getData().then ? await getData() : getData();
        return data.has(k);
      },
      delete: async (k) => {
        const data = getData().then ? await getData() : getData();
        const res = data.delete(k);
        const entry = { data, expiresAt: now() + defaultTtlMs };
        if (isAsync) await prov.setEntry(currentKey, entry); else prov.setEntry(currentKey, entry);
        return res;
      },
      clear: async () => {
        const data = getData().then ? await getData() : getData();
        data.clear();
        const entry = { data, expiresAt: now() + defaultTtlMs };
        if (isAsync) await prov.setEntry(currentKey, entry); else prov.setEntry(currentKey, entry);
      },
      keys: async () => {
        const data = getData().then ? await getData() : getData();
        return Array.from(data.keys());
      },
      values: async () => {
        const data = getData().then ? await getData() : getData();
        return Array.from(data.values());
      },
      entries: async () => {
        const data = getData().then ? await getData() : getData();
        return Array.from(data.entries());
      },
    };
  }

  let currentKey = null;

  function deriveKeyFromInteraction(interaction) {
    const msgId = interaction.message?.id;
    if (msgId) return `msg:${msgId}`;
    const token = interaction.token;
    if (token) return `tok:${token}`;
    const id = interaction.id;
    return `id:${id}`;
  }

  function withKey(key, ttlMs = defaultTtlMs) {
    currentKey = key;
    const getData = async () => ensure(key, ttlMs);
    return wrapDataAPI(getData);
  }

  function forInteraction(interaction, ttlMs = defaultTtlMs) {
    return withKey(deriveKeyFromInteraction(interaction), ttlMs);
  }

  async function dispose() {
    try { clearInterval(interval); } catch {}
    if (isAsync) {
      // nothing else needed
    } else {
      prov.clearAll();
    }
  }

  return {
    withKey,
    forInteraction,
    dispose,
    kind: prov.kind,
  };
}
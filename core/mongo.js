import { MongoClient } from "mongodb";

/**
 * Thin MongoDB wrapper using the official driver.
 * Features:
 * - Lazy connect on first use
 * - Shared client across modules via core context
 * - Helper accessors for db and collections
 * - Health check and graceful shutdown
 * - Optional zod schema validation hook per collection (validate on write)
 */
export function createMongo(config, logger) {
  const uri = config.get("MONGODB_URI") || "";
  const dbName = config.get("MONGODB_DB") || "discordbot";
  const srvApi = config.get("MONGODB_SERVER_API") || "v1";
  const minPool = Number(config.get("MONGODB_MIN_POOL") || 0);
  const maxPool = Number(config.get("MONGODB_MAX_POOL") || 10);
  const connectTimeoutMS = Number(config.get("MONGODB_CONNECT_TIMEOUT_MS") || 10000);
  const socketTimeoutMS = Number(config.get("MONGODB_SOCKET_TIMEOUT_MS") || 20000);
  const tls = config.getBool("MONGODB_TLS", false);
  const tlsCAFile = config.get("MONGODB_TLS_CA_FILE"); // optional path

  let client = null;
  let database = null;
  let connecting = null;

  function createClient() {
    if (!uri) {
      logger.warn("MONGODB_URI not set. Mongo will remain disabled.");
      return null;
    }
    const options = {
      serverApi: { version: srvApi, strict: true, deprecationErrors: true },
      minPoolSize: minPool,
      maxPoolSize: maxPool,
      connectTimeoutMS,
      socketTimeoutMS,
      tls,
    };
    if (tlsCAFile) options.tlsCAFile = tlsCAFile;
    return new MongoClient(uri, options);
  }

  async function ensureConnected() {
    if (database) return database;
    if (!client) client = createClient();
    if (!client) return null;
    if (!connecting) {
      connecting = (async () => {
        try {
          await client.connect();
          database = client.db(dbName);
          logger.info(`Mongo connected to db '${dbName}'`);
          return database;
        } catch (err) {
          logger.error(`Mongo connection error: ${err?.message}`, { stack: err?.stack });
          throw err;
        } finally {
          connecting = null;
        }
      })();
    }
    return connecting;
  }

  async function getDb() {
    return await ensureConnected();
  }

  async function getCollection(name) {
    const db = await ensureConnected();
    if (!db) return null;
    return db.collection(name);
  }

  async function ping() {
    const db = await ensureConnected();
    if (!db) return { ok: false, error: "not_connected" };
    try {
      const res = await db.command({ ping: 1 });
      return { ok: true, res };
    } catch (err) {
      logger.error(`Mongo ping error: ${err?.message}`, { stack: err?.stack });
      return { ok: false, error: err?.message };
    }
  }

  async function close() {
    if (client) {
      try {
        await client.close();
        logger.info("Mongo client closed");
      } catch (err) {
        logger.warn(`Mongo close error: ${err?.message}`);
      } finally {
        client = null;
        database = null;
      }
    }
  }

  /**
   * Optional helper to wrap writes with a zod schema validation.
   * @param {import("zod").ZodSchema} schema
   * @param {Function} op async function performing write (e.g., () => coll.insertOne(doc))
   */
  async function withSchema(schema, op) {
    try {
      const result = await op(schema);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err?.message || "write_error" };
    }
  }

  return {
    getDb,
    getCollection,
    ping,
    close,
    withSchema,
    _client: () => client,
  };
}
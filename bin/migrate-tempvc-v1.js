/**
 * TempVC Migration v1
 * Collection: tempvc_channels
 *
 * Adds/normalizes fields with safe defaults for all existing documents:
 *  - isLocked: boolean (default true if missing/invalid)
 *  - isPublic: boolean (default false if missing/invalid)
 *  - allowlist: array of strings (default [] if missing/invalid)
 *  - denylist: array of strings (default [] if missing/invalid)
 *  - singlePanelMessageId: string|null (default null if missing/invalid)
 *  - bitrate: if present and numeric, keep; else set to 64000
 *
 * Indexes:
 *  Ensures useful indexes already defined by TempVC module:
 *   - { guildId: 1, channelId: 1 } unique
 *   - { guildId: 1, ownerId: 1 } non-unique
 *   - { lastActivityAt: 1 } TTL 7 days
 *
 * How to run:
 *   node ./bin/migrate-tempvc-v1.js
 *
 * Idempotency:
 *   The filter matches only docs with missing/invalid values or non-numeric bitrate.
 *   Re-running after a successful run will yield matchedCount 0 and modifiedCount 0.
 *
 * Rollback (manual):
 *   To remove the newly introduced fields:
 *     db.tempvc_channels.updateMany(
 *       {},
 *       { $unset: { isLocked: "", isPublic: "", allowlist: "", denylist: "", singlePanelMessageId: "" } }
 *     )
 *   Bitrate normalization cannot be automatically reverted (original value not stored).
 *   If necessary, set a chosen default:
 *     db.tempvc_channels.updateMany({}, { $set: { bitrate: 64000 } })
 */

import { createConfig, createLogger, createMongo } from "../core/index.js";

const COLLECTION = "tempvc_channels";

// Aliases for Mongo $type we consider "numeric"
const NUMERIC_TYPES = ["int", "long", "double", "decimal"];

async function run() {
  // Bootstrap config/logger consistent with core
  const config = createConfig();
  const logger = createLogger(config.get("LOG_LEVEL") ?? "info");
  const mongo = createMongo(config, logger);

  let exitCode = 0;

  try {
    logger.info("[TempVC:Migrate v1] Starting migration");

    const db = await mongo.getDb();
    if (!db) {
      logger.error("[TempVC:Migrate v1] No MongoDB connection available (MONGODB_URI not set?)");
      process.exitCode = 1;
      return;
    }

    const col = db.collection(COLLECTION);

    // Build filter: match any doc missing/invalid for our target fields or with non-numeric bitrate
    const typeNot = (alias) => ({ $not: { $type: alias } });

    const bitrateNotNumeric = {
      $and: [
        { bitrate: { $exists: true } },
        {
          $nor: NUMERIC_TYPES.map((t) => ({ bitrate: { $type: t } })),
        },
      ],
    };

    const filter = {
      $or: [
        { isLocked: { $exists: false } },
        { isLocked: typeNot("bool") },

        { isPublic: { $exists: false } },
        { isPublic: typeNot("bool") },

        { allowlist: { $exists: false } },
        { allowlist: typeNot("array") },

        { denylist: { $exists: false } },
        { denylist: typeNot("array") },

        { singlePanelMessageId: { $exists: false } },
        // If exists, it must be string or null (allow nulls)
        {
          $and: [
            { singlePanelMessageId: { $exists: true } },
            { singlePanelMessageId: typeNot("string") },
            { singlePanelMessageId: typeNot("null") },
          ],
        },

        { bitrate: { $exists: false } },
        bitrateNotNumeric,
      ],
    };

    // Defaults to set for any matched doc. Because filter only matches invalid/missing cases,
    // unconditionally setting these values will not overwrite valid documents.
    const defaults = {
      isLocked: true,
      isPublic: false,
      allowlist: [],
      denylist: [],
      singlePanelMessageId: null,
      bitrate: 64000,
    };

    logger.info("[TempVC:Migrate v1] Executing updateMany...");
    const res = await col.updateMany(filter, { $set: defaults }, { writeConcern: { w: "majority" } });
    logger.info("[TempVC:Migrate v1] Update completed", {
      matchedCount: res?.matchedCount ?? 0,
      modifiedCount: res?.modifiedCount ?? 0,
      acknowledged: !!res?.acknowledged,
    });

    // Ensure indexes (idempotent)
    logger.info("[TempVC:Migrate v1] Ensuring indexes (idempotent)...");
    try {
      await col.createIndexes([
        { key: { guildId: 1, channelId: 1 }, unique: true, name: "guild_channel_unique" },
        { key: { guildId: 1, ownerId: 1 }, name: "guild_owner_idx" },
        { key: { lastActivityAt: 1 }, expireAfterSeconds: 60 * 60 * 24 * 7, name: "ttl_lastActivity_7d" },
      ]);
      logger.info("[TempVC:Migrate v1] Indexes ensured");
    } catch (idxErr) {
      logger.warn("[TempVC:Migrate v1] Index ensure failed (continuing)", { error: idxErr?.message });
    }

    logger.info("[TempVC:Migrate v1] Migration completed successfully");
  } catch (err) {
    exitCode = 1;
    // eslint-disable-next-line no-console
    console.error("[TempVC:Migrate v1] Migration failed:", err?.message, err?.stack);
  } finally {
    try {
      await new Promise((r) => setTimeout(r, 5)); // small microtask drain
      // Attempt to close client gracefully
    } catch {}
    // We intentionally do not call mongo.close() here because the core wrapper manages lifecycle,
    // and closing on standalone scripts is optional. If desired, uncomment the following:
    // await mongo.close();
    process.exitCode = exitCode;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}

export default run;
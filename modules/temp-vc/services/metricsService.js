/**
 * Metrics service for Temporary Voice Channels.
 * Aggregates counters, daily snapshots, and provides export helpers.
 */
import { repo } from "./repository.js";

export async function ensureIndexes(ctx) {
  // Indexes are created in repository.ensureIndexes()
  return;
}

export function metricsService(ctx) {
  const { logger } = ctx;
  const { collections } = repo(ctx);

  function dayKey(ts = new Date()) {
    const d = new Date(ts);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}${mm}${dd}`;
  }

  async function incDaily(guildId, field, by = 1, ts = new Date()) {
    const date = dayKey(ts);
    const _id = `${guildId}:${date}`;
    const col = await collections.metricsDaily();
    await col.updateOne(
      { _id },
      {
        $setOnInsert: { _id, guildId, date, createdAt: new Date() },
        $inc: { [field]: by },
      },
      { upsert: true }
    );
  }

  return {
    async onVCCreated(guildId) {
      await incDaily(guildId, "vcsCreated", 1);
    },
    async onVCDeleted(guildId) {
      await incDaily(guildId, "vcsDeleted", 1);
    },
    async onRecovered(guildId, by = 1) {
      await incDaily(guildId, "recovered", by);
    },
    async onReassigned(guildId, by = 1) {
      await incDaily(guildId, "reassigned", by);
    },
    async onCleanedOrphans(guildId, by = 1) {
      await incDaily(guildId, "cleanedOrphans", by);
    },
    async updatePeakConcurrent(guildId, current, ts = new Date()) {
      const date = dayKey(ts);
      const _id = `${guildId}:${date}`;
      const col = await collections.metricsDaily();
      const doc = await col.findOne({ _id });
      const peak = Math.max(current, doc?.peakConcurrent || 0);
      await col.updateOne(
        { _id },
        {
          $setOnInsert: { _id, guildId, date, createdAt: new Date() },
          $set: { peakConcurrent: peak },
        },
        { upsert: true }
      );
    },
    async exportDaily(guildId, date) {
      const key = date || dayKey(new Date());
      const _id = `${guildId}:${key}`;
      const col = await collections.metricsDaily();
      const doc = await col.findOne({ _id });
      return doc || { _id, guildId, date: key, vcsCreated: 0, vcsDeleted: 0, recovered: 0, reassigned: 0, cleanedOrphans: 0, peakConcurrent: 0 };
    },
  };
}
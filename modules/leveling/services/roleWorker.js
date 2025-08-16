import { getAuditCollection, getConfigCollection } from './store.js';

let intervalHandle = null;

export function startRoleWorker(core, opts = {}) {
  const logger = core.logger;
  const intervalSec = Number(core.config.get('LEVELING_ROLE_CLEANUP_INTERVAL') || 3600);

  async function runOnce() {
    try {
      const coll = await getAuditCollection(core);
      const now = new Date();
      const cursor = (await coll).find({ action: 'temporary_role_assigned', 'data.expiresAt': { $lte: now }, 'data.processed': { $ne: true } });
      while (await cursor.hasNext()) {
        const doc = await cursor.next();
        try {
          const { guildId } = doc;
          const { userId, roleId } = doc.data || {};
          if (!guildId || !userId || !roleId) {
            await (await coll).updateOne({ _id: doc._id }, { $set: { 'data.processed': true, 'data.note': 'invalid_entry' } });
            continue;
          }
          const guild = await core.client.guilds.fetch(guildId).catch(() => null);
          if (!guild) {
            logger.warn('[leveling.roleWorker] guild not found', { guildId });
            continue;
          }
          const member = await guild.members.fetch(userId).catch(() => null);
          if (!member) {
            logger.info('[leveling.roleWorker] member not found, marking processed', { guildId, userId });
            await (await coll).updateOne({ _id: doc._id }, { $set: { 'data.processed': true, 'data.note': 'member_not_found' } });
            continue;
          }
          // remove role if present
          if (member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId, 'Temporary role expired');
            logger.info('[leveling.roleWorker] removed temporary role', { guildId, userId, roleId });
          }
          await (await coll).updateOne({ _id: doc._id }, { $set: { 'data.processed': true, 'data.processedAt': new Date() } });
        } catch (err) {
          logger.error('[leveling.roleWorker] error processing audit doc', { err: err?.message, stack: err?.stack });
        }
      }
    } catch (err) {
      logger.error('[leveling.roleWorker] run error', { err: err?.message, stack: err?.stack });
    }
  }

  // start interval
  if (intervalHandle) return;
  intervalHandle = setInterval(runOnce, Math.max(1000, intervalSec * 1000));
  // run immediately once
  runOnce().catch(() => {});
  logger.info('[leveling.roleWorker] started', { intervalSec });
}

export function stopRoleWorker(core) {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    core.logger.info('[leveling.roleWorker] stopped');
  }
}

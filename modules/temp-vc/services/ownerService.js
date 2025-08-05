/**
 * Owner service: tracking, reassignment, and claim logic for TempVC.
 * Integrates with repository collections, intended to be called from voice events
 * and commands. This service updates the tempvc_channels.ownerId field and
 * maintains presence.ownerCandidateIds ordering for fair reassignment.
 */
import { repo } from "./repository.js";
import { metricsService } from "./metricsService.js";

export function ownerService(ctx) {
  const { client, logger } = ctx;
  const { collections } = repo(ctx);
  const metrics = metricsService(ctx);

  async function channelsCol() {
    return await collections.channels();
  }

  async function getChannelDoc(channelId) {
    const col = await channelsCol();
    return col.findOne({ _id: channelId, deletedAt: { $in: [null, undefined] } });
  }

  async function snapshotPresence(channelId) {
    try {
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (!ch || !("members" in ch)) return null;
      const memberIds = Array.from(ch.members.keys());
      const col = await channelsCol();
      await col.updateOne(
        { _id: channelId },
        { $set: { "presence.memberIds": memberIds, "presence.lastSnapshotAt": new Date(), lastActiveAt: new Date() } }
      );
      return memberIds;
    } catch (e) {
      logger.warn("[TempVC] snapshotPresence error", { channelId, error: e?.message });
      return null;
    }
  }

  async function recomputeOwnerCandidates(channelId, ownerId) {
    const doc = await getChannelDoc(channelId);
    if (!doc) return [];
    const members = doc.presence?.memberIds || [];
    const candidates = members.filter((m) => m !== ownerId);
    const col = await channelsCol();
    await col.updateOne(
      { _id: channelId },
      { $set: { "presence.ownerCandidateIds": candidates, "presence.lastSnapshotAt": new Date() } }
    );
    return candidates;
  }

  async function setOwner(channelId, newOwnerId, actorId = null, reason = "TempVC: owner set") {
    const col = await channelsCol();
    await col.updateOne(
      { _id: channelId },
      { $set: { ownerId: newOwnerId, lastActiveAt: new Date() } }
    );
    logger.info("[TempVC] Owner updated", { channelId, newOwnerId, actorId, reason });
  }

  return {
    /**
     * Claim ownership by a user currently in the channel when no valid owner is present.
     */
    async claim(channelId, claimerId) {
      const doc = await getChannelDoc(channelId);
      if (!doc) throw new Error("Channel record not found");
      if (doc.ownerId === claimerId) return { ok: true, message: "You already own this VC." };

      // Ensure claimer is in channel
      const members = (await snapshotPresence(channelId)) || doc.presence?.memberIds || [];
      if (!members.includes(claimerId)) throw new Error("You must be in the channel to claim ownership.");

      // Allow claim if current owner is not present
      if (doc.ownerId && members.includes(doc.ownerId)) {
        throw new Error("Owner is present; cannot claim.");
      }

      await setOwner(channelId, claimerId, claimerId, "TempVC: claim");
      await recomputeOwnerCandidates(channelId, claimerId);
      await metrics.onReassigned(doc.guildId, 1);
      return { ok: true, message: "Ownership claimed." };
    },

    /**
     * Promote a member to owner (admin or owner action).
     */
    async promote(channelId, promoterId, targetUserId) {
      const doc = await getChannelDoc(channelId);
      if (!doc) throw new Error("Channel record not found");
      // Guard checks (owner or admin) should be done by caller
      await setOwner(channelId, targetUserId, promoterId, "TempVC: promote");
      await recomputeOwnerCandidates(channelId, targetUserId);
      await metrics.onReassigned(doc.guildId, 1);
      return { ok: true, message: "Ownership transferred." };
    },

    /**
     * When owner leaves, reassign ownership to the next eligible member if any.
     * Returns newOwnerId or null if none.
     */
    async handleOwnerLeft(channelId) {
      const doc = await getChannelDoc(channelId);
      if (!doc) return null;

      const members = (await snapshotPresence(channelId)) || doc.presence?.memberIds || [];
      if (!members.length) {
        // No members; keep ownerId until deletion logic runs
        return null;
      }
      if (doc.ownerId && members.includes(doc.ownerId)) {
        // Owner still present; nothing to do
        return doc.ownerId;
      }

      // Determine next eligible owner
      let candidates = doc.presence?.ownerCandidateIds || [];
      if (!candidates?.length) {
        // Recompute from current members
        candidates = members.filter((m) => m !== doc.ownerId);
      }
      const next = candidates.find((m) => members.includes(m)) || members[0];
      if (!next) return null;

      await setOwner(channelId, next, null, "TempVC: auto-reassign after owner left");
      await recomputeOwnerCandidates(channelId, next);
      await metrics.onReassigned(doc.guildId, 1);
      return next;
    },
  };
}
// Permission helpers for ticket channels
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";

/**
 * Compute base overwrites for a ticket channel.
 * - Deny @everyone view
 * - Allow opener read/send
 * - Allow support roles read/send (+ manage messages)
 * - Allow bot full manage
 */
export function buildBaseOverwrites({ everyoneId, openerId, supportRoleIds = [], botId }) {
  const overwrites = [];

  if (everyoneId) {
    overwrites.push({
      id: everyoneId,
      deny: new PermissionsBitField([PermissionFlagsBits.ViewChannel]),
    });
  }

  if (openerId) {
    overwrites.push({
      id: openerId,
      allow: new PermissionsBitField([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ]),
    });
  }

  for (const rid of supportRoleIds) {
    overwrites.push({
      id: rid,
      allow: new PermissionsBitField([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageMessages,
      ]),
    });
  }

  if (botId) {
    overwrites.push({
      id: botId,
      allow: new PermissionsBitField([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
      ]),
    });
  }

  return overwrites;
}

/**
 * Compute lock/unlock overwrites derived from base overwrites.
 * When locked, deny SendMessages for opener and support roles.
 */
export function buildLockOverwrites({ openerId, supportRoleIds = [], botId, locked }) {
  const ovr = [];

  if (openerId) {
    ovr.push({
      id: openerId,
      allow: new PermissionsBitField([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        ...(locked ? [] : [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks]),
      ]),
      deny: new PermissionsBitField(locked ? [PermissionFlagsBits.SendMessages] : []),
    });
  }

  for (const rid of supportRoleIds) {
    ovr.push({
      id: rid,
      allow: new PermissionsBitField([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        ...(locked ? [] : [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages]),
      ]),
      deny: new PermissionsBitField(locked ? [PermissionFlagsBits.SendMessages] : []),
    });
  }

  if (botId) {
    ovr.push({
      id: botId,
      allow: new PermissionsBitField([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
      ]),
    });
  }

  return ovr;
}
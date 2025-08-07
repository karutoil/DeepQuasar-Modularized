/**
 * Guards for recursion prevention and idempotency.
 */

import { isOnlyLinksContent } from "./parse.js";

/**
 * Create guard helpers.
 * - processedIds: in-memory TTL cache to prevent duplicate processing of the same triggering message
 * - isBotAuthoredMessage: simple check to avoid acting on our own messages
 * - isLikelyQuoteMessageId: lightweight heuristic to avoid quoting our own quoted messages (prevents loops when someone links our quote)
 * - isContentOnlyLinks: delegates to parse util
 */
export function createGuards({ logger }) {
  // TTL cache for processed message IDs
  const processed = new Map(); // id -> expiresAt
  const TTL_MS = 5 * 60 * 1000; // 5 minutes

  function sweep() {
    const now = Date.now();
    for (const [id, exp] of processed.entries()) {
      if (exp <= now) processed.delete(id);
    }
  }

  function markProcessedOnce(messageId) {
    try {
      sweep();
      if (processed.has(messageId)) return false;
      processed.set(messageId, Date.now() + TTL_MS);
      return true;
    } catch {
      return true;
    }
  }

  function isBotAuthoredMessage(client, msg) {
    try {
      const botId = client?.user?.id;
      if (!botId) return false;
      return msg?.author?.id === botId;
    } catch {
      return false;
    }
  }

  /**
   * Heuristic: If a link points to a message ID we already processed recently,
   * skip it to avoid recursive quoting of our own fresh quotes.
   * This is conservative and may skip rare legitimate cases, but prevents loops cleanly.
   */
  function isLikelyQuoteMessageId(messageId) {
    try {
      // If we recently processed a message with this ID as the source of our quote,
      // it will be present in the cache. Reuse the same map; safe enough.
      return processed.has(messageId);
    } catch {
      return false;
    }
  }

  function isContentOnlyLinks(content, parsed) {
    return isOnlyLinksContent(content, parsed);
  }

  return {
    markProcessedOnce,
    isBotAuthoredMessage,
    isLikelyQuoteMessageId,
    isContentOnlyLinks
  };
}
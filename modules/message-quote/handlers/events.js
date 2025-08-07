import { parseLinksFromContent, isSameGuild } from "../utils/parse.js";
import { buildHeaderEmbed, buildQuoteEmbed, buildComponents } from "../utils/embeds.js";
import { extractFirstImage } from "../utils/images.js";
import { canReadChannel, fetchMessageWithPerms } from "../utils/fetch.js";
import { createGuards } from "../utils/guard.js";
import { tKeys, t } from "../utils/i18n.js";

// Per requirements: process up to this many links per triggering message
const MAX_LINKS_PER_MESSAGE = 3;

export function registerMessageCreateHandler(ctx) {
  const moduleName = "message-quote";
  const { logger, events, client, guildConfig, embed } = ctx;

  const guards = createGuards({ logger });

  const off = events.on(moduleName, "messageCreate", async (msg) => {
    try {
      // Basic guards
      if (!msg?.guild || msg.author?.bot) return;
      if (msg.author?.id === client.user?.id) return;

      // Per-guild enable toggle
      const enabled = guildConfig.get(msg.guild.id, "message_quote_enabled", true);
      if (!enabled) return;

      // Avoid recursive quoting and duplicate processing
      if (guards.isBotAuthoredMessage(client, msg)) return;
      if (!guards.markProcessedOnce(msg.id)) return;

      const content = msg.content || "";
      const parsed = parseLinksFromContent(content);
      if (parsed.length === 0) return;

      // Only consider same-guild links
      const sameGuild = parsed.filter((p) => isSameGuild(p.guildId, msg.guild.id));
      if (sameGuild.length === 0) {
        // Links exist but none are same-guild: ignore to avoid spam, per requirements.
        return;
      }

      const slice = sameGuild.slice(0, MAX_LINKS_PER_MESSAGE);
      let allSucceeded = true;

      for (const link of slice) {
        // Prevent creating embeds for links that reference messages created by us with our signature
        if (guards.isLikelyQuoteMessageId(link.messageId)) continue;

        // Read perms and fetch
        const can = await canReadChannel(ctx, link.channelId, msg.guild);
        if (!can.ok) {
          allSucceeded = false;
          const e = embed.warn({
            title: t(ctx, tKeys.errors.missingPermsTitle),
            description: t(ctx, tKeys.errors.missingPerms, { perms: can.missing.join(", ") }),
          });
          await msg.reply({ embeds: [e] }).catch(() => {});
          continue;
        }

        const fetched = await fetchMessageWithPerms(ctx, link.channelId, link.messageId, msg.guild);
        if (!fetched.ok) {
          allSucceeded = false;
          const e = embed.warn({
            title: t(ctx, tKeys.errors.fetchFailedTitle),
            description: t(ctx, tKeys.errors.fetchFailed),
          });
          await msg.reply({ embeds: [e] }).catch(() => {});
          continue;
        }

        const { message: srcMsg, channel } = fetched;

        // Extract first image if any
        const imageUrl = extractFirstImage(srcMsg);

        // Build header and main embeds
        const header = buildHeaderEmbed(ctx, msg.author);
        const quote = buildQuoteEmbed(ctx, srcMsg, channel, { imageUrl });

        // Build components (single Link button)
        const components = buildComponents(ctx, srcMsg.url);

        // Send reply for this link (two embeds in a single reply)
        await msg.reply({ embeds: [header, quote], components }).catch((err) => {
          allSucceeded = false;
          logger.warn("[MessageQuote] Failed to send quote reply", { error: err?.message });
        });
      }

      // Optional deletion: only if configured and content is link-only and all succeeded
      const deleteOriginal = guildConfig.get(msg.guild.id, "message_quote_delete_original", false);
      if (deleteOriginal && allSucceeded && guards.isContentOnlyLinks(content, parsed)) {
        await msg.delete().catch(() => {});
      }
    } catch (err) {
      logger.error("[MessageQuote] messageCreate handler error", { error: err?.message });
      await ctx.errorReporter?.report?.(err, { scope: "message-quote", op: "messageCreate" });
    }
  });

  ctx.lifecycle.addDisposable(off);
  return off;
}
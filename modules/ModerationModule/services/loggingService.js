
import { getModlogChannel } from "./guildConfigService.js";

/**
 * Logs a moderation action to the configured moderation log channel.
 * @param {string} guildId
 * @param {object} actionData - { action, userId, moderatorId, reason, extra }
 * @returns {Promise<void>}
 */
export async function logAction(ctx, guildId, actionData) {
    try {
        // DEBUG: Validate guildConfig and logChannelId
        ctx.logger?.debug?.("[logAction] ctx.guildConfig:", ctx.guildConfig);
        const logChannelId = await getModlogChannel(ctx, guildId);
        ctx.logger?.debug?.("[logAction] Resolved logChannelId:", logChannelId);

        if (!logChannelId) {
            throw new Error('Moderation log channel not configured.');
        }

        // Build embed for moderation action
        const embed = ctx.embed.success({
            title: `Moderation Action: ${actionData.action}`,
            description: [
                `**User:** <@${actionData.userId}>`,
                `**Moderator:** <@${actionData.moderatorId}>`,
                actionData.reason ? `**Reason:** ${actionData.reason}` : null,
                actionData.extra ? `**Details:** ${actionData.extra}` : null,
            ].filter(Boolean).join('\n'),
            timestamp: new Date(),
        });

        // Send embed to Discord channel
        const channel = ctx.client.channels.cache.get(logChannelId);
        ctx.logger?.debug?.("[logAction] Resolved channel:", channel?.id);
        if (!channel) throw new Error('Log channel not found in cache.');
        await channel.send({ embeds: [embed] });
    } catch (err) {
        ctx.logger?.error?.(`[logAction] Failed to log moderation action: ${err.message}`);
        throw new Error(`Failed to log moderation action: ${err.message}`);
    }
}
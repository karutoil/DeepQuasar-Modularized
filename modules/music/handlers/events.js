
import { playNext } from './play.js';

/**
 * Registers listeners for Shoukaku player events.
 * @param {object} ctx - The module context.
 */
export function registerPlayerEvents(ctx) {
    const { embed, music: { shoukaku, queueManager } } = ctx;
    const moduleName = 'music';

    ctx.logger.debug(`[Music] registerPlayerEvents invoked`);
    shoukaku.on('playerReady', (player) => {
        ctx.logger.debug(`[Music] playerReady event for guild ${player.guildId}, registering player event handlers`);
        player.on('start', async () => {
            ctx.logger.debug(`[Music] Player start event for guild ${player.guildId}`);
            const queue = queueManager.get(player.guildId);
            if (queue) queue.lastStartAt = Date.now();
        });
        player.on('end', async (data) => {
            ctx.logger.debug(`[Music] Player end event for guild ${player.guildId}: reason=${data?.reason}`);
            // If skipping emits 'REPLACED', log and call playNext anyway
            if (data.reason === 'REPLACED') {
                ctx.logger.debug(`[Music] Track ended due to REPLACED (likely skip). Forcing playNext.`);
                // Do not return; continue to play next track
            }
            const queue = queueManager.get(player.guildId);
            const textChannel = queue ? await ctx.client.channels.fetch(queue.textChannelId).catch(() => null) : null;
            playNext(ctx, player.guildId, textChannel);
        });

        player.on('exception', async (error) => {
            logger.error(`[${moduleName}] Player exception for guild ${player.guildId}`, { error });
            const queue = queueManager.get(player.guildId);
            const textChannel = queue ? await ctx.client.channels.fetch(queue.textChannelId).catch(() => null) : null;
            if (textChannel) {
                textChannel.send({ embeds: [embed.error('An unexpected error occurred with the player.')] });
            }
        });

        player.on('stuck', () => {
            logger.warn(`[${moduleName}] Player stuck for guild ${player.guildId}`);
            player.stopTrack();
        });

        player.on('closed', (data) => {
            logger.warn(`[${moduleName}] Player closed for guild ${player.guildId}`, { data });
            queueManager.destroy(player.guildId);
            // Disconnect via connection object if available
            const connection = shoukaku.connections.get(player.guildId);
            if (connection) connection.disconnect();
        });
    });
}

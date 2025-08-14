import { ApplicationCommandOptionType, ChannelType } from "discord.js";
import { getGuildMusicSettings } from "../services/settings.js";

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return minutes + ":" + (seconds < 10 ? '0' : '') + seconds;
}

export function createPlayCommand(ctx) {
  const { v2, logger, music, embed } = ctx;
  const { manager } = music;

  const cmdPlay = v2.createInteractionCommand()
    .setName("play")
    .setDescription("Plays a song or adds it to the queue.")
    .addStringOption(opt =>
      opt.setName("query")
        .setDescription("The song name or URL")
        .setRequired(true)
    )
    .addChannelOption(opt =>
      opt.setName("channel")
        .setDescription("The voice channel to play in (defaults to your current voice channel)")
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(false)
    );

  cmdPlay.onExecute(async (interaction) => {
    await interaction.deferReply();

    const query = interaction.options.getString("query");
    let voiceChannel = interaction.options.getChannel("channel");

    // Precondition checks
    if (!interaction.guild) {
      return interaction.editReply({ embeds: [embed.error("This command must be used in a guild.")] });
    }

    const member = interaction.guild.members.cache.get(interaction.user.id);
    if (!voiceChannel) {
      if (member && member.voice && member.voice.channel) {
        voiceChannel = member.voice.channel;
      } else {
        return interaction.editReply({ embeds: [embed.error("Please specify a voice channel or join one.")] });
      }
    }

    if (!voiceChannel.joinable) {
      return interaction.editReply({ embeds: [embed.error("I cannot join that voice channel. Please ensure I have the CONNECT permission.")] });
    }

    if (!member) {
      return interaction.editReply({ embeds: [embed.error("Could not fetch your member information. Try again later.")] });
    }

    try {
      let player = manager.players.get(interaction.guild.id);

    if (!player) {
      const guildSettings = await getGuildMusicSettings(ctx, interaction.guild.id);
      player = manager.createPlayer({
        guildId: interaction.guild.id,
        voiceChannelId: voiceChannel.id,
        textId: interaction.channel.id,
        volume: guildSettings.volume,
        deaf: true,
      });
    }

      if (player.state !== "CONNECTED") {
        logger.debug(`[Music] Player not connected, attempting to connect to voice channel: ${voiceChannel.id}`);
        try {
          await player.connect();
          logger.debug(`[Music] Player connected to voice channel: ${voiceChannel.id}`);
        } catch (err) {
          logger.warn(`[Music] Failed to connect player to voice channel ${voiceChannel.id}: ${err.message}`);
          return interaction.editReply({ embeds: [embed.error("Failed to join voice channel. Ensure the bot has permission and try again.")] });
        }
      }


      const res = await player.search({ query, source: "ytsearch" }, interaction.user);

      if (!res || !res.tracks.length) {
        return interaction.editReply({ embeds: [embed.error(`No results found for 
${query}
.`)] });
      }

      logger.debug(`[Music] Search result loadType: ${res.loadType}`);
      logger.debug(`[Music] Search result tracks length: ${res.tracks.length}`);
      if (res.playlistInfo) {
        logger.debug(`[Music] Search result playlist name: ${res.playlistInfo.name}`);
      }
      logger.debug(`[Music] Is loadType === "playlist"? ${res.loadType === "playlist"}`);

      if (res.loadType === "playlist") {
        player.queue.add(res.tracks);
        logger.debug(`[Music] Full search result object: ${JSON.stringify(res)}`);
        logger.debug(`[Music] Queue size after adding playlist tracks: ${player.queue.size}`);
        const playlistEmbed = embed.success(`Added playlist **${res.playlist.name}** with ${res.tracks.length} songs to the queue.`);
        playlistEmbed.setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) });
        await interaction.editReply({ embeds: [playlistEmbed] });
      } else {
        const track = res.tracks[0];
        player.queue.add(track);
        const songEmbed = embed.success(`Added **${track.info.title}** to the queue!`);
        songEmbed.setDescription(`**Song:** ${track.info.title}\n**Artist:** ${track.info.author}\n**Duration:** ${formatDuration(track.info.duration)}`);
        if (track.info.artworkUrl) {
          songEmbed.setThumbnail(track.info.artworkUrl);
        }
        songEmbed.setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) });
        await interaction.editReply({ embeds: [songEmbed] });
      }

      if (!player.playing && !player.paused) {
        await player.play();
      }
      logger.debug(`[Music] Queue size after player.play(): ${player.queue.size}`);
      if (player.queue.current) {
        logger.debug(`[Music] Current track after player.play(): ${player.queue.current.info.title}`);
      } else {
        logger.debug(`[Music] No current track after player.play().`);
      }

    } catch (error) {
      logger.error(`[Music] Error playing song: ${error.message}`);
      await interaction.editReply({ embeds: [embed.error(`An error occurred while trying to play the song: ${error.message}`)] });
    }
  });

  return cmdPlay;
}

// Play command handler
export function createPlayCommand(ctx, moonlink, queueManager) {
  const { v2, embed, lifecycle } = ctx;
  const moduleName = "music";

  const playCmd = v2.createInteractionCommand()
    .setName("play")
    .setDescription("Play a track or add to queue")
    .addStringOption(opt => opt.setName("query").setDescription("Song name or URL").setRequired(true))
    .onExecute(async (interaction, args, state) => {
      const guildId = interaction.guildId;
      ctx.logger.debug("Play command args/options", { args, options: interaction.options });
      let query = args.query;
      // Fallback: try to get query from interaction.options if missing
      if (!query && interaction.options && typeof interaction.options.getString === "function") {
        query = interaction.options.getString("query");
      }
      if (!query || typeof query !== "string" || !query.trim()) {
        ctx.logger.error("Query is missing or empty in /play", { userId: interaction.user?.id, query });
        await interaction.reply({ embeds: [embed.error({ title: "You must provide a song name or URL." })], ephemeral: true });
        return;
      }
      let member = interaction.member;
      if (!member && interaction.guild && interaction.user) {
        try {
          member = await interaction.guild.members.fetch(interaction.user.id);
        } catch (err) {
          ctx.logger.warn("Could not fetch member for voice channel check", { error: err });
        }
      }
      let voiceChannelId = member?.voice?.channelId;
      let textChannelId = interaction.channelId;
      ctx.logger.debug("Voice channel ID type/value", { type: typeof voiceChannelId, value: voiceChannelId });
      ctx.logger.debug("Text channel ID type/value", { type: typeof textChannelId, value: textChannelId });
      if (!voiceChannelId || typeof voiceChannelId !== "string") {
        ctx.logger.error("VoiceChannelId missing or not a string in /play", {
          userId: interaction.user?.id,
          member: !!member,
          memberVoice: member?.voice,
          channelId: textChannelId,
          voiceChannelId,
        });
        await interaction.reply({ embeds: [embed.error({ title: "You must be in a voice channel to use this command." })], ephemeral: true });
        return;
      }
      // Fetch channel object and check type
      let textChannelObj = null;
      if (interaction.guild && textChannelId) {
        try {
          textChannelObj = await interaction.guild.channels.fetch(textChannelId);
        } catch (err) {
          ctx.logger.warn("Could not fetch text channel for play command", { error: err, textChannelId });
        }
      }
      // Discord.js v14: type 0 = GUILD_TEXT, type 15 = GUILD_VOICE_TEXT
      // Accept type 2 (GUILD_VOICE) if it has a messages property (side chat)
      const isTextOrVoiceChat = (
        textChannelObj && (
          textChannelObj.type === 0 ||
          textChannelObj.type === 15 ||
          textChannelObj.type === "GUILD_TEXT" ||
          textChannelObj.type === "GUILD_VOICE_TEXT" ||
          (textChannelObj.type === 2 && Array.isArray(textChannelObj.messages))
        )
      );
      if (!isTextOrVoiceChat) {
        ctx.logger.error("TextChannelId is not a valid text channel or voice side chat", { textChannelId, type: textChannelObj?.type });
        await interaction.reply({ embeds: [embed.error({ title: "You must use this command in a text channel or the chat tab attached to a voice channel." })], ephemeral: true });
        return;
      }
      textChannelId = textChannelObj.id;
      // Search for tracks before creating player
      ctx.logger.debug("Calling moonlink.search", { query, type: typeof query });
      const res = await moonlink.search({ query });
      ctx.logger.debug("moonlink.search result", { res });
      if (!res.tracks.length) {
        await interaction.reply({ embeds: [embed.error({ title: "No results found." })], ephemeral: true });
        return;
      }
      const track = res.tracks[0];
      // Create player only after confirming tracks exist
      const player = moonlink.players.get(guildId) || moonlink.players.create({ guildId, voiceChannelId: String(voiceChannelId), textChannelId: String(textChannelId) });
      queueManager.addTrack(guildId, track);
      if (!player.playing) {
        await player.play(track);
        await interaction.reply({ embeds: [embed.success({ title: `Now playing: ${track.title}` })], ephemeral: true });
      } else {
        await interaction.reply({ embeds: [embed.info({ title: `Added to queue: ${track.title}` })], ephemeral: true });
      }
    });

  // Support both core context and direct context
  let registrar;
  if (typeof ctx.createModuleContext === "function") {
    registrar = ctx.createModuleContext(moduleName).v2;
  } else {
    registrar = v2;
  }
  lifecycle.addDisposable(registrar.register(playCmd));
  return playCmd;
}

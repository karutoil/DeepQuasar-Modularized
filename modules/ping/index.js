import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

/**
 * Ping module
 * Feature flag: MODULE_PING_ENABLED
 */
export default async function init(ctx) {
  const { logger, config, commands, interactions, utils } = ctx;
  const enabled = config.isEnabled("MODULE_PING_ENABLED", true);
  if (!enabled) {
    logger.info("MODULE_PING_ENABLED=false, skipping initialization");
    return { name: "ping", description: "Ping command (disabled)" };
  }

  const pingCmd = new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with Pong, latency and uptime");

  const echoCmd = new SlashCommandBuilder()
    .setName("echo")
    .setDescription("Opens a modal to echo your text");

  commands.registerSlash("ping", pingCmd, echoCmd);

  // Interaction IDs (stable constants so handlers can be registered)
  const BTN_PING_DETAILS = "ping:details";
  const MODAL_ECHO = "ping:modal:echo";
  const MODAL_INPUT_ID = "ping:modal:input";

  // Slash handlers
  const removeSlashHandler = commands.onInteractionCreate("ping", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "ping") {
      const created = Date.now();
      const apiPing = Math.round(interaction.client.ws.ping);
      const uptimeMs = interaction.client.uptime || 0;
      const uptimeSec = Math.floor(uptimeMs / 1000);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(BTN_PING_DETAILS)
          .setLabel("Show details")
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.reply({
        content: `Pong! Gateway: ${apiPing}ms | Uptime: ${uptimeSec}s | Now: ${utils.now()}`,
        components: [row],
        ephemeral: true,
      });

      const roundTrip = Date.now() - created;
      logger.info(`Handled /ping in ${roundTrip}ms`);
      return;
    }

    if (interaction.commandName === "echo") {
      const modal = new ModalBuilder()
        .setCustomId(MODAL_ECHO)
        .setTitle("Echo modal");

      const input = new TextInputBuilder()
        .setCustomId(MODAL_INPUT_ID)
        .setLabel("What should I echo?")
        .setRequired(true)
        .setStyle(TextInputStyle.Paragraph);

      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);

      await interaction.showModal(modal);
      return;
    }
  });

  // Button handler via core interactions
  const removeButton = interactions.registerButton("ping", BTN_PING_DETAILS, async (interaction) => {
    const apiPing = Math.round(interaction.client.ws.ping);
    await interaction.reply({ content: `Additional details: Gateway ping ${apiPing}ms`, ephemeral: true });
  });

  // Modal handler via core interactions
  const removeModal = interactions.registerModal("ping", MODAL_ECHO, async (interaction) => {
    const value = interaction.fields.getTextInputValue(MODAL_INPUT_ID);
    await interaction.reply({ content: `You said: ${value}`, ephemeral: true });
  });

  return {
    name: "ping",
    description: "Ping, button and modal demo",
    dispose: async () => {
      try {
        removeSlashHandler?.();
      } catch (e) {
        logger.warn(`Error detaching slash handler: ${e?.message}`);
      }
      try { removeButton?.(); } catch {}
      try { removeModal?.(); } catch {}
      logger.info("Disposed ping module");
    },
    postReady: async () => {
      logger.info("Ping module ready");
    },
  };
}
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} from "discord.js";

/**
 * Comprehensive demo module that exercises all core services:
 * - logger (scoped child)
 * - config (flags, get/getBool)
 * - command handler (slash registration and interaction handler)
 * - interactions (buttons, selects, modals, context menus registration)
 * - events (client event listeners with cleanup)
 * - bus (pub/sub between modules)
 * - lifecycle/utils (tracked timers, listeners, safeAsync)
 *
 * Feature flag: MODULE_COMPASS_ENABLED
 */
export default async function init(ctx) {
  const { client, logger, config, commands, interactions, events, bus, lifecycle, utils } = ctx;

  const enabled = config.isEnabled("MODULE_COMPASS_ENABLED", true);
  if (!enabled) {
    logger.info("MODULE_COMPASS_ENABLED=false, skipping initialization");
    return { name: "compass", description: "Comprehensive demo module (disabled)" };
  }

  // ----------------------------------------------------------------------------
  // Slash commands
  // ----------------------------------------------------------------------------
  const cInfo = new SlashCommandBuilder()
    .setName("cinfo")
    .setDescription("Show demo module info and a button/select to interact")
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

  const cModal = new SlashCommandBuilder()
    .setName("cmodal")
    .setDescription("Open a demo modal");

  const cCtxUser = {
    name: "User Inspect",
    type: 2 // USER context menu
  };

  const cCtxMessage = {
    name: "Message Inspect",
    type: 3 // MESSAGE context menu
  };

  commands.registerSlash("compass", cInfo, cModal, cCtxUser, cCtxMessage);

  // Slash runtime handler: route by commandName
  const offSlashHandler = commands.onInteractionCreate("compass", async (interaction) => {
    if (interaction.isChatInputCommand?.() !== true) return;

    try {
      if (interaction.commandName === "cinfo") {
        const idBtn = "compass:btn:hello";
        const idSel = "compass:sel:choice";

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(idBtn).setLabel("Say Hello").setStyle(ButtonStyle.Success)
        );

        const row2 = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(idSel)
            .setPlaceholder("Pick a choice")
            .addOptions(
              { label: "Alpha", value: "alpha" },
              { label: "Beta", value: "beta" },
              { label: "Gamma", value: "gamma" }
            )
        );

        await interaction.reply({
          content: [
            "Compass module demo:",
            "- Uses slash, buttons, selects, modals, context menus",
            `- Time now: ${utils.now()}`,
          ].join("\n"),
          components: [row1, row2],
          ephemeral: true,
        });
        return;
      }

      if (interaction.commandName === "cmodal") {
        const modalId = "compass:modal:feedback";
        const inputId = "compass:modal:feedback:text";

        const modal = new ModalBuilder().setCustomId(modalId).setTitle("Compass Feedback");
        const input = new TextInputBuilder()
          .setCustomId(inputId)
          .setLabel("Your feedback")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);
        const row = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row);

        await interaction.showModal(modal);
        return;
      }
    } catch (err) {
      logger.error(`Slash handler error: ${err?.message}`, { stack: err?.stack });
      if (interaction.isRepliable?.() && !interaction.replied && !interaction.deferred) {
        try { await interaction.reply({ content: "An error occurred.", ephemeral: true }); } catch {}
      }
    }
  });

  // ----------------------------------------------------------------------------
  // Interactions: buttons, selects, modals, context menus
  // ----------------------------------------------------------------------------
  const offBtn = interactions.registerButton("compass", "compass:btn:hello", async (interaction) => {
    await interaction.reply({ content: "Hello from Compass button!", ephemeral: true });
    bus.publish("compass.clicked", { at: Date.now(), type: "button" });
  });

  const offSelect = interactions.registerSelect("compass", "compass:sel:choice", async (interaction) => {
    const choice = interaction.values?.[0];
    await interaction.reply({ content: `You picked: ${choice}`, ephemeral: true });
    bus.publish("compass.selected", { at: Date.now(), value: choice });
  });

  const offModal = interactions.registerModal("compass", "compass:modal:feedback", async (interaction) => {
    const text = interaction.fields.getTextInputValue("compass:modal:feedback:text");
    logger.info(`Feedback received: ${text}`);
    await interaction.reply({ content: "Thanks for your feedback!", ephemeral: true });
    bus.publish("compass.feedback", { at: Date.now(), text });
  });

  const offUserCtx = interactions.registerUserContext("compass", "User Inspect", async (interaction) => {
    const user = interaction.targetUser;
    await interaction.reply({ content: `User: ${user.tag} (${user.id})`, ephemeral: true });
  });

  const offMsgCtx = interactions.registerMessageContext("compass", "Message Inspect", async (interaction) => {
    const msg = interaction.targetMessage;
    await interaction.reply({ content: `Message ID: ${msg.id}\nAuthor: ${msg.author?.tag}`, ephemeral: true });
  });

  // ----------------------------------------------------------------------------
  // Events: client-level and timers via lifecycle
  // ----------------------------------------------------------------------------
  const offReady = events.on("compass", "ready", () => {
    logger.info("Compass observed client ready");
  });

  const offMsgCreate = events.on("compass", "messageCreate", async (message) => {
    if (message.author?.bot) return;
    if (/^!compass ping\b/i.test(message.content)) {
      await utils.safeAsync(async () => {
        await message.reply("Compass pong!");
      });
    }
  });

  // Interval with lifecycle tracking
  lifecycle.setInterval(() => {
    logger.info("Compass heartbeat tick");
  }, 60_000);

  // ----------------------------------------------------------------------------
  // Bus: demonstrate publish and subscribe
  // ----------------------------------------------------------------------------
  const unsubscribeBus = bus.subscribe("stats.ready", (payload) => {
    logger.info(`Bus event stats.ready: ${JSON.stringify(payload)}`);
  });

  lifecycle.addDisposable(unsubscribeBus);

  return {
    name: "compass",
    description: "Comprehensive demo module using all core services",
    dispose: async () => {
      try { offSlashHandler?.(); } catch {}
      try { offBtn?.(); } catch {}
      try { offSelect?.(); } catch {}
      try { offModal?.(); } catch {}
      try { offUserCtx?.(); } catch {}
      try { offMsgCtx?.(); } catch {}
      try { offReady?.(); } catch {}
      try { offMsgCreate?.(); } catch {}
      logger.info("Disposed compass module");
    },
    postReady: async () => {
      logger.info("Compass module postReady hook");
    },
  };
}
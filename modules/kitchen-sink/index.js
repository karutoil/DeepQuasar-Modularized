// /modules/kitchen-sink/index.js
// Comprehensive "kitchen-sink" example module demonstrating DeepQuasar core usage.
// Covers: builders (v2), DSL, interactions, UI helpers, events, bus, config, i18n,
// permissions, rate limiter, HTTP, Mongo, metrics, scheduler, state, error reporting, IDs,
// context menus, commandHandler install (guarded by flag).

import {
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
} from "discord.js";

// The module entrypoint. See HOW_TO_CREATE_A_MODULE.md for lifecycle details.
export default async function init(ctx) {
  const moduleName = "kitchen-sink";

  // Support both legacy and new ctx shapes:
  // - If ctx.createModuleContext exists (as per core/index.js), use it.
  // - Otherwise, assume ctx is already module-scoped and contains the services directly.
  const hasFactory = typeof ctx?.createModuleContext === "function";
  const mod = hasFactory ? ctx.createModuleContext(moduleName) : ctx;

  const {
    logger: baseLogger,
    config,
    v2,
    embed,
    dsl,
    interactions,
    commands,
    events,
    lifecycle,
    utils,
    bus,
    http,
    mongo,
    metrics,
    scheduler,
    permissions,
    i18n,
    ids,
    errorReporter,
    guildConfig,
  } = mod;

  // Feature gate
  const enabled = config.isEnabled("MODULE_KITCHEN_SINK_ENABLED", true);
  if (!enabled) {
    baseLogger.info("kitchen-sink module disabled via MODULE_KITCHEN_SINK_ENABLED");
    return {
      name: moduleName,
      description: "Comprehensive example module (disabled)",
    };
  }

  // Inline i18n registrations for this module
  // We prefix keys with module namespace for clarity
  i18n.register("en", {
    "kitchen.hello.title": "Hello",
    "kitchen.hello.desc": "Hello, {name}! Welcome to the Kitchen Sink module.",
    "kitchen.hello.prompt": "Do you want me to greet you?",
    "kitchen.hello.confirmed": "Greeting sent!",
    "kitchen.hello.cancelled": "Cancelled.",
    "kitchen.echo.title": "Echo",
    "kitchen.echo.desc": "Echoed: {message}",
    "kitchen.echo.modal_title": "Echo Transformer",
    "kitchen.echo.modal_field_label": "Append text",
    "kitchen.paginate.title": "Paginated Demo",
    "kitchen.http.title": "HTTP Demo",
    "kitchen.http.error": "HTTP request failed. Please try again later.",
    "kitchen.mongo.title": "Mongo Demo",
    "kitchen.mongo.ok": "Mongo operations completed successfully.",
    "kitchen.mongo.err": "Mongo operations failed.",
    "kitchen.perms.denied": "You lack the required permissions.",
    "kitchen.rate.limited": "You're doing that too much. Please slow down.",
    "kitchen.bus.greeted": "A user was greeted.",
    "kitchen.schedule.started": "Background job scheduled.",
    "kitchen.schedule.stopped": "Background job stopped.",
    "kitchen.userinfo": "User Info",
    "kitchen.messageinfo": "Message Info",
    "kitchen.pagination.page": "Page {index}",
  });

  i18n.register("es", {
    "kitchen.hello.title": "Hola",
    "kitchen.hello.desc": "¡Hola, {name}! Bienvenido al módulo Kitchen Sink.",
    "kitchen.hello.prompt": "¿Quieres que te salude?",
    "kitchen.hello.confirmed": "¡Saludo enviado!",
    "kitchen.hello.cancelled": "Cancelado.",
    "kitchen.echo.title": "Eco",
    "kitchen.echo.desc": "Eco: {message}",
    "kitchen.echo.modal_title": "Transformador de Eco",
    "kitchen.echo.modal_field_label": "Texto a agregar",
    "kitchen.paginate.title": "Demostración Paginada",
    "kitchen.http.title": "Demostración HTTP",
    "kitchen.http.error": "La solicitud HTTP falló. Inténtalo de nuevo más tarde.",
    "kitchen.mongo.title": "Demostración de Mongo",
    "kitchen.mongo.ok": "Operaciones de Mongo completadas con éxito.",
    "kitchen.mongo.err": "Las operaciones de Mongo fallaron.",
    "kitchen.perms.denied": "No tienes los permisos requeridos.",
    "kitchen.rate.limited": "Estás haciendo eso demasiado. Por favor, más despacio.",
    "kitchen.bus.greeted": "Un usuario fue saludado.",
    "kitchen.schedule.started": "Tarea en segundo plano programada.",
    "kitchen.schedule.stopped": "Tarea en segundo plano detenida.",
    "kitchen.userinfo": "Información de Usuario",
    "kitchen.messageinfo": "Información de Mensaje",
    "kitchen.pagination.page": "Página {index}",
  });

  // Metrics setup
  const mHello = metrics.counter("kitchen_hello_count");
  const mGreeted = metrics.counter("kitchen_greeted_count");
  const mHttpTimer = metrics.timer("kitchen_http_timer");
  const mMongoOps = metrics.counter("kitchen_mongo_ops");
  const mMongoErr = metrics.counter("kitchen_mongo_err");
  const mMessages = metrics.counter("kitchen_message_count");

  // Subscribe to our bus event example and auto-cleanup
  const unsubscribeGreeted = bus.subscribe("kitchen.user_greeted", (payload) => {
    mGreeted.inc();
    baseLogger.info("Bus event kitchen.user_greeted", payload);
  });
  lifecycle.addDisposable(unsubscribeGreeted);

  // Ready and messageCreate events
  events.once(moduleName, "ready", () => {
    baseLogger.info("Client ready (kitchen-sink).");
  });
  events.on(moduleName, "messageCreate", (message) => {
    if (message.author?.bot) return;
    mMessages.inc();
  });

  // Helper: embed builders via core/embed
  const eSuccess = (title, description) => embed.success({ title, description });
  const eError = (title, description) => embed.error({ title, description });
  const eInfo = (title, description) => embed.info({ title, description });
  const eWarn = (title, description) => embed.warn({ title, description });

  // Helper: common DSL wrappers composition
  // Note: dsl.withPreconditions can be appended via the v2 builder's addPrecondition too.
  const withBaseGuards = (handler, { userPerms = [], botPerms = [], cooldownKey } = {}) => {
    const guarded = dsl.withPerms(handler, { userPerms, botPerms });
    const cooled = dsl.withCooldown(guarded, {
      keyFn: (i) => cooldownKey || `${moduleName}:${i.user?.id}:${i.commandName || "unknown"}`,
      capacity: 2,
      refillPerSec: 0.5,
      message: i18n.safeT("kitchen.rate.limited", { defaultValue: "Rate limited" }),
    });
    return dsl.withTryCatch(dsl.withDeferredReply(cooled), {
      errorMessage: i18n.safeT("kitchen.http.error", { defaultValue: "An error occurred." }),
    });
  };

  // Command 1: /hello — demonstrates DSL, bus, button with state, confirmation
  const cmdHello = v2.createInteractionCommand()
    .setName("hello")
    .setDescription("Demonstrates DSL, confirmation, and stateful button")
    .addStringOption((opt) =>
      opt.setName("name").setDescription("Your name").setRequired(false)
    )
    .onExecute(async (interaction, args, state) => {
      const userLocale = interaction.locale || interaction.guild?.preferredLocale;
      const name = args.name || interaction.user?.username || "there";
      const title = i18n.t({ key: "kitchen.hello.title", moduleName, locale: userLocale });
      const desc = i18n.t({
        key: "kitchen.hello.desc",
        moduleName,
        locale: userLocale,
        params: { name },
      });

      // store some state for subsequent button handler
      await state?.set("greet_target", name);
      await state?.set("start_ts", Date.now());

      // Show confirmation prompt via core/ui for better ID scoping
      const { createConfirmationDialog } = v2.ui;
      const { message, dispose } = createConfirmationDialog(
        ctx,
        cmdHello,
        moduleName,
        i18n.t({ key: "kitchen.hello.prompt", moduleName, locale: userLocale }),
        async (i) => {
          // On confirm
          mHello.inc();
          bus.publish("kitchen.user_greeted", { userId: i.user?.id, at: new Date().toISOString() });

          // reply/update success
          try {
            await i.update({
              embeds: [eSuccess(title, desc)],
              components: [new ActionRowBuilder().addComponents(
                cmdHello.button(ctx, moduleName, "details", "Details", ButtonStyle.Primary)
              )],
            });
          } catch {
            await i.followUp({
              embeds: [eSuccess(title, desc)],
              ephemeral: true,
              components: [new ActionRowBuilder().addComponents(
                cmdHello.button(ctx, moduleName, "details", "Details", ButtonStyle.Primary)
              )],
            });
          }
        },
        async (i) => {
          // On cancel
          try {
            await i.update({ embeds: [eWarn(title, i18n.safeT("kitchen.hello.cancelled", { defaultValue: "Cancelled." }))], components: [] });
          } catch (err) { void err; }
        },
        { ephemeral: true }
      );

      // Initial reply with the confirmation dialog
      await interaction.reply(message);
      // ensure cleanup if needed on dispose
      lifecycle.addDisposable(dispose);
    })
    // Button "details": demonstrate reading state
    .onButton("details", async (interaction, state) => {
      const name = (await state?.get("greet_target")) || interaction.user?.username || "user";
      const start = Number(await state?.get("start_ts")) || Date.now();
      const duration = Date.now() - start;
      await interaction.update({
        content: `Hello details for ${name}. Round-trip duration: ${duration}ms.`,
        components: [],
      });
    })
    // An example precondition using v2 builder addPrecondition
    .addPrecondition(async (interaction) => {
      // Only allow in guilds for this demo
      if (!interaction.guildId) {
        return "This command can only be used in a server.";
      }
      return true;
    });

  // Command 2: /echo — options, autocomplete, modal flow, state, uppercase button, permissions and cooldown
  const cmdEcho = v2.createInteractionCommand()
    .setName("echo")
    .setDescription("Echoes your message, shows autocomplete and a modal transformer")
    .addStringOption((opt) =>
      opt.setName("message").setDescription("Message to echo").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("tag").setDescription("Optional tag (autocomplete)").setRequired(false).setAutocomplete(true)
    )
    .onAutocomplete("tag", async (interaction) => {
      const focusedValue = interaction.options.getFocused();
      const choices = ["news", "fun", "serious", "random", "longer-tag"];
      const filtered = choices.filter((c) => c.toLowerCase().startsWith(String(focusedValue || "").toLowerCase())).slice(0, 25);
      await interaction.respond(filtered.map((c) => ({ name: c, value: c })));
    })
    .onExecute(withBaseGuards(async (interaction, args, state) => {
      const msg = args.message;
      await state?.set("echo_msg", msg);

      // Build a form using core/ui
      const { createForm, parseModal } = await import("../../core/ui.js");
      const { modal, open, modalId } = createForm(ctx, cmdEcho, moduleName, {
        title: i18n.safeT("kitchen.echo.modal_title", { defaultValue: "Echo Transformer" }),
        fields: [
          { name: "append", label: i18n.safeT("kitchen.echo.modal_field_label", { defaultValue: "Append text" }), style: "short", required: false },
        ],
      });

      // Register a modal handler on this builder
      cmdEcho.onModal("form_submit", async (i, _state) => {
        const data = parseModal(i);
        const appended = data?.append ? `${msg} ${data.append}` : msg;
        await i.reply({
          embeds: [eInfo(
            i18n.safeT("kitchen.echo.title", { defaultValue: "Echo" }),
            i18n.safeT("kitchen.echo.desc", { defaultValue: "Echoed: {message}", params: { message: appended } })
          )],
          components: [new ActionRowBuilder().addComponents(
            cmdEcho.button(ctx, moduleName, "uppercase", "Uppercase", ButtonStyle.Secondary)
          )],
          ephemeral: true,
        });
      });

      // Show the modal
      await open(interaction);
      // Demonstrate standalone interactions: register a prefix button outside builder sugar
      const rawPrefix = `${moduleName}:${cmdEcho._name}:btn:raw_`; // will match startsWith
      const offRaw = interactions.registerButton(moduleName, rawPrefix, async (i) => {
        await i.reply({ content: "Raw prefix button clicked.", ephemeral: true });
      }, { prefix: true });
      lifecycle.addDisposable(offRaw);
    }, {
      userPerms: ["SendMessages"],
      botPerms: ["SendMessages"],
      cooldownKey: `${moduleName}:echo`,
    }))
    .onButton("uppercase", async (interaction, state) => {
      const msg = await state?.get("echo_msg");
      await interaction.update({
        embeds: [eInfo("Echo", `Uppercased: ${String(msg || "").toUpperCase()}`)],
        components: [],
      });
    });

  // Command 3: /paginate — demonstrate createPaginatedEmbed and multi-select
  const cmdPaginate = v2.createInteractionCommand()
    .setName("paginate")
    .setDescription("Shows a paginated embed with next/prev buttons and a multi-select menu")
    .onExecute(async (interaction) => {
      const pages = [
        new EmbedBuilder({ title: i18n.safeT("kitchen.paginate.title", { defaultValue: "Paginated Demo" }), description: i18n.safeT("kitchen.pagination.page", { defaultValue: "Page {index}", params: { index: 1 } }) }),
        new EmbedBuilder({ title: i18n.safeT("kitchen.paginate.title", { defaultValue: "Paginated Demo" }), description: i18n.safeT("kitchen.pagination.page", { defaultValue: "Page {index}", params: { index: 2 } }) }),
        new EmbedBuilder({ title: i18n.safeT("kitchen.paginate.title", { defaultValue: "Paginated Demo" }), description: i18n.safeT("kitchen.pagination.page", { defaultValue: "Page {index}", params: { index: 3 } }) }),
      ];
      const { createPaginatedEmbed, createMultiSelectMenu } = v2.ui;

      const { message: pageMsg, dispose: disposePager } = createPaginatedEmbed(ctx, cmdPaginate, moduleName, pages, { ephemeral: true, initialIndex: 0 });
      lifecycle.addDisposable(disposePager);

      const options = [
        { label: "Alpha", value: "alpha", description: "First option" },
        { label: "Beta", value: "beta", description: "Second option" },
        { label: "Gamma", value: "gamma", description: "Third option" },
      ];
      const { message: selectMsg, dispose: disposeSelect } = createMultiSelectMenu(ctx, cmdPaginate, moduleName, options, async (i, values) => {
        await i.reply({ content: `You selected: ${values.join(", ")}`, ephemeral: true });
      }, { placeholder: "Pick options", maxValues: 2, ephemeral: true });
      lifecycle.addDisposable(disposeSelect);

      // Send the paginated embed first, then follow with the select
      await interaction.reply(pageMsg);
      await interaction.followUp(selectMsg);
    });

  // Command 4: /httpbin — demonstrates HTTP client with timer and error reporting
  const cmdHttp = v2.createInteractionCommand()
    .setName("httpbin")
    .setDescription("Calls httpbin.org/get and shows basic results")
    .onExecute(
      dsl.withTryCatch(
        dsl.withDeferredReply(async (interaction) => {
          const stop = mHttpTimer.start();
          try {
            const res = await http.get("https://httpbin.org/get", { timeoutMs: 5000, retries: 2 });
            const data = typeof res?.json === "function" ? await res.json() : res?.data || res;
            const origin = data?.origin || "unknown";
            const url = data?.url || "N/A";
            await interaction.editReply({
              embeds: [eInfo(i18n.safeT("kitchen.http.title", { defaultValue: "HTTP Demo" }), `Origin: ${origin}\nURL: ${url}`)],
            });
          } catch (err) {
            await errorReporter.report(err, { scope: "httpbin" });
            await interaction.editReply({
              embeds: [eError("HTTP Error", i18n.safeT("kitchen.http.error", { defaultValue: "HTTP request failed. Please try again later." }))],
            });
          } finally {
            stop?.();
          }
        })
      )
    );

  // Command 5: /schedule — schedule a background job; include stop button
  let scheduledOff = null;
  const cmdSchedule = v2.createInteractionCommand()
    .setName("schedule")
    .setDescription("Starts or stops a background job (if enabled by flag)")
    .onExecute(async (interaction, _args, state) => {
      const allowed = config.isEnabled("MODULE_KITCHEN_SINK_SCHEDULE_ENABLED", false);
      if (!allowed) {
        await interaction.reply({ embeds: [eWarn("Scheduler", "Scheduling is disabled via MODULE_KITCHEN_SINK_SCHEDULE_ENABLED")], ephemeral: true });
        return;
      }

      // Store whether scheduled
      const running = Boolean(scheduledOff);
      if (!running) {
        // Schedule every minute
        const off = scheduler.schedule("* * * * *", () => {
          baseLogger.info("Scheduled job running (kitchen-sink).");
          bus.publish("kitchen.job.tick", { at: utils.now() });
        }, { timezone: "UTC", immediate: false });
        scheduledOff = off;
        lifecycle.addDisposable(() => { try { off?.(); } catch (err) { void err; } scheduledOff = null; });
        await interaction.reply({
          embeds: [eSuccess("Scheduler", i18n.safeT("kitchen.schedule.started", { defaultValue: "Background job scheduled." }))],
          components: [new ActionRowBuilder().addComponents(
            cmdSchedule.button(ctx, moduleName, "stop", "Stop Job", ButtonStyle.Danger)
          )],
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: "Job already running.",
          components: [new ActionRowBuilder().addComponents(
            cmdSchedule.button(ctx, moduleName, "stop", "Stop Job", ButtonStyle.Danger)
          )],
          ephemeral: true,
        });
      }

      await state?.set("has_job", true);
    })
    .onButton("stop", async (interaction) => {
      if (scheduledOff) {
        try { scheduledOff(); } catch (err) { void err; }
        scheduledOff = null;
        await interaction.update({
          embeds: [eInfo("Scheduler", i18n.safeT("kitchen.schedule.stopped", { defaultValue: "Background job stopped." }))],
          components: [],
        });
      } else {
        await interaction.update({
          embeds: [eWarn("Scheduler", "No job to stop.")],
          components: [],
        });
      }
    });

  // Command 6: /mongo — simple CRUD, metrics, and reporting
  const cmdMongo = v2.createInteractionCommand()
    .setName("mongo")
    .setDescription("Runs a small MongoDB CRUD demo")
    .onExecute(
      dsl.withTryCatch(
        dsl.withDeferredReply(async (interaction) => {
          try {
            const col = await mongo.getCollection("kitchen_demo");
            const doc = { createdAt: new Date(), userId: interaction.user?.id, note: "kitchen sink demo" };
            const ins = await col.insertOne(doc);
            const found = await col.findOne({ _id: ins.insertedId });
            await col.updateOne({ _id: ins.insertedId }, { $set: { note: "updated" } });
            const del = await col.deleteOne({ _id: ins.insertedId });
            mMongoOps.inc();

            await interaction.editReply({
              embeds: [eSuccess(i18n.safeT("kitchen.mongo.title", { defaultValue: "Mongo Demo" }), i18n.safeT("kitchen.mongo.ok", { defaultValue: "Mongo operations completed successfully." }))],
            });
          } catch (err) {
            mMongoErr.inc();
            await errorReporter.report(err, { scope: "mongo" });
            await interaction.editReply({
              embeds: [eError(i18n.safeT("kitchen.mongo.title", { defaultValue: "Mongo Demo" }), i18n.safeT("kitchen.mongo.err", { defaultValue: "Mongo operations failed." }))],
            });
          }
        })
      )
    );

  // Context menus: User Info and Message Info
  const offUserCtx = interactions.registerUserContext(moduleName, i18n.safeT("kitchen.userinfo", { defaultValue: "User Info" }), async (interaction) => {
    const user = interaction.targetUser;
    await interaction.reply({
      content: `User: ${user?.username} (${user?.id})`,
      ephemeral: true,
    });
  });
  lifecycle.addDisposable(offUserCtx);

  const offMsgCtx = interactions.registerMessageContext(moduleName, i18n.safeT("kitchen.messageinfo", { defaultValue: "Message Info" }), async (interaction) => {
    const msg = interaction.targetMessage;
    await interaction.reply({
      content: `Message ID: ${msg?.id}\nAuthor: ${msg?.author?.username}\nContent: ${msg?.content?.slice(0, 150) || "(no content)"}`,
      ephemeral: true,
    });
  });
  lifecycle.addDisposable(offMsgCtx);

  // Register builders and track disposables
  // Register builders and track disposables
  // If ctx doesn't expose createModuleContext, register directly through current module's v2 surface.
  const registrar = hasFactory ? mod.v2 : v2;
  lifecycle.addDisposable(registrar.register(cmdHello));
  lifecycle.addDisposable(registrar.register(cmdEcho));
  lifecycle.addDisposable(registrar.register(cmdPaginate));
  lifecycle.addDisposable(registrar.register(cmdHttp));
  lifecycle.addDisposable(registrar.register(cmdSchedule));
  lifecycle.addDisposable(registrar.register(cmdMongo));

  //baseLogger.info("kitchen-sink module loaded.");

  // Optional: postReady action to install commands to a specific guild via flag
  async function postReady() {
    const guildId = config.get("MODULE_KITCHEN_SINK_INSTALL_GUILD");
    if (guildId) {
      try {
        await commands.installGuild(guildId);
        baseLogger.info(`Installed kitchen-sink commands to guild ${guildId}`);
      } catch (err) {
        baseLogger.error(`Failed installing commands to guild ${guildId}: ${err?.message}`);
      }
    }
  }

  return {
    name: moduleName,
    description: "A comprehensive example module demonstrating DeepQuasar core features.",
    postReady,
    dispose: async () => {
      baseLogger.info("kitchen-sink module unloading...");
      await lifecycle.disposeAll();
      interactions.removeModule(moduleName);
      baseLogger.info("kitchen-sink module unloaded.");
    },
  };
}
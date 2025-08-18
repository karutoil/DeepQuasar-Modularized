/**
 * Debug command to test autocomplete functionality in the core system
 */
export function register(core) {
  const { _commands, logger, embed, v2 } = core;
  const MODULE_NAME = "core-debug";

  // Register using v2 builder pattern to test our autocomplete fix
  const debugCmd = v2.createInteractionCommand()
    .setName("autocomplete-debug")
    .setDescription("Test autocomplete functionality with debug output")
    .addStringOption(opt =>
      opt.setName("test-option")
        .setDescription("Test option with autocomplete")
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption(opt =>
      opt.setName("category")
        .setDescription("Test category selection")
        .setRequired(false)
        .setAutocomplete(true)
    )
    .onAutocomplete("test-option", async (interaction) => {
      logger.info("[AUTOCOMPLETE-DEBUG] test-option autocomplete triggered", {
        commandName: interaction.commandName,
        focusedValue: interaction.options.getFocused(),
        userId: interaction.user.id
      });

      const focusedValue = interaction.options.getFocused().toLowerCase();
      const choices = [
        { name: "Test Value 1", value: "test1" },
        { name: "Test Value 2", value: "test2" },
        { name: "Debug Option", value: "debug" },
        { name: "Autocomplete Works!", value: "works" },
        { name: "V2 Builder Success", value: "v2-success" }
      ];

      // Filter choices based on focused value
      const filtered = choices.filter(choice => 
        choice.name.toLowerCase().includes(focusedValue) ||
        choice.value.toLowerCase().includes(focusedValue)
      );

      logger.info("[AUTOCOMPLETE-DEBUG] Responding with choices", {
        focusedValue,
        choiceCount: filtered.length
      });

      await interaction.respond(filtered.slice(0, 25)); // Discord limit
    })
    .onAutocomplete("category", async (interaction) => {
      logger.info("[AUTOCOMPLETE-DEBUG] category autocomplete triggered", {
        commandName: interaction.commandName,
        focusedValue: interaction.options.getFocused()
      });

      const categories = [
        { name: "Core System", value: "core" },
        { name: "Modules", value: "modules" },
        { name: "Commands", value: "commands" },
        { name: "Interactions", value: "interactions" },
        { name: "Debugging", value: "debug" }
      ];

      await interaction.respond(categories);
    })
    .onExecute(async (interaction) => {
      if (interaction.options.getString("test-option") === "trigger-error") {
        throw new Error("This is a test error from the Loki integration!");
      }
      const testValue = interaction.options.getString("test-option");
      const category = interaction.options.getString("category");
      
      logger.info("[AUTOCOMPLETE-DEBUG] Command executed", {
        testValue,
        category,
        userId: interaction.user.id
      });

      const description = [
        `**Test Option:** ${testValue || "none"}`,
        `**Category:** ${category || "none"}`,
        "",
        "If autocomplete worked correctly, you should have seen:",
        "• Dynamic options when typing in 'test-option'",
        "• Category options when typing in 'category'",
        "",
        "Check the bot logs for detailed autocomplete flow information."
      ].join("\n");

      await interaction.reply({
        embeds: [embed.success({
          title: "🔧 Autocomplete Debug Results",
          description
        })],
        ephemeral: true
      });
    });

  // Register the debug command using v2 system
  const disposeDebug = v2.register(debugCmd);
  
  // Add to lifecycle for proper cleanup
  if (core.lifecycle?.addDisposable) {
    core.lifecycle.addDisposable(disposeDebug);
  }

  logger.info("[AUTOCOMPLETE-DEBUG] Debug command registered successfully", {
    module: MODULE_NAME,
    commandName: "autocomplete-debug"
  });

  return disposeDebug;
}
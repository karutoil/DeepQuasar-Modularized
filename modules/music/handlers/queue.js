import { PermissionFlagsBits } from "discord.js";
import { createListCommand } from "./queue/list.js";
import { createRemoveCommand } from "./queue/remove.js";
import { createClearCommand } from "./queue/clear.js";
import { createShuffleCommand } from "./queue/shuffle.js";
import { createSkipToCommand } from "./queue/skipto.js";

export function createQueueCommand(ctx) {
  const { v2, logger, music } = ctx;

  const cmdQueue = v2.createInteractionCommand()
    .setName("queue")
    .setDescription("Manage the music queue.");

  // /queue list
  cmdQueue.addOption((root) => {
    root.addSubcommand((sub) =>
      sub.setName("list")
        .setDescription("Displays the current song queue.")
        .addIntegerOption(opt =>
          opt.setName("page")
            .setDescription("The page number to display.")
            .setRequired(false)
        )
    );
  });

  // /queue remove
  cmdQueue.addOption((root) => {
    root.addSubcommand((sub) =>
      sub.setName("remove")
        .setDescription("Removes a specific song from the queue.")
        .addIntegerOption(opt => opt.setName("position").setDescription("The position of the song to remove.").setRequired(true))
    );
  });

  // /queue clear
  cmdQueue.addOption((root) => {
    root.addSubcommand((sub) =>
      sub.setName("clear")
        .setDescription("Clears the entire queue.")
    );
  });

  // /queue shuffle
  cmdQueue.addOption((root) => {
    root.addSubcommand((sub) =>
      sub.setName("shuffle")
        .setDescription("Shuffles the songs in the queue.")
    );
  });

  // /queue skipto
  cmdQueue.addOption((root) => {
    root.addSubcommand((sub) =>
      sub.setName("skipto")
        .setDescription("Skips to a specific song in the queue.")
        .addIntegerOption(opt => opt.setName("position").setDescription("The position of the song to skip to.").setRequired(true))
    );
  });

  // Wire execution (single entry point with subcommands)
  cmdQueue.onExecute(async (interaction) => {
    const sub = interaction.options.getSubcommand();
    if (sub === "list") {
      await createListCommand(ctx, cmdQueue)(interaction); // Pass ctx, cmdQueue and interaction
    } else if (sub === "remove") {
      await createRemoveCommand(ctx)(interaction);
    } else if (sub === "clear") {
      await createClearCommand(ctx)(interaction);
    } else if (sub === "shuffle") {
      await createShuffleCommand(ctx)(interaction);
    } else if (sub === "skipto") {
      await createSkipToCommand(ctx)(interaction);
    }
  });

  return cmdQueue;
}

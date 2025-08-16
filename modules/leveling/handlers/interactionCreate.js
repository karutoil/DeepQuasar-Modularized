import adminConfigCmd from '../commands/admin-config.js';
import userCommands from '../commands/user-commands.js';

export default async function interactionCreate(interaction, core, levelService) {
  // Forward to command modules (commandHandler v2 will typically route to registered execute handlers)
  try {
    if (!interaction?.isChatInputCommand?.()) return;
    const name = interaction.commandName;
    if (name === 'leveling') {
      await adminConfigCmd.execute(interaction, core, levelService);
      return;
    }
    // user commands handled via userCommands
    await userCommands.execute(interaction, core, levelService);
  } catch (err) {
    core.logger.error('[leveling] interactionCreate failed', { err: err?.message, stack: err?.stack });
  }
}

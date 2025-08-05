/**
 * /vc-setup slash command registration and entry point to open the admin UI.
 * Mirrored from tickets' setup pattern.
 */
import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { settingsService } from "../services/settingsService.js";
import { components } from "../utils/components.js";
import { ids } from "../utils/ids.js";

export async function registerSetupCommand(ctx) {
  const { client, logger, interactions, commands, lifecycle } = ctx;
  const moduleName = "temp-vc";
  const settings = settingsService(ctx);

  // Register slash command builder (core/commandHandler should support dynamic registration)
  const data = new SlashCommandBuilder()
    .setName("vc-setup")
    .setDescription("Configure Temporary Voice Channels (admin)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false);

  // Register with command router (builder JSON only). Handler wired via v2Execute.
  try {
    commands?.registerSlash?.(moduleName, data);
    const disposeExec = commands?.v2RegisterExecute?.("vc-setup", async (interaction) => {
      try {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return await interaction.reply({ content: "You need Manage Server to use this.", ephemeral: true });
        }
        const conf = await settings.get(interaction.guildId);
        const view = components.adminSetupView(conf, interaction.guild);
        await interaction.reply({ ...view, ephemeral: true });
      } catch (e) {
        logger.error("[TempVC] /vc-setup error", { error: e?.message });
        try { await interaction.reply({ content: "Failed to open setup.", ephemeral: true }); } catch {}
      }
    });
    lifecycle.addDisposable(() => { try { disposeExec?.(); } catch {} });
  } catch (e) {
    logger.error("[TempVC] Failed to register /vc-setup", { error: e?.message });
  }

  // Register the admin menu handlers (buttons/selects) under this file's scope? No,
  // defer to handlers/adminMenus.js which will mount via interactions service.

  const disposer = () => {};
  lifecycle.addDisposable(disposer);
  return disposer;
}
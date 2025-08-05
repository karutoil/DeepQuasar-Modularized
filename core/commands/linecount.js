import { SlashCommandBuilder } from "discord.js";
import fs from "fs";
import path from "path";
import readline from "readline";

/**
 * Register the /linecount command.
 * Everyone can invoke. It reports per-folder line counts for .js and .cjs files
 * in: bin/**, core/**, modules/**, plus a grand total.
 *
 * Expected usage:
 *   This file should be imported by your bootstrap where you have access to the
 *   module context (from core.createModuleContext('core')) and then called:
 *     register(coreContext);
 *
 * It registers the slash command JSON via commands.registerSlash and hooks the
 * handler with commands.v2RegisterExecute.
 */
export function register(core) {
  const { commands, logger } = core;
  const MODULE_NAME = "core-utilities";

  // Register the slash command definition
  commands.registerSlash(
    MODULE_NAME,
    new SlashCommandBuilder()
      .setName("linecount")
      .setDescription("Count lines of .js and .cjs files in bin, core, and modules folders")
      .setDMPermission(true)
      .toJSON()
  );

  // Wire the execute handler using v2 router
  commands.v2RegisterExecute("linecount", async (interaction) => {
    try {
      await interaction.deferReply({ ephemeral: false });

      const roots = ["bin", "core", "modules"];
      const extensions = new Set([".js", ".cjs"]);

      // Track stats per folder root
      const perFolder = {
        bin: { lines: 0, files: 0, dirs: 0 },
        core: { lines: 0, files: 0, dirs: 0 },
        modules: { lines: 0, files: 0, dirs: 0 },
      };

      // Walk a directory recursively and collect stats (lines/files/dirs) for matching files
      async function walkAndCount(rootDir) {
        const absRoot = path.resolve(process.cwd(), rootDir);
        let sumLines = 0;
        let fileCount = 0;
        let dirCount = 0;

        async function walk(dir) {
          let entries;
          try {
            entries = await fs.promises.readdir(dir, { withFileTypes: true });
          } catch (err) {
            // Directory may not exist or unreadable, treat as zero
            return;
          }

          // Count this directory (exclude the root path itself to keep "dirs" intuitive as subdirectories)
          if (dir !== absRoot) dirCount++;

          // Process entries sequentially to avoid deep recursion overwhelming the event loop on very large trees
          for (const ent of entries) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
              const base = ent.name;
              // Skip common irrelevant/huge directories
              if (base === "node_modules" || base === ".git" || base === "dist" || base === "build" || base === "coverage" || base === ".next" || base === ".turbo") {
                continue;
              }
              await walk(full);
            } else if (ent.isFile()) {
              const ext = path.extname(ent.name).toLowerCase();
              if (extensions.has(ext)) {
                fileCount++;
                sumLines += await countFileLines(full);
              }
            }
          }
        }

        await walk(absRoot);
        return { lines: sumLines, files: fileCount, dirs: dirCount };
      }

      async function countFileLines(filePath) {
        // Stream the file line-by-line for accurate counting across platforms
        return new Promise((resolve) => {
          let count = 0;
          const stream = fs.createReadStream(filePath);
          stream.on("error", (err) => {
            logger.warn(`linecount: failed to read ${filePath}: ${err?.message}`);
            resolve(0);
          });
          const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
          rl.on("line", () => { count++; });
          rl.on("close", () => { resolve(count); });
        });
      }

      // Compute per-folder stats
      for (const root of roots) {
        try {
          const stats = await walkAndCount(root);
          perFolder[root] = stats;
        } catch (err) {
          logger.warn(`linecount: failed to traverse ${root}: ${err?.message}`);
          perFolder[root] = { lines: 0, files: 0, dirs: 0 };
        }
      }

      const totals = {
        lines: perFolder.bin.lines + perFolder.core.lines + perFolder.modules.lines,
        files: perFolder.bin.files + perFolder.core.files + perFolder.modules.files,
        dirs: perFolder.bin.dirs + perFolder.core.dirs + perFolder.modules.dirs,
      };

      // Build a rich embed
      const embed = {
        title: "Repository Stats (.js, .cjs)",
        description: "Recursive totals for selected roots",
        color: 0x5865F2, // Discord blurple-ish
        fields: [
          {
            name: "bin",
            value:
              `Lines: ${perFolder.bin.lines.toLocaleString()}\n` +
              `Files: ${perFolder.bin.files.toLocaleString()}\n` +
              `Folders: ${perFolder.bin.dirs.toLocaleString()}`,
            inline: true,
          },
          {
            name: "core",
            value:
              `Lines: ${perFolder.core.lines.toLocaleString()}\n` +
              `Files: ${perFolder.core.files.toLocaleString()}\n` +
              `Folders: ${perFolder.core.dirs.toLocaleString()}`,
            inline: true,
          },
          {
            name: "modules",
            value:
              `Lines: ${perFolder.modules.lines.toLocaleString()}\n` +
              `Files: ${perFolder.modules.files.toLocaleString()}\n` +
              `Folders: ${perFolder.modules.dirs.toLocaleString()}`,
            inline: true,
          },
          {
            name: "Totals",
            value:
              `Lines: ${totals.lines.toLocaleString()}\n` +
              `Files: ${totals.files.toLocaleString()}\n` +
              `Folders: ${totals.dirs.toLocaleString()}`,
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: "linecount • includes only .js and .cjs",
        },
      };

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      try {
        await interaction.editReply({ content: `Error computing line counts: ${err?.message ?? "unknown error"}` });
      } catch {
        // ignore
      }
    }
  });

  logger.info("Registered /linecount command (core-utilities)");
}

export default { register };
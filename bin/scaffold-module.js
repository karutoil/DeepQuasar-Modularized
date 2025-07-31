#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function toFlagName(name) {
  return `MODULE_${name.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase()}_ENABLED`;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFileIfAbsent(p, content) {
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, content, "utf8");
  } else {
    console.error(`File already exists: ${p}`);
  }
}

function esmTemplate(name, flag) {
  return `import { SlashCommandBuilder } from "discord.js";

/**
 * ${name} module
 * Feature flag: ${flag}
 */
export default async function init(ctx) {
  const { logger, config, commands } = ctx;

  const enabled = config.isEnabled("${flag}", true);
  if (!enabled) {
    logger.info("${flag}=false, skipping initialization");
    return { name: "${name}", description: "${name} module (disabled)" };
  }

  // Example slash command
  const cmd = new SlashCommandBuilder()
    .setName("${name}")
    .setDescription("${name} command example");

  commands.registerSlash("${name}", cmd);

  const remove = commands.onInteractionCreate("${name}", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "${name}") return;
    await interaction.reply({ content: "Hello from ${name} module!", ephemeral: true });
  });

  return {
    name: "${name}",
    description: "${name} module",
    dispose: async () => {
      try { remove?.(); } catch {}
      logger.info("Disposed ${name} module");
    },
    postReady: async () => {
      logger.info("${name} module ready");
    }
  };
}
`;
}

function cjsTemplate(name, flag) {
  return `/**
 * ${name} module (CommonJS)
 * Feature flag: ${flag}
 */
module.exports = async function init(ctx) {
  const { logger, config, commands } = ctx;

  const enabled = config.isEnabled("${flag}", true);
  if (!enabled) {
    logger.info("${flag}=false, skipping initialization");
    return { name: "${name}", description: "${name} module (disabled)" };
  }

  // Example: since SlashCommandBuilder is ESM, prefer raw JSON for CJS templates
  const cmd = {
    name: "${name}",
    description: "${name} command example",
    dm_permission: true
  };

  commands.registerSlash("${name}", cmd);

  const remove = commands.onInteractionCreate("${name}", async (interaction) => {
    if (!interaction.isChatInputCommand || !interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "${name}") return;
    await interaction.reply({ content: "Hello from ${name} module!", ephemeral: true });
  });

  return {
    name: "${name}",
    description: "${name} module",
    dispose: async () => {
      try { remove && remove(); } catch {}
      logger.info("Disposed ${name} module");
    },
    postReady: async () => {
      logger.info("${name} module ready");
    }
  };
};
`;
}

function envTemplate(flag) {
  return `# Enable/disable this module
${flag}=true
`;
}

function readmeTemplate(name, flag) {
  return `# ${name} module

Feature flag: \`${flag}\`

Enable/disable in your root .env:
\`\`\`
${flag}=true
\`\`\`

This module is self-contained and can be removed safely by deleting the directory or setting the flag to false.
`;
}

async function main() {
  const program = new Command();
  program
    .name("scaffold-module")
    .description("Scaffold a new module for the modular Discord bot")
    .argument("<name>", "module name (folder name and command name)")
    .option("--cjs", "create a CommonJS module (index.cjs) instead of ESM (index.js)")
    .action((name, opts) => {
      const moduleName = name.trim();
      if (!moduleName) {
        console.error("Invalid module name.");
        process.exit(1);
      }

      const modulesDir = path.join(ROOT, "modules");
      ensureDir(modulesDir);

      const dir = path.join(modulesDir, moduleName);
      ensureDir(dir);

      const flag = toFlagName(moduleName);

      if (opts.cjs) {
        writeFileIfAbsent(path.join(dir, "index.cjs"), cjsTemplate(moduleName, flag));
      } else {
        writeFileIfAbsent(path.join(dir, "index.js"), esmTemplate(moduleName, flag));
      }
      writeFileIfAbsent(path.join(dir, "module.env.example"), envTemplate(flag));
      writeFileIfAbsent(path.join(dir, "README.md"), readmeTemplate(moduleName, flag));

      console.log(`Module scaffolded at: ${dir}`);
      console.log(`Feature flag: ${flag}`);
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error("Scaffold error:", err);
  process.exit(1);
});
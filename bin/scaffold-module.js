#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import readline from "node:readline";

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

function askYesNo(rl, question) {
  return new Promise((resolve) => {
    rl.question(`${question} (y/N): `, (answer) => {
      const v = String(answer || "").trim().toLowerCase();
      resolve(v === "y" || v === "yes");
    });
  });
}

function esmBaseTemplate(name, flag) {
  return `/**
 * ${name} module
 * Feature flag: ${flag}
 */
export default async function init(ctx) {
  const { logger, config } = ctx;
  const enabled = config.isEnabled("${flag}", true);
  if (!enabled) {
    logger.info("${flag}=false, skipping initialization");
    return { name: "${name}", description: "${name} module (disabled)" };
  }

  const moduleName = "${name}";
  const b = ctx.v2.createInteractionCommand()
    .setName("${name}")
    .setDescription("${name} command");

  // onExecute is required for slash command
  b.onExecute(async (interaction, args, state) => {
    await interaction.reply({ content: "Hello from ${name}!", ephemeral: true });
  });

  const off = ctx.createModuleContext(moduleName).v2.register(b);

  return {
    name: moduleName,
    description: "${name} module",
    dispose: async () => { try { off?.(); } catch {} }
  };
}
`;
}

function cjsBaseTemplate(name, flag) {
  return `/**
 * ${name} module (CommonJS)
 * Feature flag: ${flag}
 */
module.exports = async function init(ctx) {
  const { logger, config } = ctx;
  const enabled = config.isEnabled("${flag}", true);
  if (!enabled) {
    logger.info("${flag}=false, skipping initialization");
    return { name: "${name}", description: "${name} module (disabled)" };
  }

  const moduleName = "${name}";
  const b = ctx.v2.createInteractionCommand()
    .setName("${name}")
    .setDescription("${name} command");

  b.onExecute(async (interaction, args, state) => {
    await interaction.reply({ content: "Hello from ${name}!", ephemeral: true });
  });

  const off = ctx.createModuleContext(moduleName).v2.register(b);

  return {
    name: moduleName,
    description: "${name} module",
    dispose: async () => { try { off && off(); } catch {} }
  };
};
`;
}

function addPaginationSnippet() {
  return `
// Pagination example
b.onExecute(async (interaction, args, state) => {
  const pages = [
    { description: "Page 1" },
    { description: "Page 2" },
    { description: "Page 3" },
  ];
  const { message } = ctx.v2.ui.createPaginatedEmbed(ctx, b, moduleName, pages, { ephemeral: true });
  await interaction.reply(message);
});
`;
}

function addStatefulSnippet() {
  return `
// Stateful example (remember user)
b.onExecute(async (interaction, args, state) => {
  state.set("user", interaction.user.username);
  const btn = b.button(ctx, moduleName, "shout", "Shout!");
  await interaction.reply({ content: "Stored your name. Click to shout.", components: [{ type: 1, components: [btn] }], ephemeral: true });
});
b.onButton("shout", async (interaction, state) => {
  const who = state.get("user") || "there";
  await interaction.update({ content: "HELLO " + String(who).toUpperCase() + "!", components: [] });
});
`;
}

function addFormSnippet() {
  return `
// Form example
b.onExecute(async (interaction) => {
  const fields = [
    { name: "title", label: "Title", style: "short", required: true },
    { name: "details", label: "Details", style: "paragraph", required: false },
  ];
  const { message, open } = ctx.v2.ui.createForm(ctx, b, moduleName, { title: "Submit Info", fields });
  await interaction.reply(message);
  await open(interaction);
});
b.onModal("form_submit", async (interaction) => {
  const parsed = ctx.v2.ui.parseModal(interaction);
  await interaction.reply({ content: "Received form: " + JSON.stringify(parsed), ephemeral: true });
});
`;
}

function addWizardSnippet() {
  return `
// Wizard example
b.onExecute(async (interaction, args, state) => {
  const wizard = ctx.v2.ui.createWizard(ctx, b, moduleName, state, [
    {
      render: () => ({ content: "Step 1: Confirm to continue", ...ctx.v2.ui.createConfirmationDialog(ctx, b, moduleName, "Go to step 2?", null, null, { ephemeral: true }).message }),
      onNext: async () => {},
    },
    {
      render: () => ({ content: "Step 2 complete. Finish?", ephemeral: true }),
    }
  ]);
  await wizard.start(interaction);
});
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

Scaffolded with v2 builder. See docs/MODULE_CREATION_GUIDE.md for usage.
`;
}

async function main() {
  const program = new Command();
  program
    .name("scaffold-module")
    .description("Scaffold a new module for the modular Discord bot")
    .argument("<name>", "module name (folder name and command name)")
    .option("--cjs", "create a CommonJS module (index.cjs) instead of ESM (index.js)")
    .option("--yes", "accept defaults without prompting")
    .action(async (name, opts) => {
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

      // Interactive prompts
      let wantsPagination = false;
      let wantsStateful = false;
      let wantsForm = false;
      let wantsWizard = false;

      if (opts.yes) {
        // defaults: only base command
      } else {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        wantsPagination = await askYesNo(rl, "Add paginated embed example?");
        wantsStateful = await askYesNo(rl, "Add stateful button example?");
        wantsForm = await askYesNo(rl, "Add form (modal) example?");
        wantsWizard = await askYesNo(rl, "Add wizard (multi-step) example?");
        rl.close();
      }

      let content;
      if (opts.cjs) {
        content = cjsBaseTemplate(moduleName, flag);
      } else {
        content = esmBaseTemplate(moduleName, flag);
      }

      // inject snippets near end before return registration comment if present
      const injectionPoint = "const off = ctx.createModuleContext(moduleName).v2.register(b);";
      if (content.includes(injectionPoint)) {
        const snippets = [];
        if (wantsPagination) snippets.push(addPaginationSnippet());
        if (wantsStateful) snippets.push(addStatefulSnippet());
        if (wantsForm) snippets.push(addFormSnippet());
        if (wantsWizard) snippets.push(addWizardSnippet());
        content = content.replace(injectionPoint, snippets.join("\n") + "\n  " + injectionPoint);
      }

      if (opts.cjs) {
        writeFileIfAbsent(path.join(dir, "index.cjs"), content);
      } else {
        writeFileIfAbsent(path.join(dir, "index.js"), content);
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
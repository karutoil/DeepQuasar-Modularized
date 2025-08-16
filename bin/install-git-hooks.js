#!/usr/bin/env node
// Simple installer to copy scripts/git-hooks/* into .git/hooks
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const hooksSrc = path.join(repoRoot, 'scripts', 'git-hooks');
const gitHooksDir = path.join(repoRoot, '.git', 'hooks');

function install() {
  if (!fs.existsSync(gitHooksDir)) {
    console.error('.git/hooks directory not found, are you in a git repo?');
    process.exit(1);
  }

  const files = fs.readdirSync(hooksSrc);
  files.forEach((file) => {
    const src = path.join(hooksSrc, file);
    const dest = path.join(gitHooksDir, file);
    try {
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o755);
      console.log(`Installed hook: ${file}`);
    } catch (err) {
      console.error(`Failed to install ${file}:`, err.message || err);
    }
  });
}

install();

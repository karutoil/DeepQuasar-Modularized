#!/usr/bin/env node
// Bump patch version in package.json and stage the file so the change is included in the commit.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..');
const pkgPath = path.join(repoRoot, 'package.json');

function readPkg() {
  const raw = fs.readFileSync(pkgPath, 'utf8');
  return JSON.parse(raw);
}

function writePkg(pkg) {
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

function bumpMinor(ver) {
  // Bump the second (minor) version component: x.y.z -> x.(y+1).0
  if (!ver) return '0.1.0';
  const parts = ver.split('.').map((p) => parseInt(p, 10) || 0);
  // Ensure we have at least major, minor, patch
  while (parts.length < 3) parts.push(0);
  parts[1] = (parts[1] || 0) + 1;
  parts[2] = 0;
  return parts.slice(0, 3).join('.');
}

try {
  const pkg = readPkg();
  const old = String(pkg.version || '0.0.0');
  const next = bumpMinor(old);
  pkg.version = next;
  writePkg(pkg);

  // Stage package.json so the modified version is included in the commit
  try {
    execSync('git add package.json', { stdio: 'ignore' });
  } catch (err) {
    // If git isn't available or this isn't a git repo, print minimal info and fail.
    console.error('[pre-commit-bump] git add failed:', err.message || err);
    process.exitCode = 1;
  }

  // Print the version bump for CI/logs
  console.log(`[pre-commit-bump] bumped version ${old} -> ${next}`);
} catch (err) {
  console.error('[pre-commit-bump] error:', err && err.message ? err.message : err);
  process.exitCode = 2;
}

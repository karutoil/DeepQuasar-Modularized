#!/usr/bin/env node
/*
Simple command docs generator for DeepQuasar-Modularized.
- Scans repository JS files for "createInteractionCommand" and "new SlashCommandBuilder" usages.
- Extracts command name, description, options, subcommands heuristically via regex.
- Writes per-module markdown files to docs/commmands/<module>.md

This is intentionally lightweight and best-effort. Run from repo root:
  node scripts/generate-command-docs.js
*/

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'docs', 'commmands');

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'build'].includes(e.name)) continue;
      files.push(...walk(full));
    } else if (e.isFile() && full.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

function ensureOut() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
}

function extractCommandsFromFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const rel = path.relative(ROOT, filePath);
  const moduleName = (() => {
    const m = rel.split(path.sep);
    const idx = m.indexOf('modules');
    if (idx >= 0 && m.length > idx + 1) return m[idx + 1];
    if (m[0] === 'core' || m[0] === 'bin') return 'core';
    return 'misc';
  })();

  const results = [];

  // Find createInteractionCommand occurrences
  const createRegex = /createInteractionCommand\s*\(/g;
  let m;
  while ((m = createRegex.exec(src)) !== null) {
    const idx = m.index;
    // heuristic window
    const window = src.slice(Math.max(0, idx - 200), idx + 4000);
    const nameMatch = window.match(/\.setName\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    const descMatch = window.match(/\.setDescription\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    const cmdName = nameMatch ? nameMatch[1] : null;
    const cmdDesc = descMatch ? descMatch[1] : null;

    // options and subcommands: search broader area (from idx to next 8000 chars)
    const block = src.slice(idx, Math.min(src.length, idx + 8000));

    const optionRegex = /\.add(String|Integer|User|Channel|Role|Boolean|Number|Mentionable|Attachment)Option\s*\(\s*(?:opt|\w+)\s*=>\s*\w*\.setName\(\s*['"`]([^'"`]+)['"`]\s*\)([\s\S]*?)\)/g;
    const options = [];
    let om;
    while ((om = optionRegex.exec(block)) !== null) {
      const kind = om[1];
      const name = om[2];
      const tail = om[3] || '';
      const req = /\.setRequired\s*\(\s*(true)\s*\)/.test(tail);
      const auto = /\.setAutocomplete\s*\(\s*(true)\s*\)/.test(tail);
      const min = (tail.match(/\.setMinValue\s*\(\s*([0-9]+)\s*\)/) || [])[1];
      const max = (tail.match(/\.setMaxValue\s*\(\s*([0-9]+)\s*\)/) || [])[1];
      options.push({ name, kind, required: !!req, autocomplete: !!auto, min, max });
    }

    // subcommands inside addSubcommand(...) patterns
    const subRegex = /\.addSubcommand\s*\(\s*(?:sub\s*=>\s*sub|\w+)\s*\.setName\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*([\s\S]*?)\)/g;
    const subs = [];
    let sm;
    while ((sm = subRegex.exec(block)) !== null) {
      const subName = sm[1];
      const subBlock = sm[2] || '';
      const subOptions = [];
      const subOptRegex = /\.add(String|Integer|User|Channel|Role|Boolean|Number|Mentionable|Attachment)Option\s*\(\s*(?:opt|\w+)\s*=>\s*\w*\.setName\(\s*['"`]([^'"`]+)['"`]\s*\)([\s\S]*?)\)/g;
      let som;
      while ((som = subOptRegex.exec(subBlock)) !== null) {
        const kind = som[1];
        const name = som[2];
        const tail = som[3] || '';
        const req = /\.setRequired\s*\(\s*(true)\s*\)/.test(tail);
        const auto = /\.setAutocomplete\s*\(\s*(true)\s*\)/.test(tail);
        subOptions.push({ name, kind, required: !!req, autocomplete: !!auto });
      }
      subs.push({ name: subName, options: subOptions });
    }

    results.push({ module: moduleName, name: cmdName, description: cmdDesc, options, subcommands: subs, file: rel });
  }

  // Also detect new SlashCommandBuilder usages (e.g., ticket-setup)
  const slashRegex = /new\s+SlashCommandBuilder\s*\(\s*\)\s*([\s\S]{0,8000})/g;
  while ((m = slashRegex.exec(src)) !== null) {
    const block = m[1];
    const nameMatch = block.match(/\.setName\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    const descMatch = block.match(/\.setDescription\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    if (nameMatch) {
      const cmdName = nameMatch[1];
      const cmdDesc = descMatch ? descMatch[1] : null;
      // find options/subcommands similarly by scanning the surrounding 2000 chars
      const startIdx = m.index;
      const wider = src.slice(startIdx, Math.min(src.length, startIdx + 8000));
      const optionRegex = /\.add(String|Integer|User|Channel|Role|Boolean|Number|Mentionable|Attachment)Option\s*\(\s*(?:opt|\w+)\s*=>\s*\w*\.setName\(\s*['"`]([^'"`]+)['"`]\s*\)([\s\S]*?)\)/g;
      const options = [];
      let om;
      while ((om = optionRegex.exec(wider)) !== null) {
        const kind = om[1];
        const name = om[2];
        const tail = om[3] || '';
        const req = /\.setRequired\s*\(\s*(true)\s*\)/.test(tail);
        const auto = /\.setAutocomplete\s*\(\s*(true)\s*\)/.test(tail);
        options.push({ name, kind, required: !!req, autocomplete: !!auto });
      }
      results.push({ module: moduleName, name: cmdName, description: cmdDesc, options, subcommands: [], file: rel });
    }
  }

  return results;
}

function groupByModule(cmds) {
  const map = new Map();
  for (const c of cmds) {
    const key = c.module || 'misc';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(c);
  }
  return map;
}

function writeModuleDocs(map) {
  ensureOut();
  for (const [moduleName, cmds] of map.entries()) {
    const lines = [];
    lines.push(`## Module: ${moduleName}`);
    lines.push('');
    for (const c of cmds) {
      const name = c.name || '(unknown)';
      lines.push(`### /${name}`);
      if (c.description) lines.push(`- Description: ${c.description}`);
      if (c.options && c.options.length) {
        lines.push('- Options:');
        for (const o of c.options) {
          lines.push(`  - ${o.name} (${o.kind}) — ${o.required ? 'required' : 'optional'}${o.autocomplete ? ' — autocomplete' : ''}${o.min || o.max ? ` — range ${o.min || '-'}..${o.max || '-'}` : ''}`);
        }
      }
      if (c.subcommands && c.subcommands.length) {
        lines.push('- Subcommands:');
        for (const s of c.subcommands) {
          lines.push(`  - ${s.name}`);
          if (s.options && s.options.length) {
            for (const so of s.options) {
              lines.push(`    - ${so.name} (${so.kind}) — ${so.required ? 'required' : 'optional'}${so.autocomplete ? ' — autocomplete' : ''}`);
            }
          }
        }
      }
      lines.push(`- Source: ${c.file}`);
      lines.push('');
    }

    const outPath = path.join(OUT_DIR, `${moduleName}.md`);
    fs.writeFileSync(outPath, lines.join('\n'));
    console.log(`Wrote ${outPath}`);
  }
}

function main() {
  console.log('Scanning repository for command builders...');
  const files = walk(ROOT);
  const all = [];
  for (const f of files) {
    try {
      const items = extractCommandsFromFile(f);
      for (const it of items) all.push(it);
    } catch (e) {
      console.error('Error parsing', f, e.message);
    }
  }
  const grouped = groupByModule(all);
  writeModuleDocs(grouped);
  console.log('Done.');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] && process.argv[1].endsWith('generate-command-docs.js')) {
  main();
}

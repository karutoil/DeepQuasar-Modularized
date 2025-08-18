#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const reportPath = path.resolve(process.cwd(), '.eslint-report.json');
if (!fs.existsSync(reportPath)) {
  console.error('.eslint-report.json not found. Run eslint with JSON formatter first.');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

// Collect fixes: { filePath: [{line, column, name}] }
const fixes = Object.create(null);
for (const file of report) {
  const filePath = file.filePath;
  for (const msg of file.messages) {
    if (!msg.ruleId) continue;
    // target the unused-vars rule from unused-imports plugin
    if (msg.ruleId === 'unused-imports/no-unused-vars') {
      // try to extract variable name from message: "'name' is assigned..." or "'name' is defined..."
      const m = msg.message.match(/'(.*?)'|`(.*?)`/);
      let name = null;
      if (m) name = m[1] || m[2];
      else {
        // fallback: look for words in message
        const m2 = msg.message.match(/\b([A-Za-z_$][A-Za-z0-9_$]*)\b/);
        if (m2) name = m2[1];
      }
      if (!name) continue;
      fixes[filePath] = fixes[filePath] || [];
      fixes[filePath].push({ line: msg.line, column: msg.column, name });
    }
  }
}

if (Object.keys(fixes).length === 0) {
  console.log('No unused-imports/no-unused-vars warnings found in report.');
  process.exit(0);
}

let total = 0;
for (const [filePath, items] of Object.entries(fixes)) {
  if (!fs.existsSync(filePath)) continue;
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  // sort items by line desc so offsets don't affect earlier edits
  items.sort((a,b) => (a.line - b.line) || (b.column - a.column));
  const lineGroups = new Map();
  for (const it of items) {
    const key = it.line;
    if (!lineGroups.has(key)) lineGroups.set(key, []);
    lineGroups.get(key).push(it);
  }
  for (const [lineNum, group] of lineGroups.entries()) {
    const idx = lineNum - 1;
    if (idx < 0 || idx >= lines.length) continue;
    let line = lines[idx];
    // Sort by column descending to avoid shifting earlier columns
    group.sort((a,b) => b.column - a.column);
    for (const it of group) {
      const col = Math.max(1, it.column) - 1; // make 0-index
      // Attempt to locate the identifier at or after column
/*       const before = line.slice(0, col); */
      const after = line.slice(col);
      const name = it.name;
      const regex = new RegExp("\\b" + name.replace(/[$^\\.*+?()[\]{}|]/g, '\\$&') + "\\b");
      const m = after.match(regex);
      if (m) {
        const start = col + m.index;
/*         const end = start + name.length;
 */        // ensure we don't double-underscore
        if (line.slice(start-1, start) === '_' ) continue;
        line = line.slice(0, start) + '_' + line.slice(start);
        total++;
      } else {
        // fallback: try to replace the first occurrence in the line if present
        const idx2 = line.indexOf(name);
        if (idx2 !== -1) {
          if (line.slice(idx2-1, idx2) === '_') continue;
          line = line.slice(0, idx2) + '_' + line.slice(idx2);
          total++;
        }
      }
    }
    lines[idx] = line;
  }
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  console.log(`Patched ${filePath} (${(fixes[filePath]||[]).length} candidates)`);
}
console.log(`Total identifiers prefixed: ${total}`);

if (total === 0) process.exit(2);
process.exit(0);

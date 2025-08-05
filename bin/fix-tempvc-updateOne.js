/**
 * Fix script: normalize Mongo collection method usage in modules/temp-vc
 *
 * Problem:
 *   Code incorrectly calls methods directly on async getters:
 *     collections.channels.updateOne(...); // WRONG
 *
 * Correct pattern:
 *   const col = await collections.channels();
 *   await col.updateOne(...); // RIGHT
 *
 * This script rewrites occurrences of:
 *   collections.<name>.<method>(
 * to:
 *   <varName>.<method>(
 * and injects a resolver line above first usage in a scope:
 *   const <varName> = await collections.<name>();
 *
 * Scope-limited to modules/temp-vc/**\/*.js
 *
 * Usage:
 *   node bin/fix-tempvc-updateOne.js
 *
 * Notes:
 * - Idempotent-ish: avoids inserting duplicate resolver lines if same exact line exists nearby.
 * - Handles methods: findOne, updateOne, insertOne, countDocuments, deleteOne, updateMany, find, distinct
 * - Looks back a few lines for an existing await collections.<name>() to avoid double insertions.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { globSync } from "glob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const TARGET_GLOB = "modules/temp-vc/**/*.js";

// Collections and methods we care about
const COLLECTIONS = ["settings", "channels", "userPrefs", "metricsDaily", "restartLog"];
const METHODS = [
  "findOne",
  "updateOne",
  "insertOne",
  "countDocuments",
  "deleteOne",
  "updateMany",
  "find",
  "distinct",
];

// Build regexes
const collAlt = COLLECTIONS.join("|");
const methodAlt = METHODS.join("|");

// Detect any bad call (fast filter)
const BAD_CALL_ANY = new RegExp(`collections\\.(?:${collAlt})\\.(?:${methodAlt})\\s*\\(`);

// Capture which coll/method
const BAD_CALL_CAPTURE = new RegExp(
  `collections\\.(?<coll>${collAlt})\\.(?<method>${methodAlt})\\s*\\(`,
  "g"
);

// Helper: determine variable name by collection
function varNameFor(coll) {
  switch (coll) {
    case "channels":
      return "chCol";
    case "settings":
      return "settingsCol";
    case "userPrefs":
      return "userPrefsCol";
    case "metricsDaily":
      return "metricsDailyCol";
    case "restartLog":
      return "restartLogCol";
    default:
      return `${coll}Col`;
  }
}

// Helper: check if a resolver already exists near the current line
function hasExistingResolver(lines, startIndex, collName) {
  // Search up to 8 lines above for "await collections.<coll>()"
  const maxLookback = 8;
  for (let i = Math.max(0, startIndex - maxLookback); i < startIndex; i++) {
    const line = (lines[i] || "").trim();
    if (line.includes(`await collections.${collName}()`)) {
      return true;
    }
  }
  return false;
}

// Insert resolver line above a given index (once)
function ensureResolver(lines, insertAt, collName, varName) {
  const resolver = `const ${varName} = await collections.${collName}();`;
  // If an identical line exists in last 3 lines, skip
  for (let i = Math.max(0, insertAt - 3); i <= insertAt; i++) {
    if (((lines[i] || "").trim()) === resolver) {
      return false;
    }
  }
  // Maintain indentation from target line (simple heuristic)
  const indentation = (lines[insertAt] || "").match(/^\s*/)?.[0] ?? "";
  lines.splice(insertAt, 0, `${indentation}${resolver}`);
  return true;
}

function transformContent(content) {
  if (!BAD_CALL_ANY.test(content)) return null;

  const lines = content.split("\n");
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    BAD_CALL_CAPTURE.lastIndex = 0;

    // We might have multiple matches on a single line
    let match;
    let lastSafeIndex = 0;

    // To avoid infinite loops due to global regex reset, copy the line for matching
    const lineForMatch = line;
    while ((match = BAD_CALL_CAPTURE.exec(lineForMatch)) !== null) {
      const { coll, method } = match.groups || {};
      if (!coll || !method) continue;

      const varName = varNameFor(coll);

      // Ensure resolver exists
      if (!hasExistingResolver(lines, i, coll)) {
        const inserted = ensureResolver(lines, i, coll, varName);
        if (inserted) {
          i++; // line shifted down by insertion
          line = lines[i];
        }
      } else {
        // Optionally, could try to detect the variable name used elsewhere; for simplicity, we stick to varNameFor()
      }

      // Replace the call on the current line
      const targetRegex = new RegExp(`collections\\.${coll}\\.${method}\\s*\\(`, "g");
      const before = line;
      line = line.replace(targetRegex, `${varName}.${method}(`);
      if (line !== before) {
        lines[i] = line;
        changed = true;
      }
    }
  }

  return changed ? lines.join("\n") : null;
}

function run() {
  const files = globSync(TARGET_GLOB, { cwd: ROOT, nodir: true, absolute: true });
  let modified = 0;

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const out = transformContent(src);
    if (out && out !== src) {
      fs.writeFileSync(file, out, "utf8");
      modified++;
      console.log(`[fix-tempvc-updateOne] Modified: ${path.relative(ROOT, file)}`);
    }
  }

  console.log(`[fix-tempvc-updateOne] Completed. Files modified: ${modified}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
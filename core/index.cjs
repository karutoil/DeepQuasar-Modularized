/**
 * CommonJS bridge to ESM core exports.
 * Allows: const core = require('modular-discord-bot');
 */
const { pathToFileURL } = require("url");

let esm;
async function load() {
  if (!esm) {
    // Resolve ./index.js relative to this file
    const url = pathToFileURL(__dirname + "/index.js").href;
    esm = await import(url);
  }
  return esm;
}

module.exports = new Proxy(
  {},
  {
    get: function (_target, prop) {
      if (prop === "__esModule") return false;
      return (...args) =>
        load().then((m) => {
          const v = m[prop];
          if (typeof v === "function") return v.apply(null, args);
          return v;
        });
    },
  }
);
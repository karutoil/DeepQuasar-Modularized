## Core: linecount

Utility command that counts lines in repository folders.

### /linecount
- Description: Count lines of `.js` and `.cjs` files in `bin`, `core`, and `modules` folders and report totals.
- Options: none
- Example: /linecount

Notes:
- Responds with a rich embed containing per-folder lines/files/dirs and grand totals.
- Traversal ignores large directories such as `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`.
- Registered via `commands.registerSlash` and `commands.v2RegisterExecute` in `core/commands/linecount.js`.

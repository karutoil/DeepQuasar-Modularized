## Core: autocomplete-debug

Debug command registered in `core/commands/autocomplete-debug.js` to test autocomplete flows.

### /autocomplete-debug
- Description: Test autocomplete functionality with debug output.
- Options:
  - test-option (String) — optional — autocomplete enabled
  - category (String) — optional — autocomplete enabled
- Example: /autocomplete-debug test-option:test

Notes:
- The command registers `onAutocomplete` handlers for both options and responds with filtered choices (max 25).
- Useful when diagnosing centralized vs builder-level autocomplete routing.

---
title: "ModLog (Audit Log)"
description: "Audit log search and export utilities"
tags: ["module","modlog","commands"]
module: modlog
created: 2025-08-15
updated: 2025-08-15
---
<!--DOC-JSON-->{"title":"ModLog","module":"modlog","tags":["commands","auditlog"],"version":"1.0"}<!--/DOC-JSON-->

# ModLog (Audit Log)

Short summary: Provides `/auditlog` with subcommands to search, export, and inspect audit log entries.

## Command

- `/auditlog`
  - Description: Audit log utilities
  - Default permissions: View Audit Log

## Subcommands & Options

- search
  - event | string | optional (autocomplete) | Event type or alias (or 'all')
  - executor | user | optional
  - target | user | optional
  - channel | channel | optional
  - role | role | optional
  - emoji | string | optional
  - webhook | string | optional
  - integration | string | optional
  - since | string | optional | ISO or relative (e.g., 7d)
  - until | string | optional
  - reason | string | optional
  - page | integer | optional
  - page_size | integer | optional

- export
  - format | string | required | csv/json (choices)
  - Same filter options as search (event, executor, target, etc.)

- inspect
  - id | string | required | Audit log entry ID (snowflake)

## Autocomplete

- `event` option implements autocomplete and always returns at least `all` as fallback.

## Notes

- `search` produces paginated results (buttons/selects registered to handle pagination interactions).
- `export` can produce CSV/JSON using same filters as search.

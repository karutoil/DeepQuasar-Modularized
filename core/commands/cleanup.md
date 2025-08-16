---
title: "Cleanup"
description: "Bulk cleanup slash command with subcommands"
tags: ["module","cleanup","commands"]
module: cleanup
created: 2025-08-15
updated: 2025-08-15
---
<!--DOC-JSON-->{"title":"Cleanup","module":"cleanup","tags":["commands","moderation"],"version":"1.0"}<!--/DOC-JSON-->

# Cleanup

Short summary: Provides `/cleanup` with subcommands to remove or recreate channels and bulk-delete messages.

## Command

- `/cleanup` — Bulk cleanup actions for channels and messages.
  - Default permission: Manage Guild

## Subcommands & Options

- all
  - Description: Delete and recreate the current channel (preserves basic settings).
  - Options: none
  - Notes: Shows a confirmation dialog before deleting.

- messages
  - Description: Delete X most recent messages in the current channel.
  - Options:
    - count | integer | required | Number of messages to delete (max 100)

- user
  - Description: Delete X messages from a specific user.
  - Options:
    - target | user | required | User whose messages to delete
    - count  | integer | required | Number of messages to delete (max 100)

- bots
  - Description: Delete X messages from bot accounts.
  - Options:
    - count | integer | required | Number of messages to delete (max 100)

- contains
  - Description: Delete X messages containing a keyword.
  - Options:
    - keyword | string | required | Keyword to search for
    - count   | integer | required | Number of messages to delete (max 100)

## Examples

`/cleanup messages count:50`

## Notes

- Only operates in text channels. Pinned messages are ignored.
- Respect Discord bulk-delete limits (messages older than 14 days cannot be bulk-deleted).

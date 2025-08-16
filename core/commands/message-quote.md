---
title: "Message Quote"
description: "Message Quote module: automatic message-link conversion"
tags: ["module","message-quote","commands"]
module: message-quote
created: 2025-08-15
updated: 2025-08-15
---
<!--DOC-JSON-->{"title":"Message Quote","module":"message-quote","tags":["events"],"version":"1.0"}<!--/DOC-JSON-->

# Message Quote

Short summary: This module converts valid in-guild Discord message links into rich embeds automatically. It does not expose a slash command; it registers messageCreate handlers.

## Commands

- None (no slash commands).

## Behavior

- Listens to messageCreate events and detects in-guild message links; when found, it produces a rich embed with a jump button.

## Notes

- Feature flag: MODULE_MESSAGE_QUOTE_ENABLED (default true).
- Per-guild config available via guild settings (enable/disable and delete original options).

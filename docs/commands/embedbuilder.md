---
title: "Embed Builder"
description: "Interactive /embedbuilder command with live preview and templates"
tags: ["module","embedbuilder","commands"]
module: embedbuilder
created: 2025-08-15
updated: 2025-08-15
---
<!--DOC-JSON-->{"title":"Embed Builder","module":"embedbuilder","tags":["commands","ui"],"version":"1.0"}<!--/DOC-JSON-->

# Embed Builder

Short summary: Interactive `/embedbuilder` UI to create, preview, import/export, save/load templates, and send embeds to channels.

## Command

- `/embedbuilder`
  - Description: Opens the embed builder UI (ephemeral)
  - Permission: none by default; template save/remove requires Manage Guild

## Features (interaction controls)

- Edit Title, Description, Color, Images, Footer, Author, Fields (via modals)
- Add/Clear fields
- Save template (modal: key + name) — ManageGuild required
- Load template (select menu)
- Remove template (select menu) — ManageGuild required
- Export JSON / Import JSON (modal)
- Channel select + Send (buttons/select)

## Usage

`/embedbuilder` — opens the UI. Use the provided buttons and modals to edit and send.

## Notes

- Validates embed shape before saving or sending.
- Templates are per-guild and limited (listing/load limit applied).
- Save/Remove actions gated by ManageGuild permission and rate-limited.

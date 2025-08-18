---
title: "Discord Chat Agent"
description: "Commands for the AI chat agent module"
tags: ["module","discord-chat-agent","commands"]
module: discord-chat-agent
created: 2025-08-15
updated: 2025-08-15
---
<!--DOC-JSON-->{"title":"Discord Chat Agent","module":"discord-chat-agent","tags":["commands","ai"],"version":"1.0"}<!--/DOC-JSON-->

# Discord Chat Agent

Short summary: Exposes a `/chat` command with configuration subcommands and a `reset` action to clear conversation history.

## Command

- `/chat` — Commands for the AI chat agent.
  - Default permission: Administrator

## Subcommand Groups & Subcommands

- config (subcommand group)
  - set
    - key | string | required | Config key to set. Choices: apiKey, baseUrl, model, temperature, systemPrompt, activeChannel, historyLimit
    - value | string | required | Value to set (type/validation depends on key)
  - get
    - key | string | required | Config key to retrieve (same choices)
  - list
    - no options — lists all configuration values for the server

- reset
  - Description: Clear conversation history with the AI agent in the current channel.
  - Options: none

## Examples

- Set temperature:
  `/chat config set key:temperature value:0.7`

- Clear history in channel:
  `/chat reset`

## Notes

- `config set` validates certain keys (temperature range 0-2, historyLimit non-negative integer, channel IDs parsed from mentions).
- `reset` removes conversation history for the invoking user in the channel.

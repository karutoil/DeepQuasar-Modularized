---
title: "Invite Leaderboard"
description: "Invite utilities and leaderboard command"
tags: ["module","invite-leaderboard","commands"]
module: invite-leaderboard
created: 2025-08-15
updated: 2025-08-15
---
<!--DOC-JSON-->{"title":"Invite Leaderboard","module":"invite-leaderboard","tags":["commands","invites"],"version":"1.0"}<!--/DOC-JSON-->

# Invite Leaderboard

Short summary: Exposes `/invites` with a `leaderboard` subcommand to show top inviters for the guild.

## Command

- `/invites`
  - Description: Invite utilities
  - Permission: none by default

## Subcommands & Options

- leaderboard
  - limit | integer | optional | Number of results to return (server may clamp)

## Example

`/invites leaderboard limit:10`

## Notes

- The module also listens to invite create/delete and member add events to track and reconcile invite counts; the command simply surfaces the computed leaderboard.

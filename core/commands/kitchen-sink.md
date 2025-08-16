---
title: "Kitchen Sink"
description: "Demo commands demonstrating core features"
tags: ["module","kitchen-sink","commands"]
module: kitchen-sink
created: 2025-08-15
updated: 2025-08-15
---
<!--DOC-JSON-->{"title":"Kitchen Sink","module":"kitchen-sink","tags":["commands","demo"],"version":"1.0"}<!--/DOC-JSON-->

# Kitchen Sink

Short summary: A comprehensive demo module that registers multiple utility commands used for examples and testing.

## Commands (major ones)

- /hello
  - Description: Demonstrates confirmation dialogs, buttons and state.
  - Options:
    - name | string | optional | Name to greet
  - Buttons: details

- /echo
  - Description: Echo a message with autocomplete and modal transformer.
  - Options:
    - message | string | required
    - tag | string | optional (autocomplete)
  - Behaviors: modal form to append text, button to uppercase

- /paginate
  - Description: Shows paginated embed demo (no options)

- /httpbin
  - Description: Calls httpbin.org/get and displays result

- /schedule
  - Description: Start/stop an example scheduled job (feature-flagged)

## Usage

Run commands directly, e.g. `/hello name:Alice`.

## Notes

- Primarily a demo surface; some commands require guild context and permissions.
- Many interactions are ephemeral for demo purposes.

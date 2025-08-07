/**
 * components.js
 * Small helpers to build consistent rows, buttons, and selects with the v2 builder.
 * We primarily rely on b.button and b.select from the v2 builder for scoped IDs.
 */

export function rows(ctx, b, moduleName) {
  return [
    row([
      b.button(ctx, moduleName, "editTitle", "Title"),
      b.button(ctx, moduleName, "editDescription", "Description"),
      b.button(ctx, moduleName, "editColor", "Color"),
      b.button(ctx, moduleName, "editImages", "Images"),
      b.button(ctx, moduleName, "addField", "Add Field")
    ]),
    row([
      b.button(ctx, moduleName, "save", "Save", "Primary"),
      b.button(ctx, moduleName, "load", "Load", "Secondary"),
      b.button(ctx, moduleName, "remove", "Remove", "Danger"),
      b.button(ctx, moduleName, "export", "Export", "Secondary"),
      b.button(ctx, moduleName, "import", "Import", "Secondary")
    ]),
    channelSelectRow(ctx, b, moduleName),
    row([
      b.button(ctx, moduleName, "clearFields", "Clear Fields", "Secondary"),
      b.button(ctx, moduleName, "send", "Send", "Success")
    ])
  ];
}

export function row(components) {
  return { type: 1, components };
}

/**
 * Build a plain channel select row restricted to text-capable channels.
 * Channel types: 0 GuildText, 5 Announcement, 11 PublicThread, 12 PrivateThread
 */
export function channelSelectRow(ctx, b, moduleName) {
  return {
    type: 1,
    components: [
      {
        type: 8,
        custom_id: ctx.ids.make(moduleName, "sel", `${b.name}:channelSelect`),
        placeholder: "Select a channel",
        channel_types: [0, 5, 11, 12]
      }
    ]
  };
}

export function templateSelectRow(b, ctx, moduleName, localName, placeholder, options) {
  return {
    type: 1,
    components: [
      b.select(ctx, moduleName, localName, placeholder, options)
    ]
  };
}
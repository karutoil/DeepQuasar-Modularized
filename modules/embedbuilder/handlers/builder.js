/**
 * /embedbuilder interactive UI with:
 * - Live preview (ephemeral)
 * - Edit controls via modals (title, description, color, images, footer, author, fields)
 * - Per-guild templates: save, load, remove (permissions enforced)
 * - Export/Import JSON
 * - Channel select menu and send
 *
 * Uses v2 InteractionCommandBuilder per docs/core_functions.md
 */
// Sanitize template key: allow only a-z, 0-9, -, _
function sanitizeKey(str) {
  return String(str ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, "")
    .trim();
}
export function registerEmbedBuilder(ctx) {
  const moduleName = "embedbuilder";
  const b = ctx.v2.createInteractionCommand()
    .setName("embedbuilder")
    .setDescription("Interactive embed builder with templates and live preview")
    .onExecute(
      ctx.dsl.withTryCatch(
        ctx.dsl.withDeferredReply(async (i) => {
          // Create or reset per-interaction state
          // Use a persistent session key for the initial interaction
          const sessionId = `embedbuilder:${i.id}`;
          const state = ctx.v2.state.withKey(sessionId, 30 * 60_000); // 30 min TTL

          // Initialize draft with a non-empty description to avoid Discord form-body validation edge-case
          const initialDraft = getEmptyDraft();
          initialDraft.description = "."; // use a visible minimal placeholder to satisfy Discord validation
          await state.set("draft", initialDraft);
          await state.delete("channelId");

          const payload = await buildUiPayload(ctx, b, moduleName, i, state);
          // Final guard against empty embeds in initial reply
          if (!payload.embeds || payload.embeds.length === 0) {
            payload.embeds = [{ description: " " }];
          } else {
            payload.embeds[0] = ensureNonEmptyEmbed(payload.embeds[0]);
          }
          // Send the builder UI and store the builder message ID in state for session persistence
          const replyMsg = await i.editReply(payload);
          // Discord.js v14: editReply returns the message object
          if (replyMsg && replyMsg.id) {
            await state.set("builderMessageId", replyMsg.id);
            // Copy draft and initial state to builder message session key
            const builderState = ctx.v2.state.withKey(`embedbuilder:${replyMsg.id}`, 30 * 60_000);
            await builderState.set("draft", initialDraft);
            await builderState.delete("channelId");
            await builderState.set("builderMessageId", replyMsg.id);
          }
        }, { ephemeral: true })
      )
    )
    // Edit controls
    .onButton("editTitle", withState(ctx, async (i, state) => {
      const modal = b.modal(ctx, moduleName, "editTitle", "Edit Title");
      modal.addComponents(
        new (await import("discord.js")).ActionRowBuilder().addComponents(
          b.textInput("title", "Title (max 256)", "Short", false)
        )
      );
      await i.showModal(modal);
    }))
    .onModal("editTitle", withState(ctx, async (i, state) => {
      const title = i.fields.getTextInputValue("title");
      const draft = await state.get("draft") ?? getEmptyDraft();
      draft.title = String(title ?? "").slice(0, 256);
      normalizeDraft(draft);
      await state.set("draft", draft);
      await reRender(ctx, b, moduleName, i, state, { text: "Updated title." });
    }))
    .onButton("editDescription", withState(ctx, async (i, state) => {
      const modal = b.modal(ctx, moduleName, "editDescription", "Edit Description");
      modal.addComponents(
        new (await import("discord.js")).ActionRowBuilder().addComponents(
          b.textInput("description", "Description (max 4096)", "Paragraph", false)
        )
      );
      await i.showModal(modal);
    }))
    .onModal("editDescription", withState(ctx, async (i, state) => {
      const description = i.fields.getTextInputValue("description");
      const draft = await state.get("draft") ?? getEmptyDraft();
      draft.description = String(description ?? "").slice(0, 4096);
      normalizeDraft(draft);
      await state.set("draft", draft);
      await reRender(ctx, b, moduleName, i, state, { text: "Updated description." });
    }))
    .onButton("editColor", withState(ctx, async (i, state) => {
      const modal = b.modal(ctx, moduleName, "editColor", "Edit Color");
      modal.addComponents(
        new (await import("discord.js")).ActionRowBuilder().addComponents(
          b.textInput("color", "Hex color like #5865F2 or 5865F2", "Short", false)
        )
      );
      await i.showModal(modal);
    }))
    .onModal("editColor", withState(ctx, async (i, state) => {
      const color = i.fields.getTextInputValue("color");
      const draft = await state.get("draft") ?? getEmptyDraft();
      draft.color = parseColor(String(color ?? ""));
      normalizeDraft(draft);
      await state.set("draft", draft);
      await reRender(ctx, b, moduleName, i, state, { text: "Updated color." });
    }))
    .onButton("editImages", withState(ctx, async (i, state) => {
      const modal = b.modal(ctx, moduleName, "editImages", "Edit Images");
      modal.addComponents(
        new (await import("discord.js")).ActionRowBuilder().addComponents(
          b.textInput("thumbnail", "Thumbnail URL (https)", "Short", false)
        ),
        new (await import("discord.js")).ActionRowBuilder().addComponents(
          b.textInput("image", "Image URL (https)", "Short", false)
        )
      );
      await i.showModal(modal);
    }))
    .onModal("editImages", withState(ctx, async (i, state) => {
      const thumbnail = i.fields.getTextInputValue("thumbnail");
      const image = i.fields.getTextInputValue("image");
      const draft = await state.get("draft") ?? getEmptyDraft();
      draft.thumbnail = sanitizeUrl(String(thumbnail ?? ""));
      draft.image = sanitizeUrl(String(image ?? ""));
      normalizeDraft(draft);
      await state.set("draft", draft);
      await reRender(ctx, b, moduleName, i, state, { text: "Updated images." });
    }))
    .onButton("editFooter", withState(ctx, async (i, state) => {
      const modal = b.modal(ctx, moduleName, "editFooter", "Edit Footer");
      modal.addComponents(
        new (await import("discord.js")).ActionRowBuilder().addComponents(
          b.textInput("footerText", "Footer text (max 2048)", "Short", false)
        ),
        new (await import("discord.js")).ActionRowBuilder().addComponents(
          b.textInput("footerIcon", "Footer icon URL (https)", "Short", false)
        )
      );
      await i.showModal(modal);
    }))
    .onModal("editFooter", withState(ctx, async (i, state) => {
      const footerText = i.fields.getTextInputValue("footerText");
      const footerIcon = i.fields.getTextInputValue("footerIcon");
      const draft = await state.get("draft") ?? getEmptyDraft();
      draft.footerText = String(footerText ?? "").slice(0, 2048);
      draft.footerIcon = sanitizeUrl(String(footerIcon ?? ""));
      normalizeDraft(draft);
      await state.set("draft", draft);
      await reRender(ctx, b, moduleName, i, state, { text: "Updated footer." });
    }))
    .onButton("editAuthor", withState(ctx, async (i, state) => {
      const modal = b.modal(ctx, moduleName, "editAuthor", "Edit Author");
      modal.addComponents(
        new (await import("discord.js")).ActionRowBuilder().addComponents(
          b.textInput("authorName", "Author name (max 256)", "Short", false)
        ),
        new (await import("discord.js")).ActionRowBuilder().addComponents(
          b.textInput("authorIcon", "Author icon URL (https)", "Short", false)
        ),
        new (await import("discord.js")).ActionRowBuilder().addComponents(
          b.textInput("authorUrl", "Author URL (https)", "Short", false)
        )
      );
      await i.showModal(modal);
    }))
    .onModal("editAuthor", withState(ctx, async (i, state) => {
      const authorName = i.fields.getTextInputValue("authorName");
      const authorIcon = i.fields.getTextInputValue("authorIcon");
      const authorUrl = i.fields.getTextInputValue("authorUrl");
      const draft = await state.get("draft") ?? getEmptyDraft();
      draft.authorName = String(authorName ?? "").slice(0, 256);
      draft.authorIcon = sanitizeUrl(String(authorIcon ?? ""));
      draft.authorUrl = sanitizeUrl(String(authorUrl ?? ""));
      normalizeDraft(draft);
      await state.set("draft", draft);
      await reRender(ctx, b, moduleName, i, state, { text: "Updated author." });
    }))
    // Fields management (simple: add/replace entire field; an advanced manager can be added later)
    .onButton("addField", withState(ctx, async (i, state) => {
      const modal = b.modal(ctx, moduleName, "addField", "Add Field");
      modal.addComponents(
        new (await import("discord.js")).ActionRowBuilder().addComponents(
          b.textInput("name", "Field name (max 256)", "Short", true)
        ),
        new (await import("discord.js")).ActionRowBuilder().addComponents(
          b.textInput("value", "Field value (max 1024)", "Paragraph", true)
        ),
        new (await import("discord.js")).ActionRowBuilder().addComponents(
          b.textInput("inline", "Inline? true or false", "Short", false)
        )
      );
      await i.showModal(modal);
    }))
    .onModal("addField", withState(ctx, async (i, state) => {
      const name = i.fields.getTextInputValue("name");
      const value = i.fields.getTextInputValue("value");
      const inline = String(i.fields.getTextInputValue("inline") ?? "").toLowerCase() === "true";
      const draft = await state.get("draft") ?? getEmptyDraft();
      draft.fields = Array.isArray(draft.fields) ? draft.fields : [];
      if (draft.fields.length >= 25) {
        return i.reply({ content: "Max 25 fields.", ephemeral: true });
      }
      draft.fields.push({ name, value, inline });
      normalizeDraft(draft);
      await state.set("draft", draft);
      await reRender(ctx, b, moduleName, i, state, { text: "Added field." });
    }))
    .onButton("clearFields", withState(ctx, async (i, state) => {
      const draft = await state.get("draft") ?? getEmptyDraft();
      draft.fields = [];
      await state.set("draft", draft);
      await reRender(ctx, b, moduleName, i, state, { text: "Cleared fields." });
    }))
    // Templates
    .onButton("save", ctx.dsl.withPerms(
      withState(ctx, async (i, state) => {
        const modal = b.modal(ctx, moduleName, "saveTemplate", "Save Template");
        modal.addComponents(
          new (await import("discord.js")).ActionRowBuilder().addComponents(
            b.textInput("key", "Template key (a-z0-9-_)", "Short", true)
          ),
          new (await import("discord.js")).ActionRowBuilder().addComponents(
            b.textInput("name", "Template name", "Short", true)
          )
        );
        await i.showModal(modal);
      }),
      { userPerms: ["ManageGuild"] }
    ))
    .onModal("saveTemplate", ctx.dsl.withPerms(
      ctx.dsl.withCooldown(
        withState(ctx, async (i, state) => {
          const key = sanitizeKey(String(i.fields.getTextInputValue("key") ?? ""));
          const name = String(i.fields.getTextInputValue("name") ?? "").slice(0, 100) || key;
          if (!key) return i.reply({ content: "Invalid key.", ephemeral: true });

          const draft = await state.get("draft") ?? getEmptyDraft();
          const mentionRoles = await state.get("mentionRoles") ?? [];
          // DEBUG: Log draft and mentionRoles before saving
          ctx.logger?.debug?.("DEBUG saveTemplate draft:", JSON.stringify(draft, null, 2));
          ctx.logger?.debug?.("DEBUG saveTemplate mentionRoles:", JSON.stringify(mentionRoles, null, 2));
          const { validate } = await import("../utils/schema.js");
          const { ok, error, embed } = validate(draft);
          if (!ok) return i.reply({ content: `Validation failed: ${error}`, ephemeral: true });

          const svc = await loadTemplatesService();
          // Save mentionRoles in template data
          const saved = await svc.save(ctx, i.guildId, key, { name, data: { embed, mentionRoles } }, i.user.id);
          if (!saved.ok) return i.reply({ content: `Save failed: ${saved.error}`, ephemeral: true });
          await reRender(ctx, b, moduleName, i, state, { text: `Saved template '${name}'.` });
        }),
        { keyFn: (i) => `embedbuilder:save:${i.user.id}`, capacity: 2, refillPerSec: 0.2 }
      ),
      { userPerms: ["ManageGuild"] }
    ))
    .onButton("load", withState(ctx, async (i, state) => {
      const svc = await loadTemplatesService();
      const list = await svc.list(ctx, i.guildId, 25);
      const options = list.map(t => ({ label: t.name, value: t.key }));
      if (options.length === 0) {
        await i.reply({ content: "No templates to load.", ephemeral: true });
        return;
      }
      const row = {
        type: 1,
        components: [
          b.select(ctx, moduleName, "templateSelect", "Select template to load", options)
        ]
      };
      await i.update({ content: "Choose a template to load.", components: [row, ...buildRows(ctx, b, moduleName)] });
    }))
    .onSelect("templateSelect", withState(ctx, async (i, state) => {
      const key = i.values?.[0];
      if (!key) return i.update({ content: "No template selected.", components: buildRows(ctx, b, moduleName) });
      const svc = await loadTemplatesService();
      const tpl = await svc.get(ctx, i.guildId, key);
      if (!tpl) return i.update({ content: "Template not found.", components: buildRows(ctx, b, moduleName) });

      // DEBUG: Log loaded template data
      ctx.logger?.debug?.("DEBUG loadTemplate tpl.data:", JSON.stringify(tpl.data, null, 2));
      const draft = deserializeDraft(tpl.data?.embed ?? tpl.data ?? {});
      const mentionRoles = tpl.data?.mentionRoles ?? [];
      ctx.logger?.debug?.("DEBUG loadTemplate draft:", JSON.stringify(draft, null, 2));
      ctx.logger?.debug?.("DEBUG loadTemplate mentionRoles:", JSON.stringify(mentionRoles, null, 2));
      await state.set("draft", draft);
      await state.set("mentionRoles", mentionRoles);
      await reRender(ctx, b, moduleName, i, state, { text: `Loaded template '${tpl.data?.name ?? key}'.` });
    }))
    .onButton("remove", ctx.dsl.withPerms(
      withState(ctx, async (i, state) => {
        const svc = await loadTemplatesService();
        const list = await svc.list(ctx, i.guildId, 25);
        const options = list.map(t => ({ label: `Delete ${t.name}`, value: t.key }));
        if (options.length === 0) {
          await i.reply({ content: "No templates to remove.", ephemeral: true });
          return;
        }
        // DEBUG: Log select menu customId and options
        const selectMenu = b.select(ctx, moduleName, "templateRemoveSelect", "Select template to remove", options);
        ctx.logger?.debug?.("[EmbedBuilder] Remove template select menu constructed", {
          customId: selectMenu.data?.custom_id ?? selectMenu.customId,
          options
        });
        const row = {
          type: 1,
          components: [
            selectMenu
          ]
        };
        await i.update({ content: "Choose a template to remove.", components: [row, ...buildRows(ctx, b, moduleName)] });
      }),
      { userPerms: ["ManageGuild"] }
    ))
    // Register template removal select menu handler after b is initialized
    .onSelect(
      "templateRemoveSelect",
      ctx.dsl.withPerms(
        withState(ctx, async (i, state) => {
          ctx.logger?.debug?.("[EmbedBuilder] templateRemoveSelect handler invoked", {
            customId: i.customId,
            values: i.values
          });
          const key = i.values?.[0];
          if (!key) return i.update({ content: "No template selected.", components: buildRows(ctx, b, moduleName) });
          const svc = await loadTemplatesService();
          const res = await svc.remove(ctx, i.guildId, key);
          if (!res.ok) return i.update({ content: `Remove failed: ${res.error}`, components: buildRows(ctx, b, moduleName) });
          await reRender(ctx, b, moduleName, i, state, { text: `Removed template '${key}'.` });
        }),
        { userPerms: ["ManageGuild"] }
      )
    )
    // Export / Import
    .onButton("export", withState(ctx, async (i, state) => {
      const { validate } = await import("../utils/schema.js");
      const draft = await state.get("draft") ?? getEmptyDraft();
      const { ok, error, embed } = validate(draft);
      if (!ok) return i.reply({ content: `Validation failed: ${error}`, ephemeral: true });

      const content = JSON.stringify({ type: "discord-embed", version: 1, embed }, null, 2);
      if (content.length < 1800) {
        await i.reply({ content: "Exported JSON:\n```json\n" + content + "\n```", ephemeral: true });
      } else {
        const buf = Buffer.from(content, "utf8");
        await i.reply({ files: [{ attachment: buf, name: "embed.json" }], ephemeral: true });
      }
    }))
    .onButton("import", withState(ctx, async (i, state) => {
      const modal = b.modal(ctx, moduleName, "importJson", "Import Embed JSON");
      modal.addComponents(
        new (await import("discord.js")).ActionRowBuilder().addComponents(
          b.textInput("json", "Paste JSON", "Paragraph", true)
        )
      );
      await i.showModal(modal);
    }))
    .onModal("importJson", withState(ctx, async (i, state) => {
      try {
        const json = String(i.fields.getTextInputValue("json") ?? "");
        const parsed = JSON.parse(json);
        const embed = parsed.embed ?? parsed;
        const draft = deserializeDraft(embed);
        const { validate } = await import("../utils/schema.js");
        const res = validate(draft);
        if (!res.ok) return i.reply({ content: `Validation failed: ${res.error}`, ephemeral: true });
        await state.set("draft", res.embed);
        await reRender(ctx, b, moduleName, i, state, { text: "Imported JSON." });
      } catch (err) {
        await i.reply({ content: "Invalid JSON.", ephemeral: true });
      }
    }))
    // Channel selection + Send
    .onSelect("channelSelect", withState(ctx, async (i, state) => {
      const channelId = i.values?.[0];
      if (!channelId) return i.update({ content: "No channel selected.", components: buildRows(ctx, b, moduleName) });
      await state.set("channelId", channelId);
      await reRender(ctx, b, moduleName, i, state, { text: "Channel selected." });
    }))
    .onButton("send", ctx.dsl.withPerms(
      ctx.dsl.withCooldown(
        withState(ctx, async (i, state) => {
          const channelId = await state.get("channelId");
          ctx.logger?.debug?.("[EmbedBuilder] Send button pressed", { channelId });
          if (!channelId) return i.reply({ content: "Select a channel first.", ephemeral: true });

          let channel;
          try {
            channel = await i.client.channels.fetch(channelId);
            ctx.logger?.debug?.("[EmbedBuilder] Channel fetched", { channelId, channelType: channel?.type, channelName: channel?.name });
          } catch (err) {
            ctx.logger?.error?.("[EmbedBuilder] Channel fetch error", { channelId, error: err?.message });
            return i.reply({ content: "Channel not found.", ephemeral: true });
          }
          if (!channel) return i.reply({ content: "Channel not found.", ephemeral: true });

          const ok = await ctx.permissions.ensureInteractionPerms(i, { botPerms: ["SendMessages", "EmbedLinks"] });
          ctx.logger?.debug?.("[EmbedBuilder] Permission check", { ok });
          if (!ok) return;

          const { validate } = await import("../utils/schema.js");
          const draft = await state.get("draft") ?? getEmptyDraft();
          const { ok: isValid, error, embed } = validate(draft);
          ctx.logger?.debug?.("[EmbedBuilder] Embed validation", { isValid, error, embed });
          if (!isValid) return i.reply({ content: `Validation failed: ${error}`, ephemeral: true });

          // Read mentionRoles from state and build content
          const mentionRoles = await state.get("mentionRoles");
          ctx.logger?.debug?.("[EmbedBuilder] Send button mentionRoles from state", { mentionRoles });
          // Extra debug: check for any "everyone" string values
          if (Array.isArray(mentionRoles) && mentionRoles.some(r => r === "everyone")) {
            ctx.logger?.error?.("[EmbedBuilder] ERROR: mentionRoles contains 'everyone' string, should be guildId", { mentionRoles });
          }
          let content = "";
          if (Array.isArray(mentionRoles) && mentionRoles.length > 0) {
            const everyoneId = i.guild?.id ?? i.guildId;
            let roleMentions = mentionRoles.map(id => id === everyoneId ? "@everyone" : `<@&${id}>`).join(" ");
            // Replace @everyone with actual mention
            roleMentions = roleMentions.replace("@everyone", "<@everyone>");
            content = `${roleMentions}`;
          }

          try {
            await channel.send({
              content,
              embeds: [embed],
              allowedMentions: {
                roles: Array.isArray(mentionRoles) ? mentionRoles : [],
                everyone: Array.isArray(mentionRoles) && mentionRoles.includes(i.guild?.id ?? i.guildId)
              }
            });
            ctx.logger?.debug?.("[EmbedBuilder] Embed sent", { channelId, content });
            await i.reply({ content: "Embed sent.", ephemeral: true });
          } catch (err) {
            ctx.logger?.error?.("[EmbedBuilder] Error sending embed", { channelId, error: err?.message });
            await i.reply({ content: `Failed to send embed: ${err?.message}`, ephemeral: true });
          }
        }),
        { keyFn: (i) => `embedbuilder:send:${i.user.id}`, capacity: 2, refillPerSec: 0.2 }
      ),
      { userPerms: ["ManageMessages"] }
    ))
    // Mention Roles button handler
    .onButton("mentionRoles", withState(ctx, async (i, state) => {
      // Fetch all roles in the guild, including @everyone
      const guild = i.guild ?? await i.client.guilds.fetch(i.guildId);
      let roles = [];
      try {
        roles = await guild.roles.fetch();
        roles = Array.from(roles.values());
      } catch (err) {
        return i.reply({ content: "Failed to fetch roles.", ephemeral: true });
      }
      // Build options for RoleSelectMenu (max 25, include @everyone)
      // Discord's RoleSelectMenuBuilder automatically includes @everyone if not filtered out
      const maxRoles = 25;
      // Only include up to 24 additional roles (total 25 with @everyone)
      const slicedRoles = roles.slice(0, 24);
      ctx.logger?.debug?.("[EmbedBuilder] mentionRoles options count", { total: slicedRoles.length + 1 });
      // Show the RoleSelectMenu with maxValues = 25
      // Use native RoleSelectMenu for roles (no @everyone)
      const selectRow = {
        type: 1,
        components: [
          {
            type: 6, // RoleSelectMenu
            custom_id: b._makeId(moduleName, "rsel", "mentionRolesSelect"),
            placeholder: "Select up to 25 roles to mention",
            min_values: 1,
            max_values: maxRoles
          }
        ]
      };
      const buttonRow = {
        type: 1,
        components: [
          {
            type: 2, // Button
            style: 1, // Primary
            custom_id: b._makeId(moduleName, "btn", "addEveryone"),
            label: "Add @everyone",
            emoji: { name: "🌐" }
          }
        ]
      };
      // Update the builder message to show the RoleSelectMenu and Add @everyone button in separate rows
      ctx.logger?.debug?.("[EmbedBuilder] mentionRoles selectRow", { selectRow });
      ctx.logger?.debug?.("[EmbedBuilder] mentionRoles buttonRow", { buttonRow });
      await i.update({
        content: "Select roles to mention (use button to add @everyone):",
        components: [selectRow, buttonRow]
      });
    }))
    .onSelect("mentionRolesSelect", withState(ctx, async (i, state) => {
      // Convert "everyone" to guild ID for state
      const guildId = i.guild?.id ?? i.guildId;
      const selected = i.values.map(v => v === "everyone" ? guildId : v);
      ctx.logger?.debug?.("[EmbedBuilder] mentionRolesSelect raw values", { values: i.values, converted: selected, guildId });
      await state.set("mentionRoles", selected);
      // Debug: log draft before reRender
      const draftBefore = await state.get("draft");
      ctx.logger?.debug?.("[EmbedBuilder] mentionRolesSelect draft before reRender", { draft: draftBefore });
      // Ensure draft is always present
      if (!draftBefore) {
        await state.set("draft", getEmptyDraft());
        ctx.logger?.debug?.("[EmbedBuilder] mentionRolesSelect draft was missing, set to empty draft");
      }
      // Re-render the embed builder UI so the content field shows the mentions immediately
      // Use update to ensure the builder message is updated, not a new message
      await reRender(ctx, b, moduleName, i, state, { text: "Updated mentioned roles." });
      // Debug: log draft after reRender
      const draftAfter = await state.get("draft");
      ctx.logger?.debug?.("[EmbedBuilder] mentionRolesSelect draft after reRender", { draft: draftAfter });
    }))
    // Add @everyone button handler (move inside method chain)
    .onButton("addEveryone", withState(ctx, async (i, state) => {
      const guildId = i.guild?.id ?? i.guildId;
      let mentionRoles = await state.get("mentionRoles") ?? [];
      if (!mentionRoles.includes(guildId)) {
        mentionRoles = [...mentionRoles, guildId];
        await state.set("mentionRoles", mentionRoles);
        ctx.logger?.debug?.("[EmbedBuilder] addEveryone button pressed, added guildId to mentionRoles", { mentionRoles });
      } else {
        ctx.logger?.debug?.("[EmbedBuilder] addEveryone button pressed, guildId already in mentionRoles", { mentionRoles });
      }
      await reRender(ctx, b, moduleName, i, state, { text: "@everyone added to mentions." });
    }));

  const dispose = b.register(ctx, moduleName, { stateManager: ctx.v2.state })?.off;
  ctx.lifecycle.addDisposable(dispose);
  return dispose;
}

// Helpers and UI

function ensureNonEmptyEmbed(embed) {
  // Discord API sometimes rejects embeds[0] if description is completely absent.
  // Guarantee description is at least a single space when both title and description are empty/undefined.
  if (!embed || typeof embed !== "object") return { description: " " };
  const titleEmpty = !embed.title || String(embed.title).length === 0;
  const descEmpty = !embed.description || String(embed.description).length === 0;
  if (titleEmpty && descEmpty) return { ...embed, description: " " };
  return embed;
}

// Helpers and UI

function getEmptyDraft() {
  return {
    title: "",
    description: "",
    color: null,
    url: "",
    thumbnail: "",
    image: "",
    footerText: "",
    footerIcon: "",
    authorName: "",
    authorIcon: "",
    authorUrl: "",
    fields: []
  };
}

function deserializeDraft(embed = {}) {
  const d = getEmptyDraft();
  d.title = embed.title ?? "";
  d.description = embed.description ?? "";
  d.color = embed.color ?? null;
  d.url = embed.url ?? "";
  d.thumbnail = typeof embed.thumbnail === "string" ? embed.thumbnail : embed.thumbnail?.url ?? "";
  d.image = typeof embed.image === "string" ? embed.image : embed.image?.url ?? "";
  d.footerText = embed.footer?.text ?? "";
  d.footerIcon = embed.footer?.icon_url ?? "";
  d.authorName = embed.author?.name ?? "";
  d.authorIcon = embed.author?.icon_url ?? "";
  d.authorUrl = embed.author?.url ?? "";
  d.fields = Array.isArray(embed.fields) ? embed.fields.map(f => ({ name: f.name ?? "", value: f.value ?? "", inline: !!f.inline })) : [];
  normalizeDraft(d);
  return d;
}

function normalizeDraft(d) {
  d.title = d.title?.trim() ?? "";
  d.description = d.description?.trim() ?? "";
  d.url = sanitizeUrl(d.url);
  d.thumbnail = sanitizeUrl(d.thumbnail);
  d.image = sanitizeUrl(d.image);
  d.footerText = d.footerText?.trim() ?? "";
  d.footerIcon = sanitizeUrl(d.footerIcon);
  d.authorName = d.authorName?.trim() ?? "";
  d.authorIcon = sanitizeUrl(d.authorIcon);
  d.authorUrl = sanitizeUrl(d.authorUrl);
  d.fields = (Array.isArray(d.fields) ? d.fields : []).slice(0, 25).map(f => ({
    name: String(f.name ?? "").slice(0, 256),
    value: String(f.value ?? "").slice(0, 1024),
    inline: !!f.inline
  }));
  if (d.color != null) d.color = clampColor(d.color);
  return d;
}

function sanitizeUrl(u) {
  const s = String(u ?? "").trim();
  if (!s) return "";
  try {
    const url = new URL(s.startsWith("http") ? s : ("https://" + s));
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function parseColor(input) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  let hex = s.startsWith("#") ? s.slice(1) : s;
  hex = hex.replace(/[^a-fA-F0-9]/g, "");
  if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  if (hex.length !== 6) return null;
  const n = parseInt(hex, 16);
  return clampColor(n);
}

function clampColor(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return null;
  return Math.max(0, Math.min(0xFFFFFF, Math.floor(n)));
}

function withState(ctx, fn) {
  return ctx.dsl.withTryCatch(async (i) => {
    // Always use the builder message ID for session persistence
    let sessionId;
    let builderMessageId;
    if (i.message && i.message.id) {
      sessionId = `embedbuilder:${i.message.id}`;
      builderMessageId = i.message.id;
    } else {
      // Try to get builderMessageId from state using the initial interaction ID
      const initialState = ctx.v2.state.withKey(`embedbuilder:${i.id}`, 30 * 60_000);
      builderMessageId = await initialState.get("builderMessageId");
      if (builderMessageId) {
        sessionId = `embedbuilder:${builderMessageId}`;
      } else {
        sessionId = `embedbuilder:${i.id}`;
      }
    }
    ctx.logger?.debug?.("[EmbedBuilder] withState sessionId", { sessionId, builderMessageId });
    const state = ctx.v2.state.withKey(sessionId, 30 * 60_000);
    await fn(i, state);
  });
}

async function reRender(ctx, b, moduleName, i, state, notice) {
  const payload = await buildUiPayload(ctx, b, moduleName, i, state, notice);
  // Force embed to have minimal description if needed
  if (!payload.embeds || payload.embeds.length === 0) {
    payload.embeds = [{ description: " " }];
  } else {
    payload.embeds[0] = ensureNonEmptyEmbed(payload.embeds[0]);
  }

  if (i.isFromMessage?.() || i.isMessageComponent?.()) {
    await i.update(payload).catch(async () => {
      // Fallback if message no longer exists
      await i.editReply(payload).catch(() => {});
    });
  } else {
    await i.editReply(payload).catch(() => {});
  }
}

function buildRows(ctx, b, moduleName) {
  // Channel select: restrict to text-capable channels (GuildText, Announcement, PublicThread, PrivateThread)
  const channelSelect = {
    type: 1,
    components: [
      b.channelSelect(ctx, moduleName, "channelSelect", {
        placeholder: "Select a channel",
        minValues: 1,
        maxValues: 1,
        channelTypes: [0, 5, 11, 12] // GUILD_TEXT=0, GUILD_ANNOUNCEMENT=5, PUBLIC_THREAD=11, PRIVATE_THREAD=12
      })
    ]
  };

  const row1 = {
    type: 1,
    components: [
      b.button(ctx, moduleName, "editTitle", "Title"),
      b.button(ctx, moduleName, "editDescription", "Description"),
      b.button(ctx, moduleName, "editColor", "Color"),
      b.button(ctx, moduleName, "editImages", "Images"),
      b.button(ctx, moduleName, "addField", "Add Field")
    ]
  };
  const row2 = {
    type: 1,
    components: [
      b.button(ctx, moduleName, "save", "Save", "Primary"),
      b.button(ctx, moduleName, "load", "Load", "Secondary"),
      b.button(ctx, moduleName, "remove", "Remove", "Danger"),
      b.button(ctx, moduleName, "export", "Export", "Secondary"),
      b.button(ctx, moduleName, "import", "Import", "Secondary")
    ]
  };
  const row3 = channelSelect;

  const row4 = {
    type: 1,
    components: [
      b.button(ctx, moduleName, "clearFields", "Clear Fields", "Secondary"),
      b.button(ctx, moduleName, "send", "Send", "Success"),
      b.button(ctx, moduleName, "mentionRoles", "Mention Roles", "Primary")
    ]
  };
  return [row1, row2, row3, row4];
}

async function buildUiPayload(ctx, b, moduleName, interaction, state, notice) {
  const draft = await state.get("draft") ?? getEmptyDraft();
  const { toDiscordEmbed } = await import("../utils/preview.js");
  let embed = toDiscordEmbed(draft);
  embed = ensureNonEmptyEmbed(embed);

  const components = buildRows(ctx, b, moduleName);

  // Show role mentions in content if present
  const mentionRoles = await state.get("mentionRoles");
  let roleMentionsText = "";
  if (Array.isArray(mentionRoles) && mentionRoles.length > 0) {
    const everyoneId = interaction.guild?.id ?? interaction.guildId;
    let roleMentions = mentionRoles.map(id => id === everyoneId ? "@everyone" : `<@&${id}>`).join(" ");
    roleMentions = roleMentions.replace("@everyone", "<@everyone>");
    roleMentionsText = `${roleMentions}\n`;
  }

  const content = (roleMentionsText ? roleMentionsText : "") +
    (notice?.text ? `Notice: ${notice.text}` : "Embed Builder: Use buttons and selects to edit, save, and send.");

  return {
    content,
    embeds: [embed],
    components
  };
}

async function loadTemplatesService() {
  const svc = await import("../services/templates.js");
  return svc;
}
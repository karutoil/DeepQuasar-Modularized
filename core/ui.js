import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

/**
 * High-level UI helpers:
 * - createPaginatedEmbed(pages, opts)
 * - createConfirmationDialog(prompt, onConfirm, onCancel, opts)
 * - createMultiSelectMenu(options, onSelect, opts)
 * - createForm({ title, fields }) + parseModal()
 * - createWizard(steps)
 *
 * These helpers are factories that return a message payload and register appropriate handlers
 * in the provided ctx.interactions using the v2 scoped IDs from a given builder instance.
 *
 * Usage:
 *   const b = createInteractionCommand().setName("foo")...
 *   const { message, dispose } = createPaginatedEmbed(ctx, b, moduleName, pages, { ephemeral: true });
 *   await interaction.reply(message);
 */

function makeId(builder, moduleName, type, localName, extras) {
  // reuse builder's internal id generator by constructing a temporary component and reading customId
  if (type === "btn") {
    return builder.button(null, moduleName, localName, "x", ButtonStyle.Secondary, extras).data.custom_id;
  }
  if (type === "sel") {
    return builder.select(null, moduleName, localName).data.custom_id;
  }
  if (type === "mod") {
    return builder.modal(null, moduleName, localName, "x").data.custom_id;
  }
  // fallback: replicate logic (kept in sync with builder)
  const core = `${moduleName}:${builder._name}:${type}:${localName}`;
  const kv = Object.entries(extras || {})
    .filter(([_, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${String(v).replace(/[:=]/g, "_")}`);
  return [core, ...kv].join(":").slice(0, 100);
}

export function createPaginatedEmbed(ctx, builder, moduleName, pages, { ephemeral = true, initialIndex = 0 } = {}) {
  const total = Array.isArray(pages) ? pages.length : 0;
  const clamped = Math.max(0, Math.min(initialIndex, Math.max(0, total - 1)));

  const BTN_PREV = makeId(builder, moduleName, "btn", "pg_prev");
  const BTN_NEXT = makeId(builder, moduleName, "btn", "pg_next");

  const render = (i) => {
    const embed = pages[i] instanceof EmbedBuilder ? pages[i] : new EmbedBuilder(pages[i] || { description: "Empty page" });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BTN_PREV).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(i <= 0),
      new ButtonBuilder().setCustomId(BTN_NEXT).setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(i >= total - 1)
    );
    return { embeds: [embed], components: [row], ephemeral };
  };

  // Register handlers
  const state = new Map(); // messageId -> index
  const offPrev = ctx.interactions.registerButton(moduleName, BTN_PREV, async (interaction) => {
    const key = interaction.message?.id;
    const idx = (state.get(key) ?? clamped) - 1;
    const nextIdx = Math.max(0, idx);
    state.set(key, nextIdx);
    await interaction.update(render(nextIdx));
  });
  const offNext = ctx.interactions.registerButton(moduleName, BTN_NEXT, async (interaction) => {
    const key = interaction.message?.id;
    const idx = (state.get(key) ?? clamped) + 1;
    const nextIdx = Math.min(total - 1, idx);
    state.set(key, nextIdx);
    await interaction.update(render(nextIdx));
  });

  const dispose = () => { try { offPrev?.(); } catch {} try { offNext?.(); } catch {} state.clear(); };

  return { message: render(clamped), dispose };
}

export function createConfirmationDialog(ctx, builder, moduleName, prompt, onConfirm, onCancel, { ephemeral = true } = {}) {
  const BTN_CONFIRM = makeId(builder, moduleName, "btn", "confirm");
  const BTN_CANCEL = makeId(builder, moduleName, "btn", "cancel");

  const message = {
    content: prompt,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(BTN_CONFIRM).setLabel("Confirm").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(BTN_CANCEL).setLabel("Cancel").setStyle(ButtonStyle.Danger)
      )
    ],
    ephemeral
  };

  const offConfirm = ctx.interactions.registerButton(moduleName, BTN_CONFIRM, async (interaction) => {
    try { await onConfirm?.(interaction); } catch (e) { ctx.logger?.warn?.(`confirm handler error: ${e?.message}`); }
    try { await interaction.update({ components: [] }); } catch {}
  });
  const offCancel = ctx.interactions.registerButton(moduleName, BTN_CANCEL, async (interaction) => {
    try { await onCancel?.(interaction); } catch (e) { ctx.logger?.warn?.(`cancel handler error: ${e?.message}`); }
    try { await interaction.update({ components: [] }); } catch {}
  });

  const dispose = () => { try { offConfirm?.(); } catch {} try { offCancel?.(); } catch {} };

  return { message, dispose };
}

export function createMultiSelectMenu(ctx, builder, moduleName, options, onSelect, { placeholder = "Select...", maxValues = 1, ephemeral = true } = {}) {
  const SEL_ID = makeId(builder, moduleName, "sel", "multi");

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SEL_ID)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(Math.max(1, maxValues))
      .addOptions(...options.map(o => ({
        label: o.label ?? String(o.value),
        value: String(o.value),
        description: o.description,
        emoji: o.emoji
      })))
  );

  const message = { components: [row], ephemeral };

  const off = ctx.interactions.registerSelect(moduleName, SEL_ID, async (interaction) => {
    try { await onSelect?.(interaction, interaction.values); } catch (e) { ctx.logger?.warn?.(`multi-select handler error: ${e?.message}`); }
  });

  const dispose = () => { try { off?.(); } catch {} };

  return { message, dispose };
}

/**
 * Create a modal form from configuration and helpers to open and parse it.
 * config: { title, fields: [{ name, label, style: "short"|"paragraph", required? }] }
 */
export function createForm(ctx, builder, moduleName, { title, fields }) {
  const MODAL_ID = makeId(builder, moduleName, "mod", "form_submit");
  const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle(title || "Form");

  const rows = [];
  for (const f of fields || []) {
    const id = `${moduleName}:${builder._name}:field:${f.name}`;
    const input = new TextInputBuilder()
      .setCustomId(id)
      .setLabel(f.label || f.name)
      .setStyle((f.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short))
      .setRequired(Boolean(f.required));
    rows.push(new ActionRowBuilder().addComponents(input));
  }
  modal.addComponents(...rows);

  async function open(interaction) {
    try { await interaction.showModal(modal); } catch (e) { ctx.logger?.warn?.(`form open error: ${e?.message}`); }
  }

  const message = { content: "Opening form...", ephemeral: true };

  return { modal, message, open, modalId: MODAL_ID };
}

/**
 * Parse submitted modal inputs into an object keyed by simple field names.
 */
export function parseModal(interaction) {
  const data = {};
  try {
    for (const row of interaction.components || []) {
      for (const c of row.components || []) {
        const cid = c.customId || c.custom_id;
        const name = String(cid || "").split(":").pop();
        data[name] = c.value;
      }
    }
  } catch {}
  return data;
}

/**
 * Simple multi-step wizard that uses state to track progress.
 * steps: [{ render: (state) => messagePayload, onNext?: (interaction, state) }]
 */
export function createWizard(ctx, builder, moduleName, state, steps = []) {
  const BTN_NEXT = makeId(builder, moduleName, "btn", "wiz_next");
  const BTN_CANCEL = makeId(builder, moduleName, "btn", "wiz_cancel");

  function renderStep(i) {
    const base = steps[i]?.render?.(state) || { content: `Step ${i + 1}` };
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BTN_CANCEL).setLabel("Cancel").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(BTN_NEXT).setLabel(i >= steps.length - 1 ? "Finish" : "Next").setStyle(ButtonStyle.Primary)
    );
    return { ...base, components: [...(base.components || []), row], ephemeral: true };
  }

  async function start(interaction) {
    state.set("wizard_step", 0);
    await interaction.reply(renderStep(0));
  }

  const offNext = ctx.interactions.registerButton(moduleName, BTN_NEXT, async (interaction) => {
    const i = Number(state.get("wizard_step") || 0);
    try { await steps[i]?.onNext?.(interaction, state); } catch (e) { ctx.logger?.warn?.(`wizard onNext error: ${e?.message}`); }
    const next = Math.min(steps.length - 1, i + 1);
    state.set("wizard_step", next);
    if (i === steps.length - 1) {
      await interaction.update({ content: "Wizard finished.", components: [] });
    } else {
      await interaction.update(renderStep(next));
    }
  });

  const offCancel = ctx.interactions.registerButton(moduleName, BTN_CANCEL, async (interaction) => {
    try { await interaction.update({ content: "Wizard cancelled.", components: [] }); } catch {}
    try { state.delete?.("wizard_step"); } catch {}
  });

  const dispose = () => { try { offNext?.(); } catch {} try { offCancel?.(); } catch {} };

  return { start, dispose };
}
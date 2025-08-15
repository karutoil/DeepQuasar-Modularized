import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

/**
 * v2 Interaction Command Builder
 * - Defines a slash command and co-located component handlers.
 * - Scopes customIds to `${module}:${command}:${type}:${name}` automatically.
 * - Supports execute, buttons, selects, modals, and autocomplete per option name.
 */
export class InteractionCommandBuilder {
  constructor() {
    this._name = '';
    this._description = '';
    this._optionsBuilder = null; // optional: function to build SlashCommandBuilder options
    this._execute = null;
    this._buttons = new Map(); // localName -> handler
    this._selects = new Map(); // localName -> handler
    this._modals = new Map(); // localName -> handler
    this._autocomplete = new Map(); // optionName -> handler
    this._preconditions = []; // array of functions (interaction) => Promise<boolean|string>

    // for internal registration bookkeeping
    this._registered = false;

    this._defaultMemberPermissions = undefined;
  }

  setName(name) {
    this._name = name;
    return this;
  }
  setDescription(desc) {
    this._description = desc;
    return this;
  }
  setDefaultMemberPermissions(perm) {
    this._defaultMemberPermissions = perm;
    return this;
  }

  /**
   * addOption(fn): provide a callback that receives a SlashCommandBuilder to append options.
   * Multiple calls allowed; they will be composed when building JSON.
   */
  addOption(fn) {
    if (typeof fn !== 'function') return this;
    const prev = this._optionsBuilder;
    this._optionsBuilder = prev
      ? (b) => {
          prev(b);
          fn(b);
        }
      : fn;
    return this;
  }

  /**
   * Convenience helpers similar to proposal (alias to addOption)
   */
  addUserOption(fn) {
    return this.addOption((b) => b.addUserOption(fn));
  }
  addStringOption(fn) {
    return this.addOption((b) => b.addStringOption(fn));
  }
  addIntegerOption(fn) {
    return this.addOption((b) => b.addIntegerOption(fn));
  }
  addNumberOption(fn) {
    return this.addOption((b) => b.addNumberOption(fn));
  }
  addBooleanOption(fn) {
    return this.addOption((b) => b.addBooleanOption(fn));
  }
  addChannelOption(fn) {
    return this.addOption((b) => b.addChannelOption(fn));
  }
  addRoleOption(fn) {
    return this.addOption((b) => b.addRoleOption(fn));
  }
  addMentionableOption(fn) {
    return this.addOption((b) => b.addMentionableOption(fn));
  }
  addAttachmentOption(fn) {
    return this.addOption((b) => b.addAttachmentOption(fn));
  }

  addSubcommand(fn) {
    return this.addOption((builder) => builder.addSubcommand(fn));
  }

  addSubcommandGroup(fn) {
    return this.addOption((builder) => builder.addSubcommandGroup(fn));
  }

  onExecute(handler) {
    this._execute = handler;
    return this;
  }
  onButton(localName, handler) {
    this._buttons.set(localName, handler);
    return this;
  }
  onSelect(localName, handler) {
    this._selects.set(localName, handler);
    return this;
  }
  onModal(localName, handler) {
    this._modals.set(localName, handler);
    return this;
  }
  onAutocomplete(optionName, handler) {
    this._autocomplete.set(optionName, handler);
    return this;
  }
  addPrecondition(fn) {
    if (typeof fn === 'function') this._preconditions.push(fn);
    return this;
  }

  /**
   * Build SlashCommand JSON for registration.
   */
  toSlashJson() {
    const builder = new SlashCommandBuilder()
      .setName(this._name)
      .setDescription(this._description || ' ');
    if (this._defaultMemberPermissions !== undefined) {
      builder.setDefaultMemberPermissions(this._defaultMemberPermissions);
    }
    if (this._optionsBuilder) this._optionsBuilder(builder);
    return builder.toJSON();
  }

  /**
   * Internal: materialize scoped customId from module and command.
   */
  _makeId(moduleName, type, localName, extras = {}) {
    // id shape: module:cmd:type:name[:k=v]... ensure within 100 chars
    const core = `${moduleName}:${this._name}:${type}:${localName}`;
    const kv = Object.entries(extras)
      .filter(([_, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${String(v).replace(/[:=]/g, '_')}`);
    return [core, ...kv].join(':').slice(0, 100);
  }

  /**
   * Register this builder with the core registries.
   * - registers slash command JSON
   * - hooks command execution via ctx.commands v2 dispatcher
   * - registers component handlers in ctx.interactions
   * - wires autocomplete via ctx.commands
   */
  register(ctx, moduleName, { stateManager } = {}) {
    if (this._registered) return { off: () => {} };
    if (!this._name) throw new Error('InteractionCommandBuilder requires a name');

    // 1) Register slash JSON
    ctx.commands.registerSlash(moduleName, this.toSlashJson());

    // 2) Register v2 centralized autocomplete handlers (CRITICAL FIX)
    const autocompleteDisposers = [];
    for (const [optionName, handler] of this._autocomplete.entries()) {
      ctx.logger.debug(`[AUTOCOMPLETE-DEBUG] Registering v2 centralized autocomplete`, {
        commandName: this._name,
        optionName,
        moduleName,
      });
      const offCentralized = ctx.commands.v2RegisterAutocomplete(this._name, optionName, handler);
      autocompleteDisposers.push(offCentralized);
    }

    // 3) Wire slash execution handler
    const offExec = ctx.commands.onInteractionCreate(moduleName, async (interaction) => {
      if (!interaction.isChatInputCommand?.()) return;
      if (interaction.commandName !== this._name) return;

      const state = stateManager ? stateManager.forInteraction(interaction) : null;
      // Build simple args from options for convenience
      const args = buildArgs(interaction);

      const run = async () => {
        if (this._execute) {
          await this._execute(interaction, args, state);
        }
      };

      // If DSL has withPreconditions, wrap execute with them
      const dsl = ctx?.dsl;
      if (dsl?.withPreconditions && this._preconditions.length) {
        const wrapped = dsl.withPreconditions(run, this._preconditions);
        await wrapped(interaction);
      } else {
        await run();
      }
    });

    // 3) Register buttons/selects/modals with scoped IDs
    const disposers = [];

    for (const [local, handler] of this._buttons.entries()) {
      const id = this._makeId(moduleName, 'btn', local);
      const off = ctx.interactions.registerButton(moduleName, id, async (interaction) => {
        const state = stateManager ? stateManager.forInteraction(interaction) : null;
        await handler(interaction, state);
      });
      disposers.push(off);
    }
    for (const [local, handler] of this._selects.entries()) {
      // Register for StringSelect menus
      const id = this._makeId(moduleName, 'sel', local);
      const off = ctx.interactions.registerSelect(moduleName, id, async (interaction) => {
        const state = stateManager ? stateManager.forInteraction(interaction) : null;
        await handler(interaction, state);
      });
      disposers.push(off);

      // Additionally register a User Select handler for the same local name so that
      // customIds built with "usel" are routed to the same handler.
      const userId = this._makeId(moduleName, 'usel', local);
      const offUser = ctx.interactions.registerSelect(moduleName, userId, async (interaction) => {
        const state = stateManager ? stateManager.forInteraction(interaction) : null;
        await handler(interaction, state);
      });
      disposers.push(offUser);

      // Register for ChannelSelect menus (type 8)
      const channelId = this._makeId(moduleName, 'csel', local);
      ctx.logger?.debug?.('[Core] Registering ChannelSelectMenu handler', {
        moduleName,
        commandName: this._name,
        localName: local,
        customId: channelId,
        handlerExists: !!handler,
      });
      const offChannel = ctx.interactions.registerSelect(
        moduleName,
        channelId,
        async (interaction) => {
          ctx.logger?.debug?.('[Core] ChannelSelectMenu handler invoked', {
            moduleName,
            commandName: this._name,
            localName: local,
            customId: channelId,
          });
          const state = stateManager ? stateManager.forInteraction(interaction) : null;
          await handler(interaction, state);
        }
      );
      disposers.push(offChannel);
      // Register for RoleSelect menus (type 7)
      const roleId = this._makeId(moduleName, 'rsel', local);
      ctx.logger?.debug?.('[Core] Registering RoleSelectMenu handler', {
        moduleName,
        commandName: this._name,
        localName: local,
        customId: roleId,
        handlerExists: !!handler,
      });
      const offRole = ctx.interactions.registerSelect(moduleName, roleId, async (interaction) => {
        ctx.logger?.debug?.('[Core] RoleSelectMenu handler invoked', {
          moduleName,
          commandName: this._name,
          localName: local,
          customId: roleId,
        });
        const state = stateManager ? stateManager.forInteraction(interaction) : null;
        await handler(interaction, state);
      });
      disposers.push(offRole);
    }
    for (const [local, handler] of this._modals.entries()) {
      const id = this._makeId(moduleName, 'modal', local);
      const off = ctx.interactions.registerModal(moduleName, id, async (interaction) => {
        const state = stateManager ? stateManager.forInteraction(interaction) : null;
        await handler(interaction, state);
      });
      disposers.push(off);
    }

    // 4) Autocomplete: discord.js exposes isAutocomplete()
    const autocompleteHandlers = Array.from(this._autocomplete.keys());
    ctx.logger.debug(`[AUTOCOMPLETE-DEBUG] Registering v2 builder autocomplete`, {
      commandName: this._name,
      moduleName,
      autocompleteOptions: autocompleteHandlers,
      hasAutocompleteHandlers: autocompleteHandlers.length > 0,
    });

    const offAuto = ctx.commands.onInteractionCreate(moduleName, async (interaction) => {
      if (interaction.isAutocomplete?.() !== true) return;
      if (interaction.commandName !== this._name) return;

      const focused = interaction.options.getFocused(true); // { name, value }
      ctx.logger.debug(`[AUTOCOMPLETE-DEBUG] v2 builder autocomplete handler triggered`, {
        commandName: this._name,
        focusedOption: focused?.name,
        focusedValue: focused?.value,
        availableHandlers: autocompleteHandlers,
      });

      const handler = this._autocomplete.get(focused?.name);
      if (!handler) {
        ctx.logger.debug(`[AUTOCOMPLETE-DEBUG] No v2 builder handler found`, {
          commandName: this._name,
          focusedOption: focused?.name,
          availableOptions: autocompleteHandlers,
        });
        return;
      }

      try {
        ctx.logger.debug(`[AUTOCOMPLETE-DEBUG] Executing v2 builder autocomplete handler`, {
          commandName: this._name,
          optionName: focused?.name,
        });
        await handler(interaction);
        ctx.logger.debug(`[AUTOCOMPLETE-DEBUG] v2 builder autocomplete completed successfully`);
      } catch (err) {
        ctx.logger.error(`Autocomplete error for ${this._name}/${focused?.name}: ${err?.message}`, {
          stack: err?.stack,
        });
      }
    });

    this._registered = true;

    const offAll = () => {
      try {
        offExec?.();
      } catch (err) { void err; }
      try {
        offAuto?.();
      } catch (err) { void err; }
      for (const d of disposers) {
        try {
          d?.();
        } catch (err) { void err; }
      }
      for (const d of autocompleteDisposers) {
        try {
          d?.();
        } catch (err) { void err; }
      }
      this._registered = false;
    };

    return { off: offAll };
  }

  /**
   * Convenience helpers to build Discord components with scoped ids.
   */
  button(ctx, moduleName, localName, label, style = ButtonStyle.Primary, extras = {}) {
    const id = this._makeId(moduleName, 'btn', localName, extras);
    return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  }

  select(ctx, moduleName, localName, placeholder = 'Select...', options = []) {
    const id = this._makeId(moduleName, 'sel', localName);
    const menu = new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder);
    if (Array.isArray(options) && options.length) {
      menu.addOptions(
        ...options.map((o) => ({ label: o.label ?? String(o.value), value: String(o.value) }))
      );
    }
    return menu;
  }

  /**
   * Build a Discord Channel Select Menu (type=CHANNEL) with scoped customId.
   * minValues defaults to 1, maxValues defaults to 1 (override as needed).
   */
  channelSelect(
    ctx,
    moduleName,
    localName,
    { placeholder = 'Select channel...', minValues = 1, maxValues = 1, channelTypes = [] } = {}
  ) {
    // Discord.js v14+ ChannelSelectMenuBuilder
    const id = this._makeId(moduleName, 'csel', localName);
    const menu = new ChannelSelectMenuBuilder()
      .setCustomId(id)
      .setPlaceholder(placeholder)
      .setMinValues(Math.max(0, Math.min(minValues, 25)))
      .setMaxValues(Math.max(1, Math.min(maxValues, 25)));
    if (Array.isArray(channelTypes) && channelTypes.length) {
      menu.setChannelTypes(channelTypes);
    }
    return menu;
  }

  /**
   * Build a Discord User Select Menu (type=USER) with scoped customId.
   * minValues defaults to 1, maxValues defaults to 1 (override as needed).
   */
  userSelect(
    ctx,
    moduleName,
    localName,
    { placeholder = 'Select users...', minValues = 1, maxValues = 1 } = {}
  ) {
    const id = this._makeId(moduleName, 'usel', localName);
    const menu = new UserSelectMenuBuilder()
      .setCustomId(id)
      .setPlaceholder(placeholder)
      .setMinValues(Math.max(0, Math.min(minValues, 25)))
      .setMaxValues(Math.max(1, Math.min(maxValues, 25)));
    return menu;
  }

  /**
   * Build a Discord Role Select Menu (type=ROLE) with scoped customId.
   * minValues defaults to 1, maxValues defaults to 1 (override as needed).
   */
  roleSelect(
    ctx,
    moduleName,
    localName,
    { placeholder = 'Select roles...', minValues = 1, maxValues = 1 } = {}
  ) {
    const id = this._makeId(moduleName, 'rsel', localName);
    const menu = new RoleSelectMenuBuilder()
      .setCustomId(id)
      .setPlaceholder(placeholder)
      .setMinValues(Math.max(0, Math.min(minValues, 25)))
      .setMaxValues(Math.max(1, Math.min(maxValues, 25)));
    return menu;
  }

  modal(ctx, moduleName, localName, title) {
    const id = this._makeId(moduleName, 'modal', localName);
    return new ModalBuilder().setCustomId(id).setTitle(title);
  }

  textInput(customId, label, style = TextInputStyle.Paragraph, required = true) {
    return new TextInputBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(style)
      .setRequired(required);
  }
}

/**
 * Helper to produce simple args object from interaction options.
 */
function buildArgs(interaction) {
  const out = {};
  try {
    const data = interaction.options?.data ?? [];
    for (const opt of data) {
      const name = opt.name;
      const val = interaction.options.get(name);
      // discord.js typed getters
      switch (opt.type) {
        case 3:
          out[name] = interaction.options.getString(name);
          break;
        case 4:
          out[name] = interaction.options.getInteger(name);
          break;
        case 10:
          out[name] = interaction.options.getNumber(name);
          break;
        case 5:
          out[name] = interaction.options.getBoolean(name);
          break;
        case 6:
          out[name] = interaction.options.getUser(name);
          break;
        case 7:
          out[name] = interaction.options.getChannel(name);
          break;
        case 8:
          out[name] = interaction.options.getRole(name);
          break;
        case 9:
          out[name] = interaction.options.getMentionable(name);
          break;
        case 11:
          out[name] = interaction.options.getAttachment(name);
          break;
        default:
          out[name] = val?.value ?? null;
      }
    }
  } catch (err) {
    console.error('buildArgs error', err);
  }
  return out;
}

/**
 * Factory: make a builder.
 */
export function createInteractionCommand() {
  return new InteractionCommandBuilder();
}

/**
 * Registry to collect v2 builders per module for install/migrate flows if needed.
 */
export function createBuilderRegistry() {
  const byModule = new Map(); // moduleName -> Set(builder)
  function add(moduleName, builder) {
    let set = byModule.get(moduleName);
    if (!set) {
      set = new Set();
      byModule.set(moduleName, set);
    }
    set.add(builder);
    return () => set.delete(builder);
  }
  function list(moduleName) {
    return Array.from(byModule.get(moduleName) ?? []);
  }
  function clearModule(moduleName) {
    byModule.delete(moduleName);
  }
  return { add, list, clearModule, _debug: { byModule } };
}

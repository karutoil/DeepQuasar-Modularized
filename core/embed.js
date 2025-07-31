import { EmbedBuilder, Colors } from "discord.js";

/**
 * Global embed builder utility to standardize common embed use-cases.
 * Provides themeable colors and convenience methods for success/error/info/warn.
 */
export function createEmbed(config) {
  const theme = {
    success: config.get("EMBED_COLOR_SUCCESS") || Colors.Green,
    error: config.get("EMBED_COLOR_ERROR") || Colors.Red,
    info: config.get("EMBED_COLOR_INFO") || Colors.Blurple,
    warn: config.get("EMBED_COLOR_WARN") || Colors.Orange,
    neutral: config.get("EMBED_COLOR_NEUTRAL") || Colors.DarkButNotBlack,
    footer: config.get("EMBED_FOOTER_TEXT") || "",
    footerIcon: config.get("EMBED_FOOTER_ICON") || "",
  };

  function base(color, opts = {}) {
    const e = new EmbedBuilder()
      .setColor(resolveColor(color))
      .setTimestamp(new Date());

    if (opts.title) e.setTitle(opts.title);
    if (opts.description) e.setDescription(opts.description);
    if (opts.url) e.setURL(opts.url);
    if (opts.thumbnail) e.setThumbnail(opts.thumbnail);
    if (opts.image) e.setImage(opts.image);
    if (opts.author) {
      const { name, iconURL, url } = opts.author;
      e.setAuthor({ name, iconURL, url });
    }
    if (opts.fields && Array.isArray(opts.fields)) {
      e.addFields(opts.fields);
    }

    const footerText = opts.footerText ?? theme.footer;
    const footerIcon = opts.footerIcon ?? theme.footerIcon;
    if (footerText || footerIcon) {
      e.setFooter({ text: footerText || "", iconURL: footerIcon || null });
    }

    return e;
  }

  function resolveColor(c) {
    if (!c) return theme.neutral;
    if (typeof c === "number") return c;
    // If string hex like "#ff0000"
    if (typeof c === "string") {
      const hex = c.startsWith("#") ? c : `#${c}`;
      try {
        // discord.js supports number; convert hex to int
        return parseInt(hex.replace("#", ""), 16);
      } catch {
        return theme.neutral;
      }
    }
    return theme.neutral;
  }

  function success(opts = {}) {
    return base(theme.success, opts);
  }

  function error(opts = {}) {
    return base(theme.error, opts);
  }

  function info(opts = {}) {
    return base(theme.info, opts);
  }

  function warn(opts = {}) {
    return base(theme.warn, opts);
  }

  function neutral(opts = {}) {
    return base(theme.neutral, opts);
  }

  return {
    theme,
    base,
    success,
    error,
    info,
    warn,
    neutral,
  };
}
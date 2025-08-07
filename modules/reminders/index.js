// modules/reminders/index.js
// Reminders module providing /remind "task" "time" "timezone" with Mongo-backed persistence,
// DM delivery later; this minimal working slice implements:
// - chrono-node parsing helpers (with simple TZ handling)
// - Mongo-backed creation and timer scheduling
// - Background sweep to re-arm timers after restart
// - Slash command /remind task time timezone (ephemeral confirmation)
//
// Follow-up iterations will add: DM with embed + Snooze/Complete buttons.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";

// --- chrono-node lazy import
let chrono = null;
async function ensureChrono() {
  if (!chrono) {
    try {
      const mod = await import("chrono-node");
      chrono = mod;
    } catch (e) {
      throw new Error("chrono-node is required. Please add it to dependencies.");
    }
  }
  return chrono;
}

// --- TZ mapping helpers
const TZ_ABBREV_TO_IANA = {
  UTC: "UTC",
  GMT: "Etc/GMT",
  EST: "America/New_York",
  EDT: "America/New_York",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  MST: "America/Denver",
  MDT: "America/Denver",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  IST: "Asia/Kolkata",
  CET: "Europe/Berlin",
  CEST: "Europe/Berlin",
  EET: "Europe/Helsinki",
  EEST: "Europe/Helsinki",
  JST: "Asia/Tokyo",
  AEST: "Australia/Sydney",
  AEDT: "Australia/Sydney",
};

async function resolveTimezone(ctx, interaction, providedTz) {
  // Priority: user setting > provided option > guild setting > UTC
  const userId = interaction.user?.id;
  const guildId = interaction.guildId;

  let userTz = null;
  try {
    const col = await ctx.mongo.getCollection("user_settings");
    if (col) {
      const doc = await col.findOne({ _id: `tz:${userId}` });
      if (doc?.tz) userTz = doc.tz;
    }
  } catch {}

  const guildTz = guildId ? ctx.guildConfig.get(guildId, "timezone", null) : null;
  const candidate = userTz || providedTz || guildTz || "UTC";
  if (TZ_ABBREV_TO_IANA[candidate?.toUpperCase?.()]) {
    return TZ_ABBREV_TO_IANA[candidate.toUpperCase()];
  }
  return candidate;
}

// Convert a wall time in tz to a UTC Date by reconstructing epoch from formatted parts
function zonedWallToUtc(Y, M, D, h, m, s, tzIana) {
  const tz = tzIana || "UTC";
  const base = Date.UTC(Y, M - 1, D, h, m, s);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(base));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  const wallAsUtc = Date.UTC(
    get("year"),
    Math.max(0, (get("month") || 1) - 1),
    get("day") || 1,
    get("hour") || 0,
    get("minute") || 0,
    get("second") || 0
  );
  return new Date(wallAsUtc);
}

// Parse natural language time into an absolute Date (UTC), honoring timezone when possible
async function parseNaturalDate(input, tzIana) {
  const { parseDate } = await ensureChrono();
  const simple = String(input || "").trim();

  // Relative shorthand: +15m, +2h, in 3d, in 1w
  const rel = simple.match(/^(?:\+|in\s+)(\d+)\s*(m|h|d|w)$/i);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const now = Date.now();
    const ms =
      unit === "m" ? n * 60_000 :
      unit === "h" ? n * 3_600_000 :
      unit === "d" ? n * 86_400_000 :
      unit === "w" ? n * 7 * 86_400_000 : 0;
    return new Date(now + ms);
  }

  // ISO-like absolute: 2025-08-15 09:30 (interpret in tz)
  const abs = simple.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (abs) {
    const [_, d, hh, mm, ss] = abs;
    const [Y, M, D] = d.split("-").map(Number);
    const h = Number(hh ?? 9);
    const m = Number(mm ?? 0);
    const s = Number(ss ?? 0);
    return zonedWallToUtc(Y, M, D, h, m, s, tzIana || "UTC");
  }

  // chrono parse, then reinterpret wall time in tz if provided
  const ref = new Date();
  const dt = parseDate(simple, ref, { forwardDate: true });
  if (!dt) return null;
  if (tzIana && tzIana.toUpperCase() !== "UTC") {
    return zonedWallToUtc(
      dt.getFullYear(), dt.getMonth() + 1, dt.getDate(),
      dt.getHours(), dt.getMinutes(), dt.getSeconds(),
      tzIana
    );
  }
  return dt;
}

// --- Mongo-backed store with in-memory timers
const RCOL = "reminders";
const timers = new Map(); // id -> Timeout

function toId(v) { return typeof v === "string" ? v : String(v); }

async function ensureIndexes(mongo) {
  const col = await mongo.getCollection(RCOL);
  if (!col) return null;
  try {
    await col.createIndex({ userId: 1, status: 1, dueAt: 1 });
    await col.createIndex({ status: 1, dueAt: 1 });
  } catch {}
  return col;
}

async function createReminder(mod, data) {
  const col = await ensureIndexes(mod.mongo);
  if (!col) throw new Error("Mongo not available");
  const now = new Date();
  const doc = {
    userId: toId(data.userId),
    guildId: data.guildId ? toId(data.guildId) : null,
    channelId: data.channelId ? toId(data.channelId) : null,
    interactionId: data.interactionId || null,
    task: String(data.task || "").slice(0, 2000),
    tz: data.tz || "UTC",
    dueAt: new Date(data.dueAt),
    status: "scheduled",
    createdAt: now,
    updatedAt: now,
    lastNotifiedAt: null,
  };
  const res = await col.insertOne(doc);
  doc._id = res.insertedId;
  scheduleTimer(mod, doc);
  return doc;
}

async function updateReminder(mod, id, patch) {
  const col = await mod.mongo.getCollection(RCOL);
  const _id = typeof id === "object" ? id._id : id;
  await col.updateOne({ _id }, { $set: { ...patch, updatedAt: new Date() } });
  const doc = await col.findOne({ _id });
  if (doc) rescheduleTimer(mod, doc);
  return doc;
}

async function findDue(mod, until) {
  const col = await mod.mongo.getCollection(RCOL);
  return col.find({ status: "scheduled", dueAt: { $lte: new Date(until) } }).toArray();
}

function clearTimer(id) {
  const key = String(id);
  const t = timers.get(key);
  if (t) {
    try { clearTimeout(t); } catch {}
    timers.delete(key);
  }
}

function scheduleTimer(mod, doc) {
  clearTimer(doc._id);
  if (doc.status !== "scheduled") return;
  const delay = Math.max(0, new Date(doc.dueAt).getTime() - Date.now());
  const maxDelay = 24 * 3600 * 1000;

  const run = async () => {
    try {
      await deliverReminder(mod, doc._id);
    } catch (e) {
      mod.logger?.error?.(`Reminder delivery error: ${e?.message}`);
    }
  };

  if (delay > maxDelay) {
    const t = setTimeout(() => {
      // Re-arm closer as time advances
      rescheduleTimer(mod, doc);
    }, maxDelay);
    timers.set(String(doc._id), t);
  } else {
    const t = setTimeout(run, delay);
    timers.set(String(doc._id), t);
  }
}

function rescheduleTimer(mod, doc) {
  clearTimer(doc._id);
  scheduleTimer(mod, doc);
}

// Build the rich DM embed and components (Snooze/Complete)
function buildReminderMessage(mod, id, doc) {
  const dueTs = Math.floor(new Date(doc.dueAt).getTime() / 1000);
  const embed = mod.embed.info({
    title: "⏰ Reminder",
    description: `“${doc.task}”`,
    fields: [
      { name: "Due", value: `<t:${dueTs}:F> (${doc.tz})`, inline: true },
      { name: "ID", value: String(id), inline: true },
    ],
    footerText: "Use buttons below to snooze or complete",
  });

  // Use v2 builder sugar to auto-scope IDs. We create a temporary builder instance to mint IDs.
  const b = mod.v2.createInteractionCommand().setName("reminders_runtime");
  const row1 = new ActionRowBuilder().addComponents(
    b.button(mod, "reminders", "snooze_10m", "Snooze 10m", ButtonStyle.Secondary, { id }),
    b.button(mod, "reminders", "snooze_1h", "Snooze 1h", ButtonStyle.Secondary, { id }),
    b.button(mod, "reminders", "snooze_tomorrow9", "Tomorrow 9am", ButtonStyle.Secondary, { id }),
  );
  const row2 = new ActionRowBuilder().addComponents(
    b.button(mod, "reminders", "snooze_custom", "Custom Snooze…", ButtonStyle.Primary, { id }),
    b.button(mod, "reminders", "complete", "Complete", ButtonStyle.Success, { id }),
  );

  return { embed, components: [row1, row2] };
}

// --- Module setup (minimal working slice)
export async function setup(ctx) {
  const moduleName = "reminders";
  const mod = typeof ctx?.createModuleContext === "function" ? ctx.createModuleContext(moduleName) : ctx;
  const { v2, embed, dsl, lifecycle, logger, scheduler, interactions } = mod;

  const cmd = v2.createInteractionCommand()
    .setName("remind")
    .setDescription("Create a reminder")
    .addStringOption(o => o.setName("task").setDescription("Task or note").setRequired(true))
    .addStringOption(o => o.setName("time").setDescription("When (e.g., 'next week @ 3am', '+15m')").setRequired(true))
    .addStringOption(o => o.setName("timezone").setDescription("Timezone (e.g., EST, America/New_York)").setRequired(false))
    .onExecute(
      dsl.withCooldown(
        dsl.withTryCatch(
          dsl.withDeferredReply(async (i) => {
            const task = i.options.getString("task", true);
            const timeStr = i.options.getString("time", true);
            const tzOpt = i.options.getString("timezone") || undefined;
            const tz = await resolveTimezone(mod, i, tzOpt);
            const due = await parseNaturalDate(timeStr, tz);

            if (!due || isNaN(due.getTime()) || due.getTime() < Date.now() + 30_000) {
              const e = embed.error({ title: "Invalid time", description: "Could not parse the time or it is too soon. Examples: '+15m', 'tomorrow 9am', '2025-08-15 09:30'." });
              await i.editReply({ embeds: [e], ephemeral: true });
              return;
            }

            const created = await createReminder(mod, {
              userId: i.user?.id,
              guildId: i.guildId,
              channelId: i.channelId,
              interactionId: i.id,
              task,
              tz,
              dueAt: due,
            });

            const confirm = embed.success({
              title: "Reminder scheduled",
              description: `“${task}”\nDue: <t:${Math.floor(due.getTime() / 1000)}:F> (${tz})\nID: ${created._id}`,
            });
            await i.editReply({ embeds: [confirm], ephemeral: true });
          })
        ),
        { keyFn: (i) => `remind:${i.user?.id}`, capacity: 2, refillPerSec: 0.5 }
      )
    )
    // Quick snooze handlers
    .onButton("snooze_10m", async (btn) => {
      const { extras } = mod.ids.parse(btn.customId);
      const rid = extras?.id;
      if (!rid) return;
      const col = await mod.mongo.getCollection(RCOL);
      const doc = await col.findOne({ _id: rid });
      if (!doc) return;
      const newDue = calcSnooze(doc.dueAt, "10m", doc.tz);
      const updated = await updateReminder(mod, rid, { dueAt: newDue, status: "scheduled" });
      const ack = embed.info({ title: "Snoozed", description: "Snoozed for 10 minutes." });
      await btn.update({ embeds: [ack], components: [] }).catch(async () => {
        await btn.reply({ embeds: [ack], ephemeral: true }).catch(() => {});
      });
    })
    .onButton("snooze_1h", async (btn) => {
      const { extras } = mod.ids.parse(btn.customId);
      const rid = extras?.id;
      if (!rid) return;
      const col = await mod.mongo.getCollection(RCOL);
      const doc = await col.findOne({ _id: rid });
      if (!doc) return;
      const newDue = calcSnooze(doc.dueAt, "1h", doc.tz);
      await updateReminder(mod, rid, { dueAt: newDue, status: "scheduled" });
      const ack = embed.info({ title: "Snoozed", description: "Snoozed for 1 hour." });
      await btn.update({ embeds: [ack], components: [] }).catch(async () => {
        await btn.reply({ embeds: [ack], ephemeral: true }).catch(() => {});
      });
    })
    .onButton("snooze_tomorrow9", async (btn) => {
      const { extras } = mod.ids.parse(btn.customId);
      const rid = extras?.id;
      if (!rid) return;
      const col = await mod.mongo.getCollection(RCOL);
      const doc = await col.findOne({ _id: rid });
      if (!doc) return;
      const newDue = calcSnooze(doc.dueAt, "tomorrow9", doc.tz);
      await updateReminder(mod, rid, { dueAt: newDue, status: "scheduled" });
      const ack = embed.info({ title: "Snoozed", description: "Snoozed until tomorrow 9am." });
      await btn.update({ embeds: [ack], components: [] }).catch(async () => {
        await btn.reply({ embeds: [ack], ephemeral: true }).catch(() => {});
      });
    })
    .onButton("complete", async (btn) => {
      const { extras } = mod.ids.parse(btn.customId);
      const rid = extras?.id;
      if (!rid) return;
      await updateReminder(mod, rid, { status: "completed" });
      const done = embed.success({ title: "Completed", description: "Reminder marked as completed." });
      await btn.update({ embeds: [done], components: [] }).catch(async () => {
        await btn.reply({ embeds: [done], ephemeral: true }).catch(() => {});
      });
    });

  const { off } = cmd.register(mod, moduleName, { stateManager: mod.v2.state });
  lifecycle.addDisposable(off);

  // Background sweep every minute as a safety net (re-arm timers after restart)
  const stopSweep = scheduler.schedule("* * * * *", async () => {
    const due = await findDue(mod, Date.now() + 1000);
    for (const d of due) scheduleTimer(mod, d);
  }, { timezone: "UTC", immediate: true });
  lifecycle.addDisposable(stopSweep);

  logger.info("reminders module loaded (with DM + quick snoozes + complete).");
}

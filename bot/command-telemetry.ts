import { performance } from "node:perf_hooks";
import { emptyBotCommandCounters, validBotCommandName, type BotCommandCounters } from "../src/lib/bot-dimensions";

type CommandInteraction = {
  commandName: string; guildId: string | null;
  options?: { getSubcommandGroup: (required: boolean) => string | null; getSubcommand: (required: boolean) => string | null };
};
const reportedFailures = new WeakSet<object>();
export function markBotCommandFailed(interaction: object) { reportedFailures.add(interaction); }

export class BotCommandTracker {
  private global: Record<string, BotCommandCounters> = Object.create(null);
  private guilds = new Map<string, Record<string, BotCommandCounters>>();

  record(command: string, guildId: string | null, failed: boolean, durationMs: number, ackMs: number | null) {
    if (!validBotCommandName(command)) return;
    const update = (values: Record<string, BotCommandCounters>) => {
      const current = values[command] ??= emptyBotCommandCounters();
      current.attempts += 1; current.completed += 1;
      if (failed) current.failures += 1;
      const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
      current.durationMsTotal += duration;
      current.durationMsMax = Math.max(current.durationMsMax, duration);
      if (ackMs !== null && Number.isFinite(ackMs)) {
        const ack = Math.max(0, ackMs);
        current.acknowledged += 1; current.ackMsTotal += ack;
        current.ackMsMax = Math.max(current.ackMsMax, ack);
      }
    };
    update(this.global);
    if (guildId) {
      let values = this.guilds.get(guildId);
      if (!values) { values = Object.create(null) as Record<string, BotCommandCounters>; this.guilds.set(guildId, values); }
      update(values);
    }
  }

  drain() {
    const snapshot = { global: this.global, guilds: this.guilds };
    this.global = Object.create(null); this.guilds = new Map();
    return snapshot;
  }
}

let active: BotCommandTracker | undefined;
export function startCommandTelemetry() {
  const tracker = new BotCommandTracker();
  active = tracker;
  return { drain: () => tracker.drain(), stop: () => { if (active === tracker) active = undefined; } };
}

/** Measure only registered command structure, never option values or identities. */
export async function measureBotCommand<T>(interaction: CommandInteraction, handler: () => Promise<T>, clock = () => performance.now()): Promise<T> {
  const started = clock();
  const tracker = active;
  let failed = false;
  let ackMs: number | null = null;
  const parts = [interaction.commandName];
  try {
    const group = interaction.options?.getSubcommandGroup(false);
    const subcommand = interaction.options?.getSubcommand(false);
    if (group) parts.push(group);
    if (subcommand) parts.push(subcommand);
  } catch { /* Missing subcommand structure is not a command failure. */ }
  const command = parts.join(" ");
  reportedFailures.delete(interaction);
  const target = interaction as unknown as Record<string, unknown>;
  const restores: Array<() => void> = [];
  for (const name of ["reply", "deferReply", "showModal"]) {
    try {
      const original = target[name];
      if (typeof original !== "function") continue;
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      const wrapped = function (this: unknown, ...args: unknown[]) {
        return Promise.resolve(Reflect.apply(original, this, args)).then((result) => {
          if (ackMs === null) ackMs = Math.max(0, clock() - started);
          return result;
        });
      };
      target[name] = wrapped;
      restores.push(() => {
        if (target[name] !== wrapped) return;
        if (descriptor) Object.defineProperty(target, name, descriptor);
        else delete target[name];
      });
    } catch { /* Optional instrumentation must never prevent dispatch. */ }
  }
  try { return await handler(); }
  catch (error) { failed = true; throw error; }
  finally {
    for (const restore of restores) { try { restore(); } catch { /* Best effort. */ } }
    try { tracker?.record(command, interaction.guildId, failed || reportedFailures.has(interaction), clock() - started, ackMs); }
    catch { /* A metrics failure must never alter a command's result. */ }
    reportedFailures.delete(interaction);
  }
}

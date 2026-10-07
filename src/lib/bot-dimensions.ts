export const BOT_NETWORK_SERVICES = ["discord", "osu", "youtube", "db", "local", "other"] as const;
export type BotNetworkService = typeof BOT_NETWORK_SERVICES[number];
export type BotCommandCounters = {
  attempts: number; failures: number; completed: number;
  durationMsTotal: number; durationMsMax: number;
  acknowledged: number; ackMsTotal: number; ackMsMax: number;
};
export type BotServiceCounters = { receivedBytes: number; sentBytes: number };
export type BotTelemetryDimensions = {
  commands: Record<string, BotCommandCounters>;
  services: Partial<Record<BotNetworkService, BotServiceCounters>>;
};
export type BotDimensions = {
  collectionStartedAt: string | null;
  sampleCount: number;
  commands: Array<BotCommandCounters & { command: string; failureRate: number; averageDurationMs: number | null; averageAckMs: number | null }>;
  services: Array<BotServiceCounters & { service: BotNetworkService }>;
};

export function validBotCommandName(value: string) {
  return value.length <= 120 && /^[\p{L}\p{N}_-]+(?: [\p{L}\p{N}_-]+){0,2}$/u.test(value);
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function counter(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
export function emptyBotCommandCounters(): BotCommandCounters {
  return { attempts: 0, failures: 0, completed: 0, durationMsTotal: 0, durationMsMax: 0, acknowledged: 0, ackMsTotal: 0, ackMsMax: 0 };
}

/** Only bounded command names, fixed categories and nonnegative numbers survive. */
export function sanitizeBotDimensions(input: unknown): BotTelemetryDimensions {
  const source = object(input);
  const commands: Record<string, BotCommandCounters> = Object.create(null);
  for (const [name, values] of Object.entries(object(source.commands)).slice(0, 500)) {
    if (!validBotCommandName(name)) continue;
    const item = object(values);
    const attempts = Math.floor(counter(item.attempts));
    const completed = Math.min(attempts, Math.floor(counter(item.completed)));
    const acknowledged = Math.min(attempts, Math.floor(counter(item.acknowledged)));
    commands[name] = {
      attempts, failures: Math.min(attempts, Math.floor(counter(item.failures))), completed,
      durationMsTotal: completed ? counter(item.durationMsTotal) : 0,
      durationMsMax: completed ? counter(item.durationMsMax) : 0,
      acknowledged, ackMsTotal: acknowledged ? counter(item.ackMsTotal) : 0,
      ackMsMax: acknowledged ? counter(item.ackMsMax) : 0,
    };
  }
  const services: BotTelemetryDimensions["services"] = {};
  const traffic = object(source.services);
  for (const name of BOT_NETWORK_SERVICES) {
    if (!(name in traffic)) continue;
    const item = object(traffic[name]);
    services[name] = { receivedBytes: counter(item.receivedBytes), sentBytes: counter(item.sentBytes) };
  }
  return { commands, services };
}

/** Merge only unattempted samples; maxima stay maxima rather than being added. */
export function mergeBotDimensions(left: unknown, right: unknown): BotTelemetryDimensions {
  const before = sanitizeBotDimensions(left);
  const after = sanitizeBotDimensions(right);
  const commands: Record<string, BotCommandCounters> = Object.create(null);
  for (const name of new Set([...Object.keys(before.commands), ...Object.keys(after.commands)])) {
    const a = before.commands[name] ?? emptyBotCommandCounters();
    const b = after.commands[name] ?? emptyBotCommandCounters();
    commands[name] = {
      attempts: a.attempts + b.attempts, failures: a.failures + b.failures, completed: a.completed + b.completed,
      durationMsTotal: a.durationMsTotal + b.durationMsTotal, durationMsMax: Math.max(a.durationMsMax, b.durationMsMax),
      acknowledged: a.acknowledged + b.acknowledged, ackMsTotal: a.ackMsTotal + b.ackMsTotal, ackMsMax: Math.max(a.ackMsMax, b.ackMsMax),
    };
  }
  const services: BotTelemetryDimensions["services"] = {};
  for (const name of BOT_NETWORK_SERVICES) {
    if (!before.services[name] && !after.services[name]) continue;
    services[name] = { receivedBytes: (before.services[name]?.receivedBytes ?? 0) + (after.services[name]?.receivedBytes ?? 0), sentBytes: (before.services[name]?.sentBytes ?? 0) + (after.services[name]?.sentBytes ?? 0) };
  }
  return { commands, services };
}

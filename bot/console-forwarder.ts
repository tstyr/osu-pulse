import { open, stat } from "node:fs/promises";
import path from "node:path";
import { inspect } from "node:util";

import { listGuildAutomationChannels } from "@/db/feature-repository";
import { sendDiscordChannelMessage } from "@/lib/discord/rest";

type Level = "LOG" | "INFO" | "WARN" | "ERROR" | "DEBUG";
type BufferedLine = { source: string; level: Level; value: string; at: string };

const originals = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

function redactionValues() {
  return Object.entries(process.env).flatMap(([name, value]) => (
    value && value.length >= 8 && /(token|secret|password|api[_-]?key|database_url|access_key)/i.test(name)
      ? [value]
      : []
  ));
}

function redact(input: string) {
  let value = input
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(token|secret|password|api[_-]?key|database_url|access_key)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[REDACTED]")
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}/g, "[REDACTED_DISCORD_TOKEN]");
  for (const secret of redactionValues()) value = value.split(secret).join("[REDACTED]");
  return value.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 8_000);
}

function stringify(values: unknown[]) {
  return redact(values.map((value) => typeof value === "string" ? value : inspect(value, { depth: 4, breakLength: 160 })).join(" "));
}

export function startConsoleForwarder() {
  const queue: BufferedLine[] = [];
  const offsets = new Map<string, number>();
  let channels: string[] = [];
  let stopped = false;
  let forwarding = false;

  const enqueue = (source: string, level: Level, value: string) => {
    if (!value.trim()) return;
    queue.push({ source, level, value: redact(value), at: new Date().toISOString() });
    if (queue.length > 20_000) queue.splice(0, queue.length - 20_000);
  };

  const patchConsole = (method: keyof typeof originals, level: Level) => {
    console[method] = ((...values: unknown[]) => {
      originals[method](...values);
      if (!forwarding) enqueue("bot", level, stringify(values));
    }) as typeof console[typeof method];
  };
  patchConsole("log", "LOG");
  patchConsole("info", "INFO");
  patchConsole("warn", "WARN");
  patchConsole("error", "ERROR");
  patchConsole("debug", "DEBUG");

  const files = [
    { source: "renderer", file: path.join(process.cwd(), "renderer", "logs", "renderer.log") },
    { source: "lavalink", file: path.join(process.cwd(), "lavalink", "logs", "lavalink.log") },
  ];

  async function refreshChannels() {
    const rows = await listGuildAutomationChannels();
    channels = [...new Set(rows.flatMap((row) => row.consoleLogChannelId ? [row.consoleLogChannelId] : []))];
  }

  async function readAppended(source: string, file: string) {
    let current;
    try { current = await stat(file); } catch { return; }
    const previous = offsets.get(file);
    if (previous === undefined || current.size < previous) {
      offsets.set(file, current.size);
      return;
    }
    if (current.size === previous) return;
    const length = Math.min(current.size - previous, 512_000);
    const start = current.size - length;
    const handle = await open(file, "r");
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      for (const line of buffer.toString("utf8").split(/\r?\n/).filter(Boolean)) enqueue(source, "INFO", line);
      offsets.set(file, current.size);
    } finally {
      await handle.close();
    }
  }

  async function flush() {
    if (!channels.length || !queue.length || forwarding) return;
    const batch = queue.splice(0, Math.min(queue.length, 120));
    const blocks: string[] = [];
    let current = "";
    for (const item of batch) {
      const line = `${item.at.slice(11, 19)} [${item.source}/${item.level}] ${item.value.replace(/```/g, "`​``")}\n`;
      if (current.length + line.length > 1_750) { blocks.push(current); current = ""; }
      current += line.slice(0, 1_750);
    }
    if (current) blocks.push(current);
    forwarding = true;
    try {
      for (const block of blocks) {
        await Promise.allSettled(channels.map((channelId) => sendDiscordChannelMessage(channelId, {
          content: `\`\`\`text\n${block}\`\`\``,
          allowed_mentions: { parse: [] },
        })));
      }
    } finally {
      forwarding = false;
    }
  }

  void refreshChannels().catch((error) => originals.error("[console-forwarder] channel load failed", error));
  const channelTimer = setInterval(() => void refreshChannels().catch((error) => originals.error("[console-forwarder] channel refresh failed", error)), 60_000);
  const fileTimer = setInterval(() => void Promise.all(files.map((item) => readAppended(item.source, item.file))).catch((error) => originals.error("[console-forwarder] log tail failed", error)), 2_000);
  const flushTimer = setInterval(() => void flush().catch((error) => originals.error("[console-forwarder] flush failed", error)), 4_000);
  channelTimer.unref(); fileTimer.unref(); flushTimer.unref();

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(channelTimer); clearInterval(fileTimer); clearInterval(flushTimer);
    Object.assign(console, originals);
  };
}

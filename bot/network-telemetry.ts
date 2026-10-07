import { Socket } from "node:net";
import type { EventEmitter } from "node:events";
import { BOT_NETWORK_SERVICES, type BotNetworkService, type BotServiceCounters } from "../src/lib/bot-dimensions";

export type NetworkTotals = {
  receivedBytes: number;
  sentBytes: number;
  externalReceivedBytes: number;
  externalSentBytes: number;
  localReceivedBytes: number;
  localSentBytes: number;
};

type ObservedSocket = Pick<Socket, "bytesRead" | "bytesWritten" | "remoteAddress"> & Pick<EventEmitter, "once" | "off"> & { remotePort?: number; servername?: string };
type Endpoint = { host?: string; port?: number };
type ServiceTotals = Record<BotNetworkService, BotServiceCounters>;
type SocketObservation = { socket: ObservedSocket; initialRead: number; initialWritten: number; local: boolean | null; service: BotNetworkService; connected: () => void; closed: () => void };

function emptyTotals(): NetworkTotals {
  return { receivedBytes: 0, sentBytes: 0, externalReceivedBytes: 0, externalSentBytes: 0, localReceivedBytes: 0, localSentBytes: 0 };
}

function bytes(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function emptyServices(): ServiceTotals {
  return Object.fromEntries(BOT_NETWORK_SERVICES.map((service) => [service, { receivedBytes: 0, sentBytes: 0 }])) as ServiceTotals;
}

function domain(host: string, expected: string) { return host === expected || host.endsWith(`.${expected}`); }

/** The host is used transiently for classification, never returned or stored. */
export function classifyNetworkService(host: string | undefined, port?: number, address?: string): BotNetworkService {
  const normalized = (host ?? "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  try {
    const database = new URL(process.env.DATABASE_URL ?? "");
    const databaseHost = database.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const databasePort = Number(database.port || 5432);
    const equivalentLocal = (normalized === "localhost" || isLoopbackAddress(normalized) || !normalized && !!address && isLoopbackAddress(address))
      && (databaseHost === "localhost" || isLoopbackAddress(databaseHost));
    if (port === databasePort && (normalized === databaseHost || equivalentLocal)) return "db";
  } catch { /* No valid DB endpoint is available for classification. */ }
  if (["discord.com", "discordapp.com", "discord.gg", "discord.media", "discordapp.net"].some((item) => domain(normalized, item))) return "discord";
  if (["ppy.sh", "osuassets.com"].some((item) => domain(normalized, item))) return "osu";
  if (["youtube.com", "googlevideo.com", "ytimg.com", "youtubei.googleapis.com"].some((item) => domain(normalized, item))) return "youtube";
  if (normalized === "localhost" || isLoopbackAddress(normalized) || address && isLoopbackAddress(address)) return "local";
  return "other";
}

function connectionEndpoint(args: readonly unknown[]): Endpoint {
  const first = args[0];
  if (Array.isArray(first)) return connectionEndpoint(first);
  if (first && typeof first === "object") {
    const options = first as { host?: unknown; servername?: unknown; port?: unknown };
    const host = typeof options.servername === "string" ? options.servername : typeof options.host === "string" ? options.host : undefined;
    const port = Number(options.port);
    return { host, port: Number.isFinite(port) ? port : undefined };
  }
  return { host: typeof args[1] === "string" ? args[1] : undefined, port: typeof first === "number" ? first : undefined };
}

export function isLoopbackAddress(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  return normalized === "::1" || normalized === "0:0:0:0:0:0:0:1"
    || /^127\./.test(normalized)
    || /^::ffff:127\./.test(normalized)
    || /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(normalized);
}

/** Only public Socket counters are read. No payloads, writes or connections are altered. */
export class NetworkByteTracker {
  private readonly active = new Map<ObservedSocket, SocketObservation>();
  private readonly closed = emptyTotals();
  private readonly closedServices = emptyServices();
  private stopped = false;

  track(socket: ObservedSocket, endpoint: Endpoint = {}) {
    if (this.stopped || this.active.has(socket)) return;
    const observation: SocketObservation = {
      socket,
      initialRead: bytes(socket.bytesRead),
      initialWritten: bytes(socket.bytesWritten),
      local: socket.remoteAddress ? isLoopbackAddress(socket.remoteAddress) : null,
      service: classifyNetworkService(endpoint.host ?? socket.servername, endpoint.port ?? socket.remotePort, socket.remoteAddress),
      connected: () => {
        try {
          if (socket.remoteAddress) observation.local = isLoopbackAddress(socket.remoteAddress);
          observation.service = classifyNetworkService(endpoint.host ?? socket.servername, endpoint.port ?? socket.remotePort, socket.remoteAddress);
        }
        catch { /* A metrics getter must not break a connection event. */ }
      },
      closed: () => {
        try { this.addObservation(this.closed, observation); } catch { /* Optional counters only. */ }
        try { this.addServiceObservation(this.closedServices, observation); } catch { /* Optional counters only. */ }
        this.active.delete(socket);
        try { socket.off("connect", observation.connected); } catch { /* Best-effort cleanup. */ }
      },
    };
    this.active.set(socket, observation);
    socket.once("connect", observation.connected);
    socket.once("close", observation.closed);
  }

  private addObservation(totals: NetworkTotals, observation: SocketObservation) {
    // IPC sockets and failed connections without a resolved peer are excluded.
    if (observation.local === null) return;
    const received = Math.max(0, bytes(observation.socket.bytesRead) - observation.initialRead);
    const sent = Math.max(0, bytes(observation.socket.bytesWritten) - observation.initialWritten);
    totals.receivedBytes += received;
    totals.sentBytes += sent;
    if (observation.local) {
      totals.localReceivedBytes += received;
      totals.localSentBytes += sent;
    } else {
      totals.externalReceivedBytes += received;
      totals.externalSentBytes += sent;
    }
  }

  snapshot(): NetworkTotals {
    const result = { ...this.closed };
    for (const observation of this.active.values()) {
      try { this.addObservation(result, observation); } catch { /* Do not fail Bot metrics on one socket. */ }
    }
    return result;
  }

  private addServiceObservation(totals: ServiceTotals, observation: SocketObservation) {
    if (observation.local === null) return;
    const service = totals[observation.service];
    service.receivedBytes += Math.max(0, bytes(observation.socket.bytesRead) - observation.initialRead);
    service.sentBytes += Math.max(0, bytes(observation.socket.bytesWritten) - observation.initialWritten);
  }

  servicesSnapshot(): ServiceTotals {
    const result = Object.fromEntries(BOT_NETWORK_SERVICES.map((key) => [key, { ...this.closedServices[key] }])) as ServiceTotals;
    for (const observation of this.active.values()) {
      try { this.addServiceObservation(result, observation); } catch { /* Optional counters only. */ }
    }
    return result;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const observation of this.active.values()) {
      try { this.addObservation(this.closed, observation); } catch { /* Optional counters only. */ }
      try { this.addServiceObservation(this.closedServices, observation); } catch { /* Optional counters only. */ }
      try {
        observation.socket.off("connect", observation.connected);
        observation.socket.off("close", observation.closed);
      } catch { /* Best-effort cleanup. */ }
    }
    this.active.clear();
  }
}

type NetworkMonitor = { snapshot: () => NetworkTotals; servicesSnapshot: () => ServiceTotals; stop: () => void };
let installed: NetworkMonitor | undefined;

/** Observe TCP sockets opened by this process, not NIC or voice UDP traffic. */
export function startNetworkTelemetry(): NetworkMonitor {
  if (installed) return installed;
  const original = Socket.prototype.connect;
  const tracker = new NetworkByteTracker();
  const wrapped = function (this: Socket, ...args: Parameters<Socket["connect"]>) {
    // Original errors/this/return value must be preserved. Instrumentation errors
    // alone are ignored so optional metrics can never break a real connection.
    const result = original.apply(this, args);
    try { tracker.track(this, connectionEndpoint(args)); } catch { /* Best-effort observation only. */ }
    return result;
  } as Socket["connect"];
  Socket.prototype.connect = wrapped;
  const monitor: NetworkMonitor = {
    snapshot: () => tracker.snapshot(),
    servicesSnapshot: () => tracker.servicesSnapshot(),
    stop: () => {
      if (installed !== monitor) return;
      if (Socket.prototype.connect === wrapped) Socket.prototype.connect = original;
      tracker.stop();
      installed = undefined;
    },
  };
  installed = monitor;
  return monitor;
}

import { Socket } from "node:net";
import type { EventEmitter } from "node:events";

export type NetworkTotals = {
  receivedBytes: number;
  sentBytes: number;
  externalReceivedBytes: number;
  externalSentBytes: number;
  localReceivedBytes: number;
  localSentBytes: number;
};

type ObservedSocket = Pick<Socket, "bytesRead" | "bytesWritten" | "remoteAddress"> & Pick<EventEmitter, "once" | "off">;
type SocketObservation = { socket: ObservedSocket; initialRead: number; initialWritten: number; local: boolean | null; connected: () => void; closed: () => void };

function emptyTotals(): NetworkTotals {
  return { receivedBytes: 0, sentBytes: 0, externalReceivedBytes: 0, externalSentBytes: 0, localReceivedBytes: 0, localSentBytes: 0 };
}

function bytes(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
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
  private stopped = false;

  track(socket: ObservedSocket) {
    if (this.stopped || this.active.has(socket)) return;
    const observation: SocketObservation = {
      socket,
      initialRead: bytes(socket.bytesRead),
      initialWritten: bytes(socket.bytesWritten),
      local: socket.remoteAddress ? isLoopbackAddress(socket.remoteAddress) : null,
      connected: () => {
        try { if (socket.remoteAddress) observation.local = isLoopbackAddress(socket.remoteAddress); }
        catch { /* A metrics getter must not break a connection event. */ }
      },
      closed: () => {
        try { this.addObservation(this.closed, observation); } catch { /* Optional counters only. */ }
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

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const observation of this.active.values()) {
      try { this.addObservation(this.closed, observation); } catch { /* Optional counters only. */ }
      try {
        observation.socket.off("connect", observation.connected);
        observation.socket.off("close", observation.closed);
      } catch { /* Best-effort cleanup. */ }
    }
    this.active.clear();
  }
}

type NetworkMonitor = { snapshot: () => NetworkTotals; stop: () => void };
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
    try { tracker.track(this); } catch { /* Best-effort observation only. */ }
    return result;
  } as Socket["connect"];
  Socket.prototype.connect = wrapped;
  const monitor: NetworkMonitor = {
    snapshot: () => tracker.snapshot(),
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

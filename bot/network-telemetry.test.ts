import { EventEmitter, once } from "node:events";
import { createConnection, createServer, Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isLoopbackAddress, NetworkByteTracker, startNetworkTelemetry } from "./network-telemetry";

class FakeSocket extends EventEmitter {
  bytesRead = 0;
  bytesWritten = 0;
  remoteAddress: string | undefined;
}

afterEach(() => vi.restoreAllMocks());

describe("Bot socket network measurement", () => {
  it.each(["127.0.0.1", "127.1.2.3", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1", "::ffff:7f00:1"])("recognizes loopback %s", (address) => {
    expect(isLoopbackAddress(address)).toBe(true);
  });

  it("separates local/external traffic and keeps closed-socket bytes without double counting", () => {
    const tracker = new NetworkByteTracker();
    const local = new FakeSocket();
    const external = new FakeSocket();
    tracker.track(local);
    tracker.track(local);
    tracker.track(external);
    local.remoteAddress = "::ffff:127.0.0.1";
    external.remoteAddress = "203.0.113.4";
    local.emit("connect"); external.emit("connect");
    local.bytesRead = 15; local.bytesWritten = 7;
    external.bytesRead = 80; external.bytesWritten = 40;
    const expected = { receivedBytes: 95, sentBytes: 47, localReceivedBytes: 15, localSentBytes: 7, externalReceivedBytes: 80, externalSentBytes: 40 };
    expect(tracker.snapshot()).toEqual(expected);
    external.emit("close");
    expect(tracker.snapshot()).toEqual(expected);
    expect(tracker.snapshot()).toEqual(expected);
    tracker.stop();
    expect(local.listenerCount("close")).toBe(0);
    expect(tracker.snapshot()).toEqual(expected);
  });

  it("does not count old bytes again when a closed socket reconnects with reset counters", () => {
    const tracker = new NetworkByteTracker();
    const socket = new FakeSocket();
    socket.remoteAddress = "127.0.0.1";
    tracker.track(socket);
    socket.bytesRead = 100; socket.emit("close");
    socket.bytesRead = 0; socket.bytesWritten = 0;
    tracker.track(socket);
    socket.bytesRead = 20;
    expect(tracker.snapshot().receivedBytes).toBe(120);
    tracker.stop();
  });

  it("contains failing instrumentation getters during socket events and cleanup", () => {
    const tracker = new NetworkByteTracker();
    const socket = new FakeSocket();
    tracker.track(socket);
    Object.defineProperty(socket, "remoteAddress", { get: () => { throw new Error("metrics getter failed"); } });
    Object.defineProperty(socket, "bytesRead", { get: () => { throw new Error("metrics getter failed"); } });
    expect(() => socket.emit("connect")).not.toThrow();
    expect(() => tracker.snapshot()).not.toThrow();
    expect(() => socket.emit("close")).not.toThrow();
    expect(() => tracker.stop()).not.toThrow();
  });

  it("preserves original connect return, this, thrown errors and restores only its own hook", () => {
    const marker = new Error("original error");
    const original = vi.spyOn(Socket.prototype, "connect").mockImplementation(function (this: Socket) {
      if (this.destroyed) throw marker;
      return this;
    });
    const monitor = startNetworkTelemetry();
    const hook = Socket.prototype.connect;
    expect(startNetworkTelemetry()).toBe(monitor);
    expect(Socket.prototype.connect).toBe(hook);
    const socket = new Socket();
    expect(socket.connect(1234)).toBe(socket);
    expect(original).toHaveBeenCalledOnce();
    socket.destroy();
    expect(() => socket.connect(1234)).toThrow(marker);
    monitor.stop();
    expect(Socket.prototype.connect).toBe(original);
  });

  it("counts a real loopback echo connection, including after close", async () => {
    const monitor = startNetworkTelemetry();
    const server = createServer((socket) => { socket.on("data", (data) => socket.end(data)); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No TCP server address");
    const socket = createConnection(address.port, "127.0.0.1");
    try {
      await once(socket, "connect");
      socket.write("test bytes");
      const [data] = await once(socket, "data");
      expect(Buffer.from(data).toString()).toBe("test bytes");
      await once(socket, "close");
      const result = monitor.snapshot();
      expect(result.localReceivedBytes).toBeGreaterThanOrEqual(10);
      expect(result.localSentBytes).toBeGreaterThanOrEqual(10);
      expect(result.externalReceivedBytes).toBe(0);
    } finally {
      socket.destroy();
      monitor.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

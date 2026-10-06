import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ delay: vi.fn() }));
vi.mock("./worker-delay", () => ({ workerDelay: mocks.delay }));

import { runSupervisedWorker } from "./supervised-worker";

describe("supervised background workers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.delay.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["synchronous", "asynchronous"])("restarts a %s failure with capped exponential backoff", async (kind) => {
    const controller = new AbortController();
    let attempts = 0;
    const task = vi.fn(() => {
      attempts += 1;
      if (attempts === 10) {
        controller.abort();
        return Promise.resolve();
      }
      if (kind === "synchronous") throw new Error("worker failed");
      return Promise.reject(new Error("worker failed"));
    });

    await runSupervisedWorker("notifications", task, controller.signal);

    expect(task).toHaveBeenCalledTimes(10);
    expect(mocks.delay.mock.calls.map(([delay]) => delay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000,
    ]);
    expect(task).toHaveBeenCalledWith(controller.signal);
  });

  it("also restarts an unexpected successful return", async () => {
    const controller = new AbortController();
    const task = vi.fn().mockResolvedValueOnce(undefined).mockImplementationOnce(async () => { controller.abort(); });

    await runSupervisedWorker("notifications", task, controller.signal);

    expect(task).toHaveBeenCalledTimes(2);
    expect(mocks.delay).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("restarting in 1000ms"),
      expect.objectContaining({ message: "notifications worker returned before shutdown" }),
    );
  });

  it("resets backoff after a stable run", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const controller = new AbortController();
    const task = vi.fn()
      .mockRejectedValueOnce(new Error("startup failed"))
      .mockImplementationOnce(async () => {
        now += 5 * 60_000;
        throw new Error("failed after healthy operation");
      })
      .mockImplementationOnce(async () => { controller.abort(); });

    await runSupervisedWorker("poller", task, controller.signal);

    expect(mocks.delay.mock.calls.map(([delay]) => delay)).toEqual([1_000, 1_000]);
  });

  it("never overlaps an active worker and does not restart it after shutdown", async () => {
    const controller = new AbortController();
    let finish!: () => void;
    const task = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const running = runSupervisedWorker("poller", task, controller.signal);
    await Promise.resolve();

    expect(task).toHaveBeenCalledOnce();
    expect(mocks.delay).not.toHaveBeenCalled();
    controller.abort();
    finish();
    await running;
    expect(task).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("interrupts retry backoff promptly on shutdown without restarting", async () => {
    const actual = await vi.importActual<typeof import("./worker-delay")>("./worker-delay");
    const controller = new AbortController();
    let enteredWait!: () => void;
    const waiting = new Promise<void>((resolve) => { enteredWait = resolve; });
    mocks.delay.mockImplementation((milliseconds: number, signal: AbortSignal) => {
      enteredWait();
      return actual.workerDelay(milliseconds, signal);
    });
    const task = vi.fn().mockRejectedValue(new Error("worker failed"));
    const running = runSupervisedWorker("notifications", task, controller.signal);
    await waiting;
    controller.abort();
    await running;

    expect(task).toHaveBeenCalledOnce();
    expect(mocks.delay).toHaveBeenCalledOnce();
  });

  it("does not start a worker with an already-aborted shutdown signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const task = vi.fn();

    await runSupervisedWorker("notifications", task, controller.signal);

    expect(task).not.toHaveBeenCalled();
    expect(mocks.delay).not.toHaveBeenCalled();
  });
});

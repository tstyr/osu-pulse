import { describe, expect, it, vi } from "vitest";

import { startBackgroundTask } from "./background-task";

describe("independent worker startup", () => {
  it("starts core notification work even while an optional connection never resolves", async () => {
    const music = vi.fn(() => new Promise(() => undefined));
    const notifications = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    startBackgroundTask(music, onError);
    startBackgroundTask(notifications, onError);
    await vi.waitFor(() => expect(notifications).toHaveBeenCalledOnce());
    expect(music).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(["synchronous", "asynchronous"])("contains a %s startup failure without losing other workers", async (kind) => {
    const failure = new Error("optional connection failed");
    const broken = () => {
      if (kind === "synchronous") throw failure;
      return Promise.reject(failure);
    };
    const core = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    startBackgroundTask(broken, onError);
    startBackgroundTask(core, onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    expect(core).toHaveBeenCalledOnce();
  });
});

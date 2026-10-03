import { describe, expect, it } from "vitest";
import { workerDelay } from "./worker-delay";

describe("worker cancellation", () => {
  it("interrupts a long polling delay immediately on shutdown", async () => {
    const controller = new AbortController();
    const waiting = workerDelay(180_000, controller.signal);
    controller.abort();
    await expect(waiting).resolves.toBeUndefined();
  });
  it("does not allocate a wait after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(workerDelay(180_000, controller.signal)).resolves.toBeUndefined();
  });
});

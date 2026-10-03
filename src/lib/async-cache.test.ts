import { afterEach, expect, it, vi } from "vitest";
import { cachedAsync } from "./async-cache";
afterEach(() => vi.useRealTimers());

it("shares slow in-flight work even after the TTL interval elapses", async () => {
  vi.useFakeTimers();
  let finish!: (value: number) => void;
  const read = vi.fn(() => new Promise<number>((resolve) => { finish = resolve; }));
  const cached = cachedAsync(read, 100);
  const first = cached();
  await Promise.resolve();
  vi.advanceTimersByTime(1000);
  expect(cached()).toBe(first);
  finish(42);
  await first;
  expect(await cached()).toBe(42);
  expect(read).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(101);
  expect(cached()).not.toBe(first);
});

it("retries a failed read instead of caching the rejection", async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(7);
  const cached = cachedAsync(read, 1000);
  await expect(cached()).rejects.toThrow("offline");
  await expect(cached()).resolves.toBe(7);
});

import { describe, expect, it, vi } from "vitest";

import {
  DatabaseQuotaExceededError,
  DatabaseUnavailableError,
  databaseResultRows,
  isLocalDatabaseUrl,
  localDatabasePoolSize,
  isTransientDatabaseError,
  withDatabaseRetry,
} from "./index";

describe("database drivers", () => {
  it("detects loopback PostgreSQL URLs only", () => {
    expect(isLocalDatabaseUrl("postgresql://postgres:test@127.0.0.1:54329/osu_pulse")).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://postgres:test@localhost:54329/osu_pulse")).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://postgres:test@[::1]:54329/osu_pulse")).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://user:test@example.neon.tech/db")).toBe(false);
    expect(isLocalDatabaseUrl("not-a-url")).toBe(false);
  });

  it("keeps local connection pools bounded even with invalid configuration", () => {
    expect(localDatabasePoolSize("broken")).toBe(5);
    expect(localDatabasePoolSize("Infinity")).toBe(5);
    expect(localDatabasePoolSize("0")).toBe(1);
    expect(localDatabasePoolSize("500")).toBe(20);
    expect(localDatabasePoolSize("4.8")).toBe(4);
  });

  it("normalizes execute rows from both Neon and postgres-js", () => {
    expect(databaseResultRows<{ ok: number }>({ rows: [{ ok: 1 }] })).toEqual([{ ok: 1 }]);
    expect(databaseResultRows<{ ok: number }>([{ ok: 1 }])).toEqual([{ ok: 1 }]);
  });
});

describe("database retry", () => {
  it("retries a nested transient Neon error", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("Failed query", { cause: Object.assign(new Error("fetch failed"), { code: "UNAVAILABLE" }) }))
      .mockResolvedValue("ok");

    await expect(withDatabaseRetry(operation, { attempts: 3, delayMs: 0 })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry a permanent query error", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("column does not exist"));
    await expect(withDatabaseRetry(operation, { attempts: 3, delayMs: 0 })).rejects.toThrow("column does not exist");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("returns a friendly error after transient retries are exhausted", async () => {
    const operation = vi.fn().mockRejectedValue(Object.assign(new Error("network error"), { code: "ECONNRESET" }));
    await expect(withDatabaseRetry(operation, { attempts: 2, delayMs: 0 })).rejects.toBeInstanceOf(DatabaseUnavailableError);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(isTransientDatabaseError(new Error("request timed out"))).toBe(true);
  });

  it("does not retry when the Neon transfer quota is exhausted", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("Failed query", {
      cause: new Error('Server error (HTTP status 402): {"message":"Your project has exceeded the data transfer quota."}'),
    }));
    await expect(withDatabaseRetry(operation, { attempts: 3, delayMs: 0 })).rejects.toBeInstanceOf(DatabaseQuotaExceededError);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

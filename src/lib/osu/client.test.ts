import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/feature-repository", () => ({
  recordServiceUsage: vi.fn().mockResolvedValue(undefined),
}));

import {
  clearOsuTokenCache,
  getBeatmapDifficultyAttributes,
  getOsuScore,
  getRecentScores,
  osuApiTimeoutMs,
} from "./client";

const testCredentials = { clientId: "test-client", clientSecret: "test-secret" };
const fetchMock = vi.fn<typeof fetch>();
const tokenResponse = () => Response.json({ access_token: "test-token", expires_in: 3_600 });

function waitForAbort(signal: AbortSignal | null | undefined): Promise<never> {
  if (!signal) return Promise.reject(new Error("Request must include an abort signal"));
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

function makeRequest(method: "GET" | "POST") {
  return method === "GET"
    ? getRecentScores(42, "mania", 50, testCredentials)
    : getBeatmapDifficultyAttributes(42, "osu", [], testCredentials);
}

beforeEach(() => {
  clearOsuTokenCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("OSU_API_TIMEOUT_MS", "20000");
  vi.useFakeTimers();
  // Native AbortSignal.timeout uses Node's internal timer, so use an equivalent
  // controlled signal to prove cancellation without real waits or API requests.
  vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), milliseconds);
    return controller.signal;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  clearOsuTokenCache();
});

describe("osu! API request timeouts", () => {
  it.each([
    ["", 20_000],
    ["invalid", 20_000],
    ["Infinity", 20_000],
    ["NaN", 20_000],
    ["-100", 1_000],
    ["0", 1_000],
    ["500", 1_000],
    [" 1500.9 ", 1_500],
    ["35000", 35_000],
    ["999999999", 60_000],
  ])("bounds OSU_API_TIMEOUT_MS=%s to %i", (configured, expected) => {
    vi.stubEnv("OSU_API_TIMEOUT_MS", configured);
    expect(osuApiTimeoutMs()).toBe(expected);
  });

  it("ends a stalled OAuth request without retrying", async () => {
    fetchMock.mockImplementation((_url, init) => waitForAbort(init?.signal));
    const outcome = makeRequest("GET").catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await outcome).toMatchObject({ name: "TimeoutError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("can collect again after OAuth times out without caching the failed request", async () => {
    fetchMock.mockImplementationOnce((_url, init) => waitForAbort(init?.signal));
    const outcome = makeRequest("GET").catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await outcome).toMatchObject({ name: "TimeoutError" });
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(Response.json([]));
    await expect(makeRequest("GET")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(["GET", "POST"] as const)("ends stalled %s requests without timeout retries", async (method) => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    fetchMock.mockImplementation((_url, init) => waitForAbort(init?.signal));
    const outcome = makeRequest(method).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await outcome).toMatchObject({ name: "TimeoutError" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.method ?? "GET").toBe(method);
  });

  it("gives the API its full deadline after a slow OAuth response", async () => {
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve(tokenResponse()), 19_000);
    }));
    fetchMock.mockImplementation((_url, init) => waitForAbort(init?.signal));
    let settled = false;
    const outcome = makeRequest("GET").catch((error: Error) => error).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(19_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({ name: "TimeoutError" });
  });

  it.each(["GET", "POST"] as const)("keeps the signal active while reading a %s response body", async (method) => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const response = Response.json({});
      vi.spyOn(response, "json").mockImplementation(() => waitForAbort(init?.signal));
      return response;
    });
    const outcome = makeRequest(method).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await outcome).toMatchObject({ name: "TimeoutError" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["GET", "POST"] as const)("preserves the one-time 401 refresh for %s with independent signals", async (method) => {
    const expected = method === "GET" ? [] : { attributes: {} };
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json(expected));
    await expect(makeRequest(method)).resolves.toEqual(expected);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const signals = fetchMock.mock.calls.map(([, init]) => init?.signal);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
    expect(new Set(signals).size).toBe(4);
    expect(vi.mocked(AbortSignal.timeout).mock.calls).toEqual(Array.from({ length: 4 }, () => [20_000]));
  });

  it.each(["GET", "POST"] as const)("does not repeatedly refresh after a second %s 401", async (method) => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response("", { status: 401 }));
    await expect(makeRequest(method)).rejects.toMatchObject({ name: "OsuApiError", status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("retains the explicit legacy score fallback with a new request deadline", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(Response.json({ id: 42 }));
    await expect(getOsuScore(42, testCredentials, "mania")).resolves.toEqual({ id: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe("https://osu.ppy.sh/api/v2/scores/mania/42");
    expect(fetchMock.mock.calls[1][1]?.signal).not.toBe(fetchMock.mock.calls[2][1]?.signal);
  });
});

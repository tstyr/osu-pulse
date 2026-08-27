import { describe, expect, it } from "vitest";

import { normalizeRendererBaseUrl } from "./renderer-client";

describe("normalizeRendererBaseUrl", () => {
  it("accepts only the loopback renderer origin", () => {
    expect(normalizeRendererBaseUrl("http://127.0.0.1:8765")).toBe("http://127.0.0.1:8765");
  });

  it.each([
    "https://127.0.0.1:8765",
    "http://localhost:8765",
    "http://0.0.0.0:8765",
    "http://192.168.1.10:8765",
    "http://example.com:8765",
    "http://127.0.0.1:8765/api",
  ])("rejects non-loopback or unexpected URL %s", (value) => {
    expect(() => normalizeRendererBaseUrl(value)).toThrow();
  });
});

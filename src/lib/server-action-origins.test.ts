import { describe, expect, it } from "vitest";
import { serverActionAllowedOrigins } from "./server-action-origins";

describe("Server Action proxy origins", () => {
  it("uses exact configured hosts and retains nonstandard ports", () => {
    expect(serverActionAllowedOrigins({
      WEB_APP_URL: "https://osu-pulse.vercel.app/",
      NEXT_PUBLIC_APP_URL: "https://example.com:8443/dashboard",
      VERCEL_PROJECT_PRODUCTION_URL: "osu-pulse.vercel.app",
    })).toEqual(["osu-pulse.vercel.app", "example.com:8443"]);
  });
  it("never permits wildcard, credential-bearing, or unsupported URLs", () => {
    expect(serverActionAllowedOrigins({ WEB_APP_URL: "https://*.vercel.app", NEXT_PUBLIC_APP_URL: "https://user:password@example.com" })).toEqual([]);
    expect(serverActionAllowedOrigins({ WEB_APP_URL: "javascript:alert(1)", NEXT_PUBLIC_APP_URL: "malformed" })).toEqual([]);
  });
  it("leaves same-origin protection unchanged when no public host is configured", () => {
    expect(serverActionAllowedOrigins({})).toEqual([]);
    expect(serverActionAllowedOrigins({ WEB_APP_URL: "http://localhost:3000" })).toEqual(["localhost:3000"]);
  });
});

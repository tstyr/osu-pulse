import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { publicAppOrigin, publicAppUrl } from "./public-app-url";

const originalWebAppUrl = process.env.WEB_APP_URL;
const originalVercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const originalPublicUrlFile = process.env.OSU_PULSE_PUBLIC_URL_FILE;
const originalVercel = process.env.VERCEL;
const temporaryDirectories: string[] = [];

afterEach(() => {
  if (originalWebAppUrl === undefined) delete process.env.WEB_APP_URL;
  else process.env.WEB_APP_URL = originalWebAppUrl;
  if (originalVercelProductionUrl === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  else process.env.VERCEL_PROJECT_PRODUCTION_URL = originalVercelProductionUrl;
  if (originalPublicUrlFile === undefined) delete process.env.OSU_PULSE_PUBLIC_URL_FILE;
  else process.env.OSU_PULSE_PUBLIC_URL_FILE = originalPublicUrlFile;
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("publicAppUrl", () => {
  it("keeps localhost as the local fallback", () => {
    process.env.WEB_APP_URL = "http://localhost:3000";
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    process.env.OSU_PULSE_PUBLIC_URL_FILE = join(tmpdir(), "missing-osu-pulse-public-url");
    expect(publicAppUrl("/compare/1/2?mode=mania")).toBe("http://localhost:3000/compare/1/2?mode=mania");
  });

  it("uses an explicitly configured public origin", () => {
    process.env.WEB_APP_URL = "https://pulse.example.com/";
    expect(publicAppOrigin()).toBe("https://pulse.example.com");
  });

  it("prefers the active Cloudflare Tunnel URL on the local host", () => {
    const directory = mkdtempSync(join(tmpdir(), "osu-pulse-url-"));
    temporaryDirectories.push(directory);
    const urlFile = join(directory, "public-web-url.txt");
    writeFileSync(urlFile, "https://current-tunnel.trycloudflare.com\n", "utf8");
    process.env.OSU_PULSE_PUBLIC_URL_FILE = urlFile;
    process.env.WEB_APP_URL = "http://127.0.0.1:3000";
    delete process.env.VERCEL;
    expect(publicAppOrigin()).toBe("https://current-tunnel.trycloudflare.com");
  });
});

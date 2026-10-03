import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_LOCAL_APP_ORIGIN = "http://127.0.0.1:3000";

function normalizedOrigin(value: string | undefined, options: { requireHttps?: boolean } = {}) {
  const candidate = value?.trim().replace(/\/$/, "");
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (options.requireHttps && url.protocol !== "https:") return null;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function runtimeTunnelOrigin() {
  if (process.env.VERCEL) return null;
  const urlFile = process.env.OSU_PULSE_PUBLIC_URL_FILE?.trim()
    || resolve(process.cwd(), "work", "public-web-url.txt");
  try {
    return normalizedOrigin(readFileSync(/* turbopackIgnore: true */ urlFile, "utf8"), { requireHttps: true });
  } catch {
    return null;
  }
}

function isLoopbackOrigin(origin: string) {
  const hostname = new URL(origin).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";
}

export function publicAppOrigin() {
  const configured = normalizedOrigin(process.env.WEB_APP_URL);
  if (configured && !isLoopbackOrigin(configured)) return configured;
  const tunnel = runtimeTunnelOrigin();
  if (tunnel) return tunnel;
  if (configured) return configured;
  const vercelProduction = normalizedOrigin(
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
  );
  return vercelProduction ?? DEFAULT_LOCAL_APP_ORIGIN;
}

export function publicAppUrl(path = "") {
  if (!path) return publicAppOrigin();
  return `${publicAppOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}

import type { OsuMode } from "./modes";
import type { OsuScore, OsuUser } from "./types";

const OSU_API_BASE = "https://osu.ppy.sh/api/v2";
const OSU_TOKEN_URL = "https://osu.ppy.sh/oauth/token";

type CachedToken = {
  value: string;
  expiresAt: number;
};

let cachedToken: CachedToken | undefined;

export class OsuApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "OsuApiError";
  }
}

function credentials() {
  const clientId = process.env.OSU_CLIENT_ID;
  const clientSecret = process.env.OSU_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("OSU_CLIENT_ID and OSU_CLIENT_SECRET are required");
  }

  return { clientId, clientSecret };
}

async function requestToken(): Promise<string> {
  const { clientId, clientSecret } = credentials();
  const response = await fetch(OSU_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "public",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new OsuApiError("osu! OAuth token request failed", response.status);
  }

  const body = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + Math.max(body.expires_in - 60, 60) * 1_000,
  };

  return cachedToken.value;
}

async function accessToken(forceRefresh = false) {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  return requestToken();
}

async function osuFetch<T>(path: string, retry = true): Promise<T> {
  const response = await fetch(`${OSU_API_BASE}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${await accessToken()}`,
      "X-API-Version": "20220705",
    },
    cache: "no-store",
  });

  if (response.status === 401 && retry) {
    await accessToken(true);
    return osuFetch<T>(path, false);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new OsuApiError(
      `osu! API request failed (${response.status})${detail ? `: ${detail}` : ""}`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

export async function getOsuUser(
  usernameOrId: string | number,
  mode: OsuMode = "osu",
) {
  const numeric = /^\d+$/.test(String(usernameOrId));
  const key = numeric ? "" : "?key=username";
  return osuFetch<OsuUser>(
    `/users/${encodeURIComponent(String(usernameOrId))}/${mode}${key}`,
  );
}

export async function getRecentScores(
  userId: number,
  mode: OsuMode,
  limit = 50,
) {
  const query = new URLSearchParams({
    include_fails: "1",
    legacy_only: "0",
    mode,
    limit: String(Math.min(Math.max(limit, 1), 100)),
  });

  return osuFetch<OsuScore[]>(
    `/users/${userId}/scores/recent?${query.toString()}`,
  );
}

export async function getBestScores(
  userId: number,
  mode: OsuMode,
  limit = 10,
) {
  const query = new URLSearchParams({
    legacy_only: "0",
    mode,
    limit: String(Math.min(Math.max(limit, 1), 100)),
  });

  return osuFetch<OsuScore[]>(
    `/users/${userId}/scores/best?${query.toString()}`,
  );
}

export function clearOsuTokenCache() {
  cachedToken = undefined;
}

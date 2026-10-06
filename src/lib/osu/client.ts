import type { OsuMode } from "./modes";
import type { OsuBeatmapDifficultyAttributes, OsuScore, OsuUser } from "./types";
import { recordServiceUsage } from "../../db/feature-repository";

const OSU_API_BASE = "https://osu.ppy.sh/api/v2";
const OSU_TOKEN_URL = "https://osu.ppy.sh/oauth/token";

export function osuApiTimeoutMs() {
  const configured = process.env.OSU_API_TIMEOUT_MS?.trim();
  const milliseconds = configured ? Number(configured) : NaN;
  if (!Number.isFinite(milliseconds)) return 20_000;
  return Math.min(60_000, Math.max(1_000, Math.trunc(milliseconds)));
}

type CachedToken = {
  value: string;
  expiresAt: number;
};

export type OsuApiCredentials = {
  clientId: string;
  clientSecret: string;
};

const cachedTokens = new Map<string, CachedToken>();

export class OsuApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "OsuApiError";
  }
}

function credentials(override?: OsuApiCredentials) {
  if (override?.clientId && override.clientSecret) return override;
  const clientId = process.env.OSU_CLIENT_ID;
  const clientSecret = process.env.OSU_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("OSU_CLIENT_ID and OSU_CLIENT_SECRET are required");
  }

  return { clientId, clientSecret };
}

function credentialsKey(value: OsuApiCredentials) {
  return `${value.clientId}\u0000${value.clientSecret}`;
}

async function requestToken(input?: OsuApiCredentials): Promise<string> {
  const resolved = credentials(input);
  const { clientId, clientSecret } = resolved;
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
    signal: AbortSignal.timeout(osuApiTimeoutMs()),
  });

  if (!response.ok) {
    throw new OsuApiError("osu! OAuth token request failed", response.status);
  }

  const body = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  const cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + Math.max(body.expires_in - 60, 60) * 1_000,
  };
  cachedTokens.set(credentialsKey(resolved), cachedToken);

  return cachedToken.value;
}

async function accessToken(input?: OsuApiCredentials, forceRefresh = false) {
  const resolved = credentials(input);
  const cachedToken = cachedTokens.get(credentialsKey(resolved));
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  return requestToken(resolved);
}

async function osuFetch<T>(path: string, retry = true, input?: OsuApiCredentials): Promise<T> {
  // Start the API deadline after OAuth completes, so each request has its own budget.
  const token = await accessToken(input);
  const response = await fetch(`${OSU_API_BASE}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "X-API-Version": "20220705",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(osuApiTimeoutMs()),
  });

  if (response.status === 401 && retry) {
    await accessToken(input, true);
    return osuFetch<T>(path, false, input);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new OsuApiError(
      `osu! API request failed (${response.status})${detail ? `: ${detail}` : ""}`,
      response.status,
    );
  }

  await recordServiceUsage("osu_api").catch(() => undefined);

  return (await response.json()) as T;
}

async function osuPost<T>(path: string, body: unknown, retry = true, input?: OsuApiCredentials): Promise<T> {
  const token = await accessToken(input);
  const response = await fetch(`${OSU_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-API-Version": "20220705",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(osuApiTimeoutMs()),
  });
  if (response.status === 401 && retry) {
    await accessToken(input, true);
    return osuPost<T>(path, body, false, input);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new OsuApiError(`osu! API request failed (${response.status})${detail ? `: ${detail}` : ""}`, response.status);
  }
  await recordServiceUsage("osu_api").catch(() => undefined);
  return (await response.json()) as T;
}

export async function getOsuUser(
  usernameOrId: string | number,
  mode: OsuMode = "osu",
  input?: OsuApiCredentials,
) {
  const numeric = /^\d+$/.test(String(usernameOrId));
  const key = numeric ? "" : "?key=username";
  return osuFetch<OsuUser>(
    `/users/${encodeURIComponent(String(usernameOrId))}/${mode}${key}`,
    true,
    input,
  );
}

export async function getOsuScore(
  scoreId: string | number,
  input?: OsuApiCredentials,
  legacyMode?: OsuMode,
) {
  if (!/^\d{1,18}$/.test(String(scoreId))) throw new OsuApiError("Invalid osu! score id", 400);
  try {
    return await osuFetch<OsuScore>(`/scores/${encodeURIComponent(String(scoreId))}`, true, input);
  } catch (error) {
    if (!(error instanceof OsuApiError) || error.status !== 404 || !legacyMode) throw error;
    return osuFetch<OsuScore>(
      `/scores/${legacyMode}/${encodeURIComponent(String(scoreId))}`,
      true,
      input,
    );
  }
}

export async function getRecentScores(
  userId: number,
  mode: OsuMode,
  limit = 50,
  input?: OsuApiCredentials,
  options: { includeFails?: boolean } = {},
) {
  const query = new URLSearchParams({
    include_fails: options.includeFails === false ? "0" : "1",
    legacy_only: "0",
    mode,
    limit: String(Math.min(Math.max(limit, 1), 100)),
  });

  return osuFetch<OsuScore[]>(
    `/users/${userId}/scores/recent?${query.toString()}`,
    true,
    input,
  );
}

export async function getBestScores(
  userId: number,
  mode: OsuMode,
  limit = 10,
  input?: OsuApiCredentials,
) {
  const query = new URLSearchParams({
    legacy_only: "0",
    mode,
    limit: String(Math.min(Math.max(limit, 1), 100)),
  });

  return osuFetch<OsuScore[]>(
    `/users/${userId}/scores/best?${query.toString()}`,
    true,
    input,
  );
}

export async function getBeatmapDifficultyAttributes(
  beatmapId: number,
  mode: OsuMode,
  mods: string[] = [],
  input?: OsuApiCredentials,
) {
  return osuPost<{ attributes: OsuBeatmapDifficultyAttributes }>(
    `/beatmaps/${beatmapId}/attributes`,
    { ruleset: mode, mods },
    true,
    input,
  );
}

export function clearOsuTokenCache() {
  cachedTokens.clear();
}

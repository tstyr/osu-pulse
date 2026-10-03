const DISCORD_API_BASE = "https://discord.com/api/v10";

export type DiscordEmbed = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  thumbnail?: { url: string };
  image?: { url: string };
  footer?: { text: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
};

export type DiscordMessagePayload = {
  content?: string;
  embeds?: DiscordEmbed[];
  allowed_mentions?: { parse: string[]; users?: string[] };
};

function botToken() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is not configured");
  return token;
}

async function discordRequest<T>(
  path: string,
  init: RequestInit,
  retry = true,
): Promise<T> {
  const response = await fetch(`${DISCORD_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${botToken()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });

  if (response.status === 429 && retry) {
    const body = (await response.json()) as { retry_after?: number };
    const retryAfter = Number(body.retry_after);
    const delay = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1_000 : 1_000;
    // Leave long rate limits to the persistent delivery worker instead of
    // holding every following notification/reminder indefinitely.
    if (delay > 60_000) throw new Error("Discord API rate limit exceeds 60 seconds; delivery will be retried.");
    await new Promise((resolve) => setTimeout(resolve, delay));
    return discordRequest<T>(path, init, false);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Discord API request failed (${response.status}): ${detail}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function sendDiscordChannelMessage(
  channelId: string,
  payload: DiscordMessagePayload,
) {
  return discordRequest(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function sendDiscordDm(
  discordUserId: string,
  payload: DiscordMessagePayload,
) {
  const channel = await discordRequest<{ id: string }>("/users/@me/channels", {
    method: "POST",
    body: JSON.stringify({ recipient_id: discordUserId }),
  });
  return sendDiscordChannelMessage(channel.id, payload);
}

export type SpotifyPlaylistTrack = {
  title: string;
  author: string;
  searchQuery: string;
  duration: number;
};

let tokenCache: { value: string; expiresAt: number } | null = null;

function playlistId(value: string) {
  const uri = /^spotify:playlist:([A-Za-z0-9]+)$/.exec(value.trim());
  if (uri) return uri[1];
  try {
    const url = new URL(value);
    if (!/(^|\.)spotify\.com$/i.test(url.hostname)) return null;
    return /^\/playlist\/([A-Za-z0-9]+)/.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function accessToken(credentials?: { clientId?: string; clientSecret?: string }) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const clientId = credentials?.clientId?.trim() || process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = credentials?.clientSecret?.trim() || process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Spotify連携にはSPOTIFY_CLIENT_IDとSPOTIFY_CLIENT_SECRETを設定してください。");
  }
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const result = await response.json().catch(() => null) as { access_token?: string; expires_in?: number; error_description?: string } | null;
  if (!response.ok || !result?.access_token) throw new Error(result?.error_description || "Spotify APIの認証に失敗しました。");
  tokenCache = {
    value: result.access_token,
    expiresAt: Date.now() + Math.max(60, result.expires_in ?? 3_600) * 1_000,
  };
  return tokenCache.value;
}

export async function getSpotifyPlaylistTracks(
  value: string,
  maximum = 500,
  credentials?: { clientId?: string; clientSecret?: string },
): Promise<SpotifyPlaylistTrack[]> {
  const id = playlistId(value);
  if (!id) throw new Error("SpotifyプレイリストURLが正しくありません。");
  const token = await accessToken(credentials);
  const safeMaximum = Math.max(1, Math.min(2_000, Math.round(maximum)));
  let next: string | null = `https://api.spotify.com/v1/playlists/${encodeURIComponent(id)}/tracks?limit=100&fields=items(track(name,duration_ms,artists(name),is_local)),next`;
  const tracks: SpotifyPlaylistTrack[] = [];
  while (next && tracks.length < safeMaximum) {
    const response = await fetch(next, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json().catch(() => null) as {
      items?: Array<{ track?: { name?: string; duration_ms?: number; is_local?: boolean; artists?: Array<{ name?: string }> } | null }>;
      next?: string | null;
      error?: { message?: string };
    } | null;
    if (!response.ok) throw new Error(result?.error?.message || "Spotifyプレイリストを取得できませんでした。");
    for (const item of result?.items ?? []) {
      const track = item.track;
      if (!track?.name || track.is_local) continue;
      const author = (track.artists ?? []).flatMap((artist) => artist.name ? [artist.name] : []).join(", ") || "Unknown artist";
      tracks.push({
        title: track.name,
        author,
        searchQuery: `${track.name} ${author}`.trim(),
        duration: Math.max(0, Math.round(track.duration_ms ?? 0)),
      });
      if (tracks.length >= safeMaximum) break;
    }
    next = result?.next ?? null;
  }
  return tracks;
}

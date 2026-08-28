export class RenderApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function parseScoreUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new RenderApiError("INVALID_OSU_URL", "osu! のスコアURLが正しくありません。", 400);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "osu.ppy.sh" ||
    url.port && url.port !== "443" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new RenderApiError("INVALID_OSU_URL", "https://osu.ppy.sh のスコアURLだけ使用できます。", 400);
  }
  const match = /^\/scores\/(?:(osu|mania)\/)?([1-9][0-9]{0,18})\/?$/.exec(url.pathname);
  if (!match || BigInt(match[2]) > BigInt("9223372036854775807")) {
    throw new RenderApiError("INVALID_OSU_URL", "osu!standard または osu!mania のスコアURLを指定してください。", 400);
  }
  return `https://osu.ppy.sh/scores/${match[1] ? `${match[1]}/` : ""}${match[2]}`;
}

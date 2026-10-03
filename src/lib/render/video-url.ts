export type CompletedVideoUrlConfiguration = {
  r2Endpoint?: string | null;
  r2Bucket?: string | null;
  r2PublicBaseUrl?: string | null;
};

const LOCAL_RENDER_OBJECT = "/discord-renders/[0-9a-f]{32}\\.mp4";

function exactOrigin(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export function isAllowedCompletedVideoUrl(
  value: string,
  configuration: CompletedVideoUrlConfiguration = {},
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) return false;

  if (url.hostname === "youtu.be" && /^\/[A-Za-z0-9_-]{6,32}$/.test(url.pathname)) return true;

  if (
    url.hostname.endsWith(".public.blob.vercel-storage.com")
    && !url.search
    && (
      new RegExp(`^${LOCAL_RENDER_OBJECT}$`).test(url.pathname)
      || /^\/renders\/[0-9a-f-]{36}\.mp4$/.test(url.pathname)
    )
  ) return true;

  const endpoint = exactOrigin(configuration.r2Endpoint);
  const bucket = configuration.r2Bucket?.trim();
  if (endpoint && bucket && url.origin === endpoint.origin) {
    const objectPath = new RegExp(`^/${encodeURIComponent(bucket)}${LOCAL_RENDER_OBJECT}$`);
    if (
      objectPath.test(url.pathname)
      && url.searchParams.has("X-Amz-Credential")
      && url.searchParams.has("X-Amz-Signature")
    ) return true;
  }

  const publicBase = exactOrigin(configuration.r2PublicBaseUrl);
  if (publicBase && url.origin === publicBase.origin && !url.search) {
    const prefix = publicBase.pathname.replace(/\/$/, "");
    if (new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${LOCAL_RENDER_OBJECT}$`).test(url.pathname)) {
      return true;
    }
  }

  return false;
}

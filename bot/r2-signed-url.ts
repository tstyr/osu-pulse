function normalizedHost(value: string) {
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

export function isSignedR2AudioUrl(
  value: string,
  configuration: { endpoint?: string; bucket?: string } = {
    endpoint: process.env.R2_ENDPOINT,
    bucket: process.env.R2_BUCKET,
  },
) {
  try {
    const url = new URL(value);
    const endpoint = new URL(configuration.endpoint ?? "");
    const bucket = normalizedHost(configuration.bucket ?? "");
    const endpointHost = normalizedHost(endpoint.hostname);
    const expectedHosts = new Set([endpointHost]);
    if (bucket) expectedHosts.add(`${bucket}.${endpointHost}`);
    const path = decodeURIComponent(url.pathname);
    const isStagingObject = path.startsWith("/music-staging/")
      || Boolean(bucket && path.startsWith(`/${bucket}/music-staging/`));
    const expires = Number.parseInt(url.searchParams.get("X-Amz-Expires") ?? "", 10);
    return url.protocol === "https:"
      && expectedHosts.has(normalizedHost(url.hostname))
      && isStagingObject
      && url.searchParams.get("X-Amz-Algorithm") === "AWS4-HMAC-SHA256"
      && /^[a-f0-9]{32,128}$/i.test(url.searchParams.get("X-Amz-Signature") ?? "")
      && Number.isSafeInteger(expires)
      && expires > 0
      && expires <= 7_200;
  } catch {
    return false;
  }
}

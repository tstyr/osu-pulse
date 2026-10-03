/** Permit only explicitly configured public hosts when actions pass through a proxy. */
export function serverActionAllowedOrigins(environment: {
  WEB_APP_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
}) {
  const candidates = [
    environment.WEB_APP_URL,
    environment.NEXT_PUBLIC_APP_URL,
    environment.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${environment.VERCEL_PROJECT_PRODUCTION_URL}` : undefined,
  ];
  const origins = new Set<string>();
  for (const value of candidates) {
    if (!value?.trim()) continue;
    try {
      const url = new URL(value.trim());
      if (!['https:', 'http:'].includes(url.protocol) || url.host.includes('*') || url.username || url.password) continue;
      origins.add(url.host);
    } catch {
      // An unset/malformed URL must not broaden the accepted origins.
    }
  }
  return [...origins];
}

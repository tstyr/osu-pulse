type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function knownBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.slice(0, 500) : null;
}

/** Normalize optional diagnostics without treating absent/old data as healthy. */
export function rendererDiagnostics(dependencies: unknown) {
  const dependency = object(dependencies);
  const stats = object(dependency.render_stats);
  const storage = object(stats.storage);
  const youtube = object(stats.youtube);
  const policy = object(stats.start_policy);
  const configured = knownBoolean(youtube.configured) ?? dependency.youtube_upload === true;
  const authStatus = youtube.auth_status === "reauthorization_required"
    ? "reauthorization_required" as const
    : youtube.auth_status === "not_configured" || !configured
      ? "not_configured" as const : "unchecked" as const;
  return {
    storage: {
      available: knownBoolean(storage.available),
      songsAvailable: knownBoolean(storage.songs_available),
      outputAvailable: knownBoolean(storage.output_available),
    },
    youtube: {
      enabled: knownBoolean(youtube.enabled) ?? dependency.youtube_upload === true,
      configured,
      authStatus,
      pendingCount: count(youtube.pending_count),
      lastError: text(youtube.last_error),
      nextRetryAt: text(youtube.next_retry_at),
    },
    startPolicy: {
      allowed: knownBoolean(policy.allowed),
      reason: text(policy.reason),
    },
  };
}

export function rendererStorageAvailable(dependencies: unknown) {
  const storage = rendererDiagnostics(dependencies).storage;
  // Preserve compatibility with old renderers, but explicit failures must not
  // consume queued requests (or their automatic retry budgets).
  return storage.available !== false && storage.songsAvailable !== false && storage.outputAvailable !== false;
}

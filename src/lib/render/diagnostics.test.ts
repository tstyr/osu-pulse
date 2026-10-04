import { describe, expect, it } from "vitest";
import { rendererDiagnostics, rendererStorageAvailable } from "./diagnostics";

describe("renderer live diagnostics", () => {
  it("does not claim credentials are authenticated or absent storage is healthy", () => {
    const diagnostics = rendererDiagnostics({ youtube_upload: true });
    expect(diagnostics.youtube.authStatus).toBe("unchecked");
    expect(diagnostics.storage.available).toBeNull();
    expect(rendererStorageAvailable({})).toBe(true);
  });

  it("retains actionable authentication and disconnected storage information", () => {
    const dependencies = { render_stats: {
      storage: { available: false, songs_available: false, output_available: false },
      youtube: { enabled: true, configured: true, auth_status: "reauthorization_required", pending_count: 3, last_error: "invalid_grant", next_retry_at: "2026-10-05T03:00:00Z" },
      start_policy: { allowed: false, reason: "waiting for PC idle" },
    } };
    const diagnostics = rendererDiagnostics(dependencies);
    expect(diagnostics.storage).toEqual({ available: false, songsAvailable: false, outputAvailable: false });
    expect(diagnostics.youtube).toMatchObject({ authStatus: "reauthorization_required", pendingCount: 3, lastError: "invalid_grant" });
    expect(diagnostics.startPolicy.allowed).toBe(false);
    expect(rendererStorageAvailable(dependencies)).toBe(false);
  });

  it("does not coerce false strings or malformed counts into healthy diagnostics", () => {
    const diagnostics = rendererDiagnostics({ render_stats: { storage: { available: "false" }, youtube: { configured: "true", pending_count: Infinity } } });
    expect(diagnostics.storage.available).toBeNull();
    expect(diagnostics.youtube.authStatus).toBe("not_configured");
    expect(diagnostics.youtube.pendingCount).toBe(0);
    expect(rendererStorageAvailable({ render_stats: { storage: { output_available: false } } })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { isSignedR2AudioUrl } from "./r2-signed-url";

const signature = "a".repeat(64);
const query = `X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=7200&X-Amz-Signature=${signature}`;
const configuration = {
  endpoint: "https://account.r2.cloudflarestorage.com",
  bucket: "osu-video-disk",
};

describe("isSignedR2AudioUrl", () => {
  it("accepts R2 virtual-hosted bucket URLs", () => {
    expect(isSignedR2AudioUrl(`https://osu-video-disk.account.r2.cloudflarestorage.com/music-staging/2026/09/audio.wav?${query}`, configuration)).toBe(true);
  });

  it("accepts R2 path-style bucket URLs", () => {
    expect(isSignedR2AudioUrl(`https://account.r2.cloudflarestorage.com/osu-video-disk/music-staging/2026/09/audio.wav?${query}`, configuration)).toBe(true);
  });

  it("rejects a different bucket or non-staging object", () => {
    expect(isSignedR2AudioUrl(`https://other.account.r2.cloudflarestorage.com/music-staging/audio.wav?${query}`, configuration)).toBe(false);
    expect(isSignedR2AudioUrl(`https://osu-video-disk.account.r2.cloudflarestorage.com/videos/audio.wav?${query}`, configuration)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { isAllowedCompletedVideoUrl } from "./video-url";

const configuration = {
  r2Endpoint: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
  r2Bucket: "osu-video-disk",
};

describe("completed render video URLs", () => {
  it("allows supported YouTube and Vercel Blob URLs", () => {
    expect(isAllowedCompletedVideoUrl("https://youtu.be/abc123XYZ")).toBe(true);
    expect(isAllowedCompletedVideoUrl(
      "https://example.public.blob.vercel-storage.com/discord-renders/0123456789abcdef0123456789abcdef.mp4",
    )).toBe(true);
  });

  it("allows a signed URL from the configured R2 bucket", () => {
    const url = `${configuration.r2Endpoint}/osu-video-disk/discord-renders/0123456789abcdef0123456789abcdef.mp4?X-Amz-Credential=test&X-Amz-Signature=signed`;
    expect(isAllowedCompletedVideoUrl(url, configuration)).toBe(true);
  });

  it("rejects unsigned, wrong-bucket, and unrelated URLs", () => {
    const object = "discord-renders/0123456789abcdef0123456789abcdef.mp4";
    expect(isAllowedCompletedVideoUrl(`${configuration.r2Endpoint}/osu-video-disk/${object}`, configuration)).toBe(false);
    expect(isAllowedCompletedVideoUrl(`${configuration.r2Endpoint}/other/${object}?X-Amz-Credential=test&X-Amz-Signature=signed`, configuration)).toBe(false);
    expect(isAllowedCompletedVideoUrl(`https://example.com/${object}`, configuration)).toBe(false);
  });
});

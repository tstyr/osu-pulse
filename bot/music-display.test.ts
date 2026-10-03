import { describe, expect, it } from "vitest";
import { musicDisplayUrl } from "./music-display";

describe("music embed URLs", () => {
  it("links externally playable tracks", () => {
    expect(musicDisplayUrl("https://www.youtube.com/watch?v=abcdefghijk")).toBe("https://www.youtube.com/watch?v=abcdefghijk");
  });

  it.each(["local-audio:track-id", "search:my song", "", undefined, "https://user:secret@example.com/audio"])("keeps internal or invalid identifier %s out of the embed", (value) => {
    expect(musicDisplayUrl(value)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { parseScoreUrl, RenderApiError } from "./score-url";

describe("render score URLs", () => {
  it("keeps modern and supported ruleset-specific score URLs", () => {
    expect(parseScoreUrl("https://osu.ppy.sh/scores/7361453550")).toBe("https://osu.ppy.sh/scores/7361453550");
    expect(parseScoreUrl("https://osu.ppy.sh/scores/osu/123")).toBe("https://osu.ppy.sh/scores/osu/123");
    expect(parseScoreUrl("https://osu.ppy.sh/scores/mania/456")).toBe("https://osu.ppy.sh/scores/mania/456");
  });

  it("rejects unsupported rulesets", () => {
    expect(() => parseScoreUrl("https://osu.ppy.sh/scores/taiko/123")).toThrow(RenderApiError);
  });
});

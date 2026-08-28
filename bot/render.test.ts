import { describe, expect, it } from "vitest";

import { renderAccountChoiceName } from "./render-choice";

describe("render account choices", () => {
  it("puts pp and rank before the song title", () => {
    expect(renderAccountChoiceName({
      pp: 321.456,
      rank: "X",
      artist: "Artist",
      title: "Song",
      difficulty: "Insane",
    })).toBe("321.5pp ・ SS ・ Artist - Song [Insane]");
  });

  it("fits Discord's autocomplete choice-name limit", () => {
    const name = renderAccountChoiceName({
      pp: null,
      rank: "A",
      artist: "a".repeat(80),
      title: "b".repeat(80),
      difficulty: "Expert",
    });
    expect(name.length).toBeLessThanOrEqual(100);
  });
});

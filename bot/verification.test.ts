import { describe, expect, it } from "vitest";

import {
  parseLanguageStepCustomId,
  VERIFICATION_LANGUAGE_ROLES,
  VERIFICATION_MODE_ROLES,
} from "./verification-config";

describe("Discord verification flow", () => {
  it("keeps the configured existing mode and language role names", () => {
    expect(VERIFICATION_MODE_ROLES.map((role) => role.roleName)).toEqual([
      "std",
      "mania",
      "taiko",
      "catch",
    ]);
    expect(VERIFICATION_LANGUAGE_ROLES.map((role) => role.roleName)).toEqual([
      "Japan",
      "America",
      "Russia",
      "Korea",
      "Brazil",
    ]);
  });

  it("restores the linked account state and multiple selected modes", () => {
    expect(parseLanguageStepCustomId("osu-verify:language:linked:std,mania,taiko")).toEqual({
      accountState: "linked",
      modes: ["std", "mania", "taiko"],
    });
  });

  it("rejects malformed or empty role selection state", () => {
    expect(parseLanguageStepCustomId("osu-verify:language:none:")).toBeNull();
    expect(parseLanguageStepCustomId("other:language:linked:std")).toBeNull();
  });
});

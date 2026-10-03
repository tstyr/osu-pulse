export const VERIFICATION_MODE_ROLES = [
  { key: "std", roleName: "std", label: "std", mode: "osu" },
  { key: "mania", roleName: "mania", label: "mania", mode: "mania" },
  { key: "taiko", roleName: "taiko", label: "taiko", mode: "taiko" },
  { key: "catch", roleName: "catch", label: "catch", mode: "fruits" },
] as const;

export const VERIFICATION_LANGUAGE_ROLES = [
  { key: "Japan", roleName: "Japan", label: "Japan" },
  { key: "America", roleName: "America", label: "America" },
  { key: "Russia", roleName: "Russia", label: "Russia" },
  { key: "Korea", roleName: "Korea", label: "Korea" },
  { key: "Brazil", roleName: "Brazil", label: "Brazil" },
] as const;

export type VerificationAccountState = "linked" | "none";
export type VerificationModeKey = (typeof VERIFICATION_MODE_ROLES)[number]["key"];
export type VerificationLanguageKey = (typeof VERIFICATION_LANGUAGE_ROLES)[number]["key"];

export function parseLanguageStepCustomId(customId: string) {
  const [prefix, step, accountState, rawModes] = customId.split(":");
  if (prefix !== "osu-verify" || step !== "language" || (accountState !== "linked" && accountState !== "none")) return null;
  const allowed = new Set(VERIFICATION_MODE_ROLES.map((definition) => definition.key));
  const modes = (rawModes ?? "").split(",").filter((value): value is VerificationModeKey => allowed.has(value as VerificationModeKey));
  if (modes.length === 0) return null;
  return { accountState, modes } as const;
}

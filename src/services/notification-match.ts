import type { NotificationRuleConditions, ScoreEvent } from "../db/schema";

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function nonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function scoreMatchesRule(score: ScoreEvent, conditions: NotificationRuleConditions) {
  // JSONB imports bypass TypeScript. A damaged rule must not throw in .filter()
  // and prevent healthy rules/accounts from reaching the notification outbox.
  if (!conditions || typeof conditions !== "object"
    || !stringArray(conditions.modes) || !stringArray(conditions.ranks) || !stringArray(conditions.requiredMods)
    || !nonnegativeNumber(conditions.minimumPp)
    || !nonnegativeNumber(conditions.minimumAccuracy) || conditions.minimumAccuracy > 100
    || (conditions.maximumPp !== null && conditions.maximumPp !== undefined && !nonnegativeNumber(conditions.maximumPp))) return false;
  if (!conditions.modes.includes(score.mode)) return false;
  if (conditions.ranks.length && !conditions.ranks.includes(score.rank)) return false;
  if ((score.pp ?? 0) < conditions.minimumPp) return false;
  if (conditions.maximumPp !== null && (score.pp ?? 0) > conditions.maximumPp) return false;
  if (!Number.isFinite(score.accuracy) || score.accuracy < 0 || score.accuracy > 1 || score.accuracy * 100 < conditions.minimumAccuracy) return false;
  if (conditions.personalBestOnly && !score.isPersonalBest) return false;
  if (conditions.anomalyOnly && (!Number.isFinite(score.anomalyScore) || Math.abs(score.anomalyScore ?? 0) < 2)) return false;
  if (conditions.requiredMods.length && (!stringArray(score.mods) || !conditions.requiredMods.every((mod) => score.mods.includes(mod)))) return false;
  return true;
}

import type { NotificationRuleConditions, ScoreEvent } from "../db/schema";

export function scoreMatchesRule(score: ScoreEvent, conditions: NotificationRuleConditions) {
  if (!conditions.modes.includes(score.mode)) return false;
  if (conditions.ranks.length && !conditions.ranks.includes(score.rank)) return false;
  if ((score.pp ?? 0) < conditions.minimumPp) return false;
  if (conditions.maximumPp !== null && (score.pp ?? 0) > conditions.maximumPp) return false;
  if (score.accuracy * 100 < conditions.minimumAccuracy) return false;
  if (conditions.personalBestOnly && !score.isPersonalBest) return false;
  if (conditions.anomalyOnly && Math.abs(score.anomalyScore ?? 0) < 2) return false;
  if (conditions.requiredMods.length && !conditions.requiredMods.every((mod) => score.mods.includes(mod))) return false;
  return true;
}

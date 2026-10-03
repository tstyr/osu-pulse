import { listMatchingNotificationRules, markNotificationRuleMatched } from "@/db/feature-repository";
import { getSnapshotDelta } from "@/db/repository";
import type { Account, ScoreEvent } from "@/db/schema";
import { notificationRuleScoreEmbed } from "@/lib/discord/embeds";
import { sendDiscordChannelMessage } from "@/lib/discord/rest";
import { scoreMatchesRule } from "./notification-match";

export { scoreMatchesRule } from "./notification-match";

export async function dispatchNotificationRules(account: Account, score: ScoreEvent) {
  const rules = await listMatchingNotificationRules(account.id);
  const matched = rules.filter((rule) => scoreMatchesRule(score, rule.conditions));
  if (!matched.length) return 0;
  const { latest, previous } = await getSnapshotDelta(account.id, score.mode);
  await Promise.allSettled(matched.map(async (rule) => {
    await sendDiscordChannelMessage(rule.channelId, {
      embeds: [notificationRuleScoreEmbed(account, score, latest, previous)],
      allowed_mentions: { parse: [] },
    });
    await markNotificationRuleMatched(rule.id);
  }));
  return matched.length;
}

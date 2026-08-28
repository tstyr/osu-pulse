import { getRecentPlays, getSnapshotDelta, listDailyDigestTargets } from "@/db/repository";
import { formatAccuracy, formatNumber, formatRank, formatScoreAccuracy } from "@/lib/format";
import { MODE_ACCENTS, MODE_LABELS } from "@/lib/osu/modes";
import { sendDiscordDm } from "@/lib/discord/rest";

function colorToInt(hex: string) {
  return Number.parseInt(hex.replace("#", ""), 16);
}

export async function sendDailyDigests() {
  const targets = await listDailyDigestTargets();
  const appUrl = process.env.WEB_APP_URL ?? "http://localhost:3000";
  const results: Array<{ accountId: string; status: "sent" | "skipped" | "failed"; error?: string }> = [];

  for (const target of targets) {
    const account = target.account;
    if (!target.dailyDmEnabled) {
      results.push({ accountId: account.id, status: "skipped" });
      continue;
    }

    try {
      const mode = target.primaryMode;
      const [{ latest, previous }, recent] = await Promise.all([
        getSnapshotDelta(account.id, mode),
        getRecentPlays(account.id, mode, 5),
      ]);
      if (!latest) {
        results.push({ accountId: account.id, status: "skipped" });
        continue;
      }

      const ppGain = latest.pp - (previous?.pp ?? latest.pp);
      const rankGain = (previous?.globalRank ?? latest.globalRank ?? 0) - (latest.globalRank ?? 0);
      const playGain = latest.playCount - (previous?.playCount ?? latest.playCount);
      const topPlay = recent.filter((play) => play.pp !== null).sort((a, b) => (b.pp ?? 0) - (a.pp ?? 0))[0];

      await sendDiscordDm(target.discordUserId, {
        content: `おつかれさま、**${account.username}**。今日の成長レポートです。`,
        embeds: [{
          title: `Daily growth · ${MODE_LABELS[mode]}`,
          description: ppGain || rankGain ? "今日も前進しています。小さな積み重ねを記録しました。" : "今日は基準値を保存しました。次のセッションで伸ばしていきましょう。",
          url: `${appUrl}/u/${account.osuUserId}?mode=${mode}`,
          color: colorToInt(MODE_ACCENTS[mode]),
          thumbnail: account.avatarUrl ? { url: account.avatarUrl } : undefined,
          image: { url: `${appUrl}/api/charts/growth/${account.osuUserId}?mode=${mode}` },
          fields: [
            { name: "Performance", value: `${ppGain >= 0 ? "+" : ""}${ppGain.toFixed(0)} pp\n${formatNumber(latest.pp)} pp`, inline: true },
            { name: "Rank", value: `${rankGain >= 0 ? "+" : ""}${formatNumber(rankGain)}\n${formatRank(latest.globalRank)}`, inline: true },
            { name: "Plays", value: `+${formatNumber(playGain)}\n${formatAccuracy(latest.accuracy)}`, inline: true },
            ...(topPlay ? [{ name: "Best recent", value: `**${topPlay.artist} — ${topPlay.title}**\n${topPlay.pp?.toFixed(1)}pp · ${formatScoreAccuracy(topPlay.accuracy)}`, inline: false }] : []),
          ],
          timestamp: new Date().toISOString(),
          footer: { text: "osu pulse · daily digest" },
        }],
        allowed_mentions: { parse: [] },
      });
      results.push({ accountId: account.id, status: "sent" });
    } catch (error) {
      results.push({ accountId: account.id, status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }

  return results;
}

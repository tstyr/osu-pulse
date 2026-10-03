import type { DailySnapshot } from "@/db/schema";

type GrowthSnapshot = DailySnapshot;

function dateTime(value: string) {
  return Date.parse(`${value}T00:00:00Z`);
}

function signed(value: number, digits = 0, suffix = "") {
  const formatted = new Intl.NumberFormat("ja-JP", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value));
  return `${value > 0 ? "+" : value < 0 ? "-" : "±"}${formatted}${suffix}`;
}

function percent(delta: number, baseline: number) {
  if (!baseline) return "—";
  return signed(delta / Math.abs(baseline) * 100, 2, "%");
}

function duration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || seconds < 0) return "—";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return [days ? `${days}日` : null, hours ? `${hours}時間` : null, `${minutes}分`].filter(Boolean).join(" ");
}

function baseline(history: GrowthSnapshot[], days: number) {
  const latest = history.at(-1);
  if (!latest) return null;
  const target = dateTime(latest.snapshotDate) - days * 86_400_000;
  const before = history.filter((row) => dateTime(row.snapshotDate) <= target).at(-1);
  return before ?? history.find((row) => row.id !== latest.id) ?? null;
}

function rankGain(latest: GrowthSnapshot, previous: GrowthSnapshot) {
  return latest.globalRank !== null && previous.globalRank !== null ? previous.globalRank - latest.globalRank : null;
}

function scoreDelta(latest: GrowthSnapshot, previous: GrowthSnapshot) {
  try {
    return BigInt(latest.totalScore) - BigInt(previous.totalScore);
  } catch {
    return BigInt(0);
  }
}

function periodBlock(history: GrowthSnapshot[], days: number, label: string) {
  const latest = history.at(-1);
  const previous = baseline(history, days);
  if (!latest || !previous) return { name: label, value: "比較できる履歴がまだありません。", baseline: null };
  const pp = latest.pp - previous.pp;
  const plays = latest.playCount - previous.playCount;
  const playTime = latest.playTimeSeconds !== null && previous.playTimeSeconds !== null
    ? latest.playTimeSeconds - previous.playTimeSeconds
    : null;
  const rank = rankGain(latest, previous);
  const accuracy = latest.accuracy - previous.accuracy;
  const score = scoreDelta(latest, previous);
  const playTimeText = playTime === null
    ? "—"
    : `${playTime > 0 ? "+" : playTime < 0 ? "-" : "±"}${duration(Math.abs(playTime))}（${previous.playTimeSeconds === null ? "—" : percent(playTime, previous.playTimeSeconds)}）`;
  const actualDays = Math.max(1, Math.round((dateTime(latest.snapshotDate) - dateTime(previous.snapshotDate)) / 86_400_000));
  return {
    name: label,
    baseline: previous,
    value: [
      `**PP** ${signed(pp, 2, "pp")}（${percent(pp, previous.pp)}） · **精度** ${signed(accuracy, 2, "pt")}`,
      `**プレイ時間** ${playTimeText}`,
      `**プレイ回数** ${signed(plays, 0, "回")}（${percent(plays, previous.playCount)}）`,
      `**順位** ${previous.globalRank ? `#${previous.globalRank.toLocaleString()}` : "—"} → ${latest.globalRank ? `#${latest.globalRank.toLocaleString()}` : "—"}${rank === null ? "" : `（${rank >= 0 ? "↑" : "↓"}${Math.abs(rank).toLocaleString()}）`}`,
      `**総スコア** ${score >= BigInt(0) ? "+" : ""}${score.toLocaleString()}`,
      `基準 ${previous.snapshotDate}（${actualDays}日前）`,
    ].join("\n"),
  };
}

export function buildGrowthReport(history: GrowthSnapshot[]) {
  const ordered = [...history].sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate));
  const latest = ordered.at(-1) ?? null;
  if (!latest) return null;
  const lastRows = ordered.slice(-11);
  const daily = lastRows.slice(1).map((row, index) => {
    const previous = lastRows[index];
    const pp = row.pp - previous.pp;
    const rank = rankGain(row, previous);
    const plays = row.playCount - previous.playCount;
    return `${row.snapshotDate.slice(5).replace("-", "/")}  ${row.pp.toFixed(1).padStart(8)}  ${signed(pp, 1).padStart(8)}  ${(rank === null ? "—" : `${rank >= 0 ? "↑" : "↓"}${Math.abs(rank).toLocaleString()}`).padStart(7)}  ${signed(plays).padStart(6)}`;
  });
  const dayGains = ordered.slice(1).map((row, index) => ({
    pp: row.pp - ordered[index].pp,
    plays: row.playCount - ordered[index].playCount,
    rank: rankGain(row, ordered[index]),
  }));
  const recent30 = ordered.filter((row) => dateTime(row.snapshotDate) >= dateTime(latest.snapshotDate) - 30 * 86_400_000);
  const recentGains = recent30.slice(1).map((row, index) => row.pp - recent30[index].pp);
  const activeDays = recent30.slice(1).filter((row, index) => row.playCount > recent30[index].playCount).length;
  let streak = 0;
  for (let index = ordered.length - 1; index > 0; index -= 1) {
    if (ordered[index].playCount <= ordered[index - 1].playCount) break;
    streak += 1;
  }
  const bestPp = recentGains.length ? Math.max(...recentGains) : 0;
  const bestRank = dayGains.reduce<number | null>((best, row) => row.rank === null ? best : Math.max(best ?? row.rank, row.rank), null);
  const thirty = periodBlock(ordered, 30, "30日");
  const previous30 = thirty.baseline ? baseline(ordered.filter((row) => row.snapshotDate <= thirty.baseline!.snapshotDate), 30) : null;
  const current30Pp = thirty.baseline ? latest.pp - thirty.baseline.pp : 0;
  const previous30Pp = thirty.baseline && previous30 ? thirty.baseline.pp - previous30.pp : null;
  return {
    latest,
    current: [
      `**PP** ${latest.pp.toLocaleString("ja-JP", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}pp · **精度** ${latest.accuracy.toFixed(2)}%`,
      `**世界順位** ${latest.globalRank ? `#${latest.globalRank.toLocaleString()}` : "Unranked"} · **国内順位** ${latest.countryRank ? `#${latest.countryRank.toLocaleString()}` : "—"}`,
      `**プレイ時間** ${duration(latest.playTimeSeconds)} · **プレイ回数** ${latest.playCount.toLocaleString()}`,
      `**総スコア** ${BigInt(latest.totalScore).toLocaleString()} · **レベル** ${latest.level.toFixed(2)}`,
    ].join("\n"),
    periods: [periodBlock(ordered, 1, "24時間"), periodBlock(ordered, 7, "1週間"), thirty],
    daily: daily.length ? `\`\`\`text\nDate       PP       ΔPP    RankΔ   Plays\n${daily.join("\n")}\n\`\`\`` : "日次比較に必要な履歴がまだありません。",
    comparison: [
      `PP 月次: 今月 ${signed(current30Pp, 2, "pp")} / 前期間 ${previous30Pp === null ? "—" : signed(previous30Pp, 2, "pp")}${previous30Pp === null ? "" : ` / 差 ${signed(current30Pp - previous30Pp, 2, "pp")}`}`,
      `総スコア 30日: ${thirty.baseline ? scoreDelta(latest, thirty.baseline).toLocaleString() : "—"}`,
    ].join("\n"),
    insights: [
      `🔥 直近30日の活動日 **${activeDays}日** · 現在の連続活動 **${streak}日**`,
      `📈 最大日次PP増加 **${signed(bestPp, 2, "pp")}**${bestRank === null ? "" : ` · 最大順位上昇 **${signed(bestRank, 0, "位")}**`}`,
      recentGains.length ? `📊 活動日平均PP増加 **${signed(recentGains.reduce((sum, value) => sum + value, 0) / Math.max(activeDays, 1), 2, "pp")}**` : "📊 日次傾向は履歴蓄積後に表示します。",
    ].join("\n"),
  };
}

import type { Account, DailySnapshot, ScoreEvent } from "@/db/schema";
import { formatNumber, formatScoreAccuracy } from "@/lib/format";
import { MODE_ACCENTS, MODE_LABELS } from "@/lib/osu/modes";
import { calculatePulseIndex } from "@/lib/osu/pulse-index";
import { calculateSkillProfile, skillLabels } from "@/lib/osu/skill-profile";
import { publicAppOrigin } from "@/lib/public-app-url";

import type { DiscordEmbed } from "./rest";

function colorToInt(hex: string) {
  return Number.parseInt(hex.replace("#", ""), 16);
}

export function scoreEmbed(account: Account, score: ScoreEvent): DiscordEmbed {
  const appUrl = publicAppOrigin();
  const mods = score.mods.length ? ` +${score.mods.join("")}` : "";
  const pulse = calculatePulseIndex(score, score.mode);
  const skills = calculateSkillProfile([score], score.mode);
  const labels = skillLabels(score.mode);
  const description = [
    score.isPersonalBest ? "🏆 **新しい自己ベスト**" : null,
    score.anomalyScore !== null && Math.abs(score.anomalyScore) >= 2.5
      ? score.anomalyScore > 0 ? "🔥 **普段より大幅に高いパフォーマンス**" : "📉 **普段より低いパフォーマンス**"
      : null,
    `**${score.artist} — ${score.title}**`,
    `${score.difficulty}${mods}`,
  ].filter(Boolean).join("\n");

  return {
    title: `${score.rank} · ${score.pp ? `${score.pp.toFixed(1)}pp` : "unranked"}`,
    description,
    url: `https://osu.ppy.sh/scores/${score.mode}/${score.osuScoreId}`,
    color: colorToInt(MODE_ACCENTS[score.mode]),
    timestamp: score.endedAt.toISOString(),
    thumbnail: account.avatarUrl ? { url: account.avatarUrl } : undefined,
    image: {
      url: `${appUrl}/api/charts/growth/${account.osuUserId}?mode=${score.mode}`,
    },
    fields: [
      { name: "Accuracy", value: formatScoreAccuracy(score.accuracy), inline: true },
      { name: "Combo", value: score.maxCombo ? `${formatNumber(score.maxCombo)}x` : "—", inline: true },
      { name: "Mode", value: MODE_LABELS[score.mode], inline: true },
      { name: "Pulse Index", value: pulse.total.toFixed(2), inline: true },
      { name: labels.aim, value: skills ? skills.aim.toFixed(2) : "—", inline: true },
    ],
    footer: { text: `${account.username} · osu pulse live result` },
  };
}

function formatOptionalNumber(value: number | null, suffix = "") {
  return value === null ? "—" : `${formatNumber(value, 2)}${suffix}`;
}

function formatRankChange(latest: DailySnapshot | null, previous: DailySnapshot | null) {
  if (latest?.globalRank === null || latest?.globalRank === undefined) return "—";
  if (previous?.globalRank === null || previous?.globalRank === undefined) {
    return `#${formatNumber(latest.globalRank)}`;
  }
  const gain = previous.globalRank - latest.globalRank;
  const comparison = gain === 0 ? "前回比 ±0" : gain > 0 ? `前回比 ↑${formatNumber(gain)}` : `前回比 ↓${formatNumber(Math.abs(gain))}`;
  return `#${formatNumber(latest.globalRank)}（${comparison}）`;
}

export function notificationRuleScoreEmbed(
  account: Account,
  score: ScoreEvent,
  latest: DailySnapshot | null,
  previous: DailySnapshot | null,
): DiscordEmbed {
  const mods = score.mods.length ? `+${score.mods.join("")}` : "NM";
  const pulse = calculatePulseIndex(score, score.mode);
  const skills = calculateSkillProfile([score], score.mode);
  const labels = skillLabels(score.mode);
  const comboDetail = [
    score.maxCombo ? `${formatNumber(score.maxCombo)}x` : "—",
    ["X", "XH"].includes(score.rank) ? "FC" : score.passed ? "Clear" : "Failed",
  ].join(" · ");

  return {
    title: `${score.artist} — ${score.title}`,
    description: `**[${score.difficulty}]**${score.mapper ? ` · mapped by ${score.mapper}` : ""}`,
    url: `https://osu.ppy.sh/scores/${score.mode}/${score.osuScoreId}`,
    color: colorToInt(MODE_ACCENTS[score.mode]),
    timestamp: score.endedAt.toISOString(),
    thumbnail: account.avatarUrl ? { url: account.avatarUrl } : undefined,
    image: score.coverUrl ? { url: score.coverUrl } : undefined,
    fields: [
      { name: "星数", value: formatOptionalNumber(score.starRating, "★"), inline: true },
      { name: "コンボ", value: comboDetail, inline: true },
      { name: "判定", value: score.rank, inline: true },
      { name: "精度", value: formatScoreAccuracy(score.accuracy), inline: true },
      { name: "使用MOD", value: mods, inline: true },
      { name: "獲得PP", value: score.pp === null ? "—" : `${formatNumber(score.pp, 2)}pp`, inline: true },
      { name: "獲得順位", value: formatRankChange(latest, previous), inline: true },
      { name: "現在PP", value: latest ? `${formatNumber(latest.pp, 2)}pp` : "—", inline: true },
      { name: "スコア", value: score.score ? formatNumber(Number(score.score)) : "—", inline: true },
      { name: "Pulse / スキル", value: `${pulse.total.toFixed(2)} · ${labels.aim} ${skills?.aim.toFixed(2) ?? "—"}${score.mode === "osu" ? ` · Aim難度 ${formatOptionalNumber(score.aimDifficulty)}` : ""}`, inline: false },
      {
        name: "譜面情報",
        value: `AR ${formatOptionalNumber(score.ar)} · CS ${formatOptionalNumber(score.cs)} · OD ${formatOptionalNumber(score.od)} · BPM ${formatOptionalNumber(score.bpm)}`,
        inline: false,
      },
    ],
    footer: { text: `${account.username} · ${MODE_LABELS[score.mode]}` },
  };
}

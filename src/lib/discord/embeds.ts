import type { Account, ScoreEvent } from "@/db/schema";
import { formatNumber, formatScoreAccuracy } from "@/lib/format";
import { MODE_ACCENTS, MODE_LABELS } from "@/lib/osu/modes";

import type { DiscordEmbed } from "./rest";

function colorToInt(hex: string) {
  return Number.parseInt(hex.replace("#", ""), 16);
}

export function scoreEmbed(account: Account, score: ScoreEvent): DiscordEmbed {
  const appUrl = process.env.WEB_APP_URL ?? "http://localhost:3000";
  const mods = score.mods.length ? ` +${score.mods.join("")}` : "";
  const description = [
    `**${score.artist} — ${score.title}**`,
    `${score.difficulty}${mods}`,
  ].join("\n");

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
    ],
    footer: { text: `${account.username} · osu pulse live result` },
  };
}

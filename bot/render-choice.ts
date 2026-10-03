const RANK_LABELS: Record<string, string> = {
  XH: "SSH",
  X: "SS",
  SH: "SH",
};

function recentPlayTime(endedAt?: number) {
  if (!endedAt || !Number.isFinite(endedAt)) return "";
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(endedAt));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return value.month && value.day && value.hour && value.minute
    ? ` ・ ${value.month}/${value.day} ${value.hour}:${value.minute}`
    : "";
}

export function renderAccountChoiceName(play: {
  pp: number | null;
  rank: string;
  ruleset?: "osu" | "mania";
  username?: string;
  artist: string;
  title: string;
  difficulty: string;
  endedAt?: number;
}) {
  const pp = play.pp == null ? "—pp" : `${play.pp.toFixed(1)}pp`;
  const rank = RANK_LABELS[play.rank] ?? play.rank;
  const ruleset = play.ruleset ? ` ・ ${play.ruleset === "mania" ? "MANIA" : "STD"}` : "";
  const account = play.username ? ` ・ ${play.username}` : "";
  const playedAt = recentPlayTime(play.endedAt);
  return `${pp} ・ ${rank}${ruleset}${account}${playedAt} ・ ${play.artist} - ${play.title} [${play.difficulty}]`.slice(0, 100);
}

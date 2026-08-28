const RANK_LABELS: Record<string, string> = {
  XH: "SSH",
  X: "SS",
  SH: "SH",
};

export function renderAccountChoiceName(play: {
  pp: number | null;
  rank: string;
  ruleset?: "osu" | "mania";
  username?: string;
  artist: string;
  title: string;
  difficulty: string;
}) {
  const pp = play.pp == null ? "—pp" : `${play.pp.toFixed(1)}pp`;
  const rank = RANK_LABELS[play.rank] ?? play.rank;
  const ruleset = play.ruleset ? ` ・ ${play.ruleset === "mania" ? "MANIA" : "STD"}` : "";
  const account = play.username ? ` ・ ${play.username}` : "";
  return `${pp} ・ ${rank}${ruleset}${account} ・ ${play.artist} - ${play.title} [${play.difficulty}]`.slice(0, 100);
}

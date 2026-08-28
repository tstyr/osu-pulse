const RANK_LABELS: Record<string, string> = {
  XH: "SSH",
  X: "SS",
  SH: "SH",
};

export function renderAccountChoiceName(play: {
  pp: number | null;
  rank: string;
  artist: string;
  title: string;
  difficulty: string;
}) {
  const pp = `${(play.pp ?? 0).toFixed(1)}pp`;
  const rank = RANK_LABELS[play.rank] ?? play.rank;
  return `${pp} ・ ${rank} ・ ${play.artist} - ${play.title} [${play.difficulty}]`.slice(0, 100);
}

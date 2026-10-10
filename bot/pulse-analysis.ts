export type AnalysisPlay = {
  osuScoreId: string; beatmapId: number; title: string; difficulty: string;
  pp: number | null; accuracy: number; rank: string; starRating: number | null;
  mods: string[]; passed: boolean; isPersonalBest: boolean; endedAt: Date;
};
export function mean(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
export function deviation(values: number[]) {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}
export function validPlays(plays: AnalysisPlay[]) {
  return plays.filter((play) => Number.isFinite(play.endedAt.getTime()) && Number.isFinite(play.accuracy) && play.accuracy >= 0 && play.accuracy <= 1)
    .sort((left, right) => left.endedAt.getTime() - right.endedAt.getTime());
}
export function playSessions(plays: AnalysisPlay[]) {
  const sessions: AnalysisPlay[][] = [];
  for (const play of validPlays(plays)) {
    const last = sessions.at(-1);
    if (!last || play.endedAt.getTime() - last.at(-1)!.endedAt.getTime() > 45 * 60_000) sessions.push([play]);
    else last.push(play);
  }
  return sessions;
}
export function dailyPlays(plays: AnalysisPlay[]) {
  const days = new Map<string, { count: number; pp: number[]; accuracy: number[] }>();
  for (const play of validPlays(plays)) {
    const day = new Date(play.endedAt.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
    const value = days.get(day) ?? { count: 0, pp: [], accuracy: [] };
    value.count++; value.accuracy.push(play.accuracy);
    if (play.pp !== null && Number.isFinite(play.pp)) value.pp.push(play.pp);
    days.set(day, value);
  }
  return days;
}
export function improvementCandidates(plays: AnalysisPlay[]) {
  const groups = new Map<string, AnalysisPlay[]>();
  for (const play of validPlays(plays).filter((play) => play.passed && play.pp !== null && play.pp > 0)) {
    // Never compare different mod combinations as though they were repeat attempts.
    const key = `${play.beatmapId}:${[...play.mods].sort().join(",")}`;
    const group = groups.get(key) ?? []; group.push(play); groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length >= 2).map((group) => {
    const best = [...group].sort((a, b) => b.pp! - a.pp!)[0];
    const latest = group.at(-1)!;
    return { best, latest, tries: group.length, gap: best.pp! - latest.pp! };
  }).filter((item) => item.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 10);
}
export function firstMilestones(plays: AnalysisPlay[]) {
  const sorted = validPlays(plays).filter((play) => play.passed);
  const milestones = [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000].flatMap((pp) => {
    const play = sorted.find((item) => item.pp !== null && item.pp >= pp);
    return play ? [{ label: `初 ${pp}pp`, play }] : [];
  });
  for (const [label, ranks] of [["初 S以上", ["S", "SH", "X", "XH"]], ["初 SS", ["X", "XH"]]] as const) {
    const play = sorted.find((item) => (ranks as readonly string[]).includes(item.rank));
    if (play) milestones.push({ label, play });
  }
  return milestones.sort((a, b) => b.play.endedAt.getTime() - a.play.endedAt.getTime());
}

const DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
});

export function summarizeDailyScores(scores: ReadonlyArray<{
  endedAt: string; pp: number | null; accuracy: number; passed: boolean;
}>) {
  const groups = new Map<string, { plays: number; passed: number; ppCount: number; ppSum: number; accuracySum: number; bestPp: number | null }>();
  for (const score of scores) {
    const timestamp = new Date(score.endedAt);
    if (!Number.isFinite(timestamp.getTime())) continue;
    const date = DAY_FORMATTER.format(timestamp);
    const group = groups.get(date) ?? { plays: 0, passed: 0, ppCount: 0, ppSum: 0, accuracySum: 0, bestPp: null };
    group.plays += 1;
    if (score.passed) group.passed += 1;
    group.accuracySum += score.accuracy * 100;
    if (score.pp !== null && Number.isFinite(score.pp)) {
      group.ppCount += 1;
      group.ppSum += score.pp;
      group.bestPp = group.bestPp === null ? score.pp : Math.max(group.bestPp, score.pp);
    }
    groups.set(date, group);
  }
  const rows = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, group]) => ({
    date,
    averagePp: group.ppCount ? group.ppSum / group.ppCount : null,
    averageAccuracy: group.accuracySum / group.plays,
    bestPp: group.bestPp,
    plays: group.plays,
    passRate: group.passed / group.plays * 100,
  }));
  return rows.map((row, index) => {
    const window = rows.slice(Math.max(0, index - 6), index + 1);
    const pp = window.flatMap((item) => item.averagePp === null ? [] : [item.averagePp]);
    return {
      ...row,
      rollingPp: pp.length ? pp.reduce((sum, value) => sum + value, 0) / pp.length : null,
      rollingAccuracy: window.reduce((sum, item) => sum + item.averageAccuracy, 0) / window.length,
    };
  });
}

import { ProfileDashboard } from "@/components/profile-dashboard";
import { demoGrowth, demoModeStats, demoProfile, demoRecentPlays } from "@/lib/demo-data";
import { isOsuMode } from "@/lib/osu/modes";

export default async function Home({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const query = await searchParams;
  const mode = isOsuMode(query.mode) ? query.mode : "osu";
  const stats = demoModeStats(mode);

  return (
    <ProfileDashboard
      profile={demoProfile}
      mode={mode}
      stats={{ pp: stats.pp, globalRank: stats.rank, countryRank: stats.countryRank, accuracy: stats.accuracy, playCount: stats.plays, level: 108.42 }}
      previous={{ pp: stats.pp - 42, globalRank: stats.rank + 117, countryRank: stats.countryRank + 5, accuracy: stats.accuracy - 0.04, playCount: stats.plays - 36 }}
      growth={demoGrowth(mode)}
      recent={demoRecentPlays}
      modeScoreCounts={{ osu: 328, taiko: 104, fruits: 82, mania: 191 }}
      profileHref="/"
      demo
    />
  );
}

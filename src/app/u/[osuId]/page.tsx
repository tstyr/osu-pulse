import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProfileDashboard } from "@/components/profile-dashboard";
import { getAccountByOsuId, getGrowthHistory, getModeScoreCounts, getRecentPlays, getSnapshotDelta } from "@/db/repository";
import { isOsuMode } from "@/lib/osu/modes";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ osuId: string }> }): Promise<Metadata> {
  const { osuId } = await params;
  const numericId = Number(osuId);
  if (!Number.isSafeInteger(numericId)) return { title: "Player" };
  const account = await getAccountByOsuId(numericId).catch(() => undefined);
  return {
    title: account ? `${account.username} の成長` : "Player",
    description: account ? `${account.username} のosu!統計、成長曲線、最新リザルト。` : undefined,
  };
}

export default async function PlayerProfile({ params, searchParams }: { params: Promise<{ osuId: string }>; searchParams: Promise<{ mode?: string }> }) {
  const [{ osuId }, query] = await Promise.all([params, searchParams]);
  const numericId = Number(osuId);
  if (!Number.isSafeInteger(numericId)) notFound();

  const account = await getAccountByOsuId(numericId);
  if (!account) notFound();
  const mode = isOsuMode(query.mode) ? query.mode : account.primaryMode;

  const [delta, history, recent, scoreCounts] = await Promise.all([
    getSnapshotDelta(account.id, mode),
    getGrowthHistory(account.id, mode, 90),
    getRecentPlays(account.id, mode, 12),
    getModeScoreCounts(account.id),
  ]);

  if (!delta.latest) notFound();
  const countMap = Object.fromEntries(scoreCounts.map((entry) => [entry.mode, entry.value]));

  return (
    <ProfileDashboard
      profile={account}
      mode={mode}
      stats={{ pp: delta.latest.pp, globalRank: delta.latest.globalRank, countryRank: delta.latest.countryRank, accuracy: delta.latest.accuracy, playCount: delta.latest.playCount, level: delta.latest.level }}
      previous={delta.previous ? { pp: delta.previous.pp, globalRank: delta.previous.globalRank, countryRank: delta.previous.countryRank, accuracy: delta.previous.accuracy, playCount: delta.previous.playCount, level: delta.previous.level } : null}
      growth={history.map((point) => ({ date: point.snapshotDate.slice(5).replace("-", "/"), pp: point.pp, rank: point.globalRank }))}
      recent={recent.map((play) => ({ id: play.id, rank: play.rank, artist: play.artist, title: play.title, difficulty: play.difficulty, pp: play.pp, accuracy: play.accuracy, maxCombo: play.maxCombo, mods: play.mods, endedAt: play.endedAt }))}
      modeScoreCounts={countMap}
      profileHref={`/u/${account.osuUserId}`}
    />
  );
}

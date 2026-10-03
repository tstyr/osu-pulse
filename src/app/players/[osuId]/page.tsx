import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PlayerAnalytics } from "@/components/player-analytics";
import { listAccounts } from "@/db/repository";
import { isOsuMode, MODE_LABELS } from "@/lib/osu/modes";
import { getPublicProfile } from "@/lib/public-profile";

type Props = { params: Promise<{ osuId: string }>; searchParams: Promise<{ mode?: string }> };

async function dataFromProps({ params, searchParams }: Props) {
  const [{ osuId }, query] = await Promise.all([params, searchParams]);
  if (!/^\d{1,10}$/.test(osuId)) return null;
  const mode = isOsuMode(query.mode) ? query.mode : "osu";
  return getPublicProfile(Number(osuId), mode);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const profile = await dataFromProps(props);
  if (!profile) return { title: "Player not found" };
  return {
    title: `${profile.account.username} · ${MODE_LABELS[profile.mode]}`,
    description: `${profile.account.username}のosu!成長記録・プレイ統計`,
    openGraph: { images: [`/api/cards/profile/${profile.account.osuUserId}?mode=${profile.mode}`] },
  };
}

export default async function PublicPlayerPage(props: Props) {
  const profile = await dataFromProps(props);
  if (!profile) notFound();
  const accounts = await listAccounts();
  const comparisonPlayers = accounts.map((account) => ({ osuUserId: account.osuUserId, username: account.username }));
  return <PlayerAnalytics profile={profile} comparisonPlayers={comparisonPlayers} />;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ObsScoreOverlay } from "@/components/obs-score-overlay";
import { getOverlaySnapshot } from "@/db/advanced-features";

export const metadata: Metadata = { title: "osu! Pulse OBS Overlay", robots: { index: false, follow: false } };

export default async function OverlayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const initial = await getOverlaySnapshot(token);
  if (!initial) notFound();
  return <ObsScoreOverlay token={token} initial={initial} />;
}

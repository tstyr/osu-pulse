import type { Metadata } from "next";
import { connection } from "next/server";

import { MusicDashboard } from "@/components/control-panel/music-dashboard";
import { getMusicLibraryView, getMusicPlaybackView } from "@/db/music-repository";

export const metadata: Metadata = { title: "音楽プレイヤー" };

export default async function MusicPage() {
  await connection();
  const [initialPlayback, initialLibrary] = await Promise.all([
    getMusicPlaybackView(),
    getMusicLibraryView(100),
  ]);
  return <MusicDashboard initialPlayback={initialPlayback} initialLibrary={initialLibrary} />;
}

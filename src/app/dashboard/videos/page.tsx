import type { Metadata } from "next";
import { connection } from "next/server";

import { VideoLibraryView } from "@/components/control-panel/video-library";
import { getVideoLibrary } from "@/lib/control/videos";

export const metadata: Metadata = { title: "動画一覧" };

export default async function VideosPage() {
  await connection();
  return <VideoLibraryView data={await getVideoLibrary()} />;
}

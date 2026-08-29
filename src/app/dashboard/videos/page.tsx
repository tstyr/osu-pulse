import type { Metadata } from "next";

import { VideoLibraryView } from "@/components/control-panel/video-library";
import { getVideoLibrary } from "@/lib/control/videos";

export const metadata: Metadata = { title: "動画一覧" };

export default async function VideosPage() {
  return <VideoLibraryView data={await getVideoLibrary()} />;
}

import type { Metadata } from "next";

import { RenderClient } from "./render-client";

export const metadata: Metadata = {
  title: "Replay Renderer | osu! Pulse",
  description: "Vercel からローカル danser へ安全に osu! リプレイレンダーを依頼します。",
};

export default function RenderPage() {
  return <RenderClient />;
}

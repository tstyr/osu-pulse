import type { Metadata } from "next";
import { connection } from "next/server";

import { WebRenderConsole } from "@/components/control-panel/web-render-console";
import { RenderQueueManager } from "@/components/control-panel/render-queue-manager";
import { getControlSettings } from "@/lib/control/settings";
import { listCloudRenderQueue } from "@/lib/render/server";

export const metadata: Metadata = { title: "レンダー" };

export default async function DashboardRenderPage() {
  await connection();
  const [settings, queue] = await Promise.all([getControlSettings(), listCloudRenderQueue()]);
  return <><WebRenderConsole defaults={settings.values.renderDefaults} /><RenderQueueManager initial={queue} defaults={settings.values.renderDefaults} /></>;
}

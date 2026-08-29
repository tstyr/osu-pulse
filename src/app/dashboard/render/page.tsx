import type { Metadata } from "next";

import { WebRenderConsole } from "@/components/control-panel/web-render-console";
import { getControlSettings } from "@/lib/control/settings";

export const metadata: Metadata = { title: "レンダー" };

export default async function DashboardRenderPage() {
  const settings = await getControlSettings();
  return <WebRenderConsole defaults={settings.values.renderDefaults} />;
}

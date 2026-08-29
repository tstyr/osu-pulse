import type { Metadata } from "next";

import { SettingsForm } from "@/components/control-panel/settings-form";
import { getControlSettings } from "@/lib/control/settings";

export const metadata: Metadata = { title: "設定" };

export default async function SettingsPage() {
  return <SettingsForm initial={await getControlSettings()} />;
}

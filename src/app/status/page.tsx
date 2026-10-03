import type { Metadata } from "next";

import { PublicStatusDashboard } from "@/components/public-status-dashboard";
import { getPublicServiceStatus, recordServiceHeartbeat } from "@/db/advanced-features";

export const metadata: Metadata = { title: "Service Status", description: "osu! Pulseの公開稼働状況" };
export const dynamic = "force-dynamic";

export default async function StatusPage() {
  await recordServiceHeartbeat("web", "operational", { source: "status-page" });
  return <PublicStatusDashboard initial={await getPublicServiceStatus()} />;
}

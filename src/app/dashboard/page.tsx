import type { Metadata } from "next";

import { OverviewDashboard } from "@/components/control-panel/overview-dashboard";
import { getDashboardOverview } from "@/lib/control/dashboard";

export const metadata: Metadata = { title: "概要" };

export default async function DashboardPage() {
  return <OverviewDashboard initial={await getDashboardOverview()} />;
}

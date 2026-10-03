import type { Metadata } from "next";
import { connection } from "next/server";

import { OverviewDashboard } from "@/components/control-panel/overview-dashboard";
import { getDashboardOverview } from "@/lib/control/dashboard";

export const metadata: Metadata = { title: "概要" };

export default async function DashboardPage() {
  await connection();
  return <OverviewDashboard initial={await getDashboardOverview()} />;
}

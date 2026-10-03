import type { Metadata } from "next";
import { connection } from "next/server";

import { PerformanceHistory } from "@/components/control-panel/performance-history";
import { getSystemMetricHistory } from "@/db/advanced-features";

export const metadata: Metadata = { title: "性能履歴" };

export default async function PerformancePage() {
  await connection();
  return <PerformanceHistory initial={await getSystemMetricHistory(24)} />;
}

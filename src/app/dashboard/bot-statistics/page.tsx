import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BotStatistics } from "@/components/control-panel/bot-statistics";
import { hasControlPanelSession } from "@/lib/control/auth";

export const metadata: Metadata = { title: "Bot統計" };

export default async function BotStatisticsPage() {
  await connection();
  if (!(await hasControlPanelSession())) redirect("/");
  return <BotStatistics />;
}

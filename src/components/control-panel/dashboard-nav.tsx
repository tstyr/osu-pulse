"use client";

import { Activity, BarChart3, BookOpen, Bot, ChartNoAxesCombined, Clapperboard, Command, Database, ListMusic, RadioTower, Settings2, Swords, Video } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUiPreferences } from "@/components/control-panel/ui-preferences";

const items = [
  { href: "/dashboard", label: { ja: "概要", en: "Overview" }, icon: BarChart3 },
  { href: "/dashboard/command-center", label: { ja: "司令画面", en: "Command" }, icon: Command },
  { href: "/dashboard/statistics", label: { ja: "プレイヤー統計", en: "Player stats" }, icon: ChartNoAxesCombined },
  { href: "/dashboard/bot-statistics", label: { ja: "Bot統計", en: "Bot stats" }, icon: Bot },
  { href: "/compare", label: { ja: "VS比較", en: "Versus" }, icon: Swords },
  { href: "/dashboard/render", label: { ja: "レンダー", en: "Render" }, icon: Clapperboard },
  { href: "/dashboard/videos", label: { ja: "動画", en: "Videos" }, icon: Video },
  { href: "/dashboard/music", label: { ja: "音楽", en: "Music" }, icon: ListMusic },
  { href: "/dashboard/commands", label: { ja: "コマンドガイド", en: "Commands" }, icon: BookOpen },
  { href: "/dashboard/operations", label: { ja: "運用センター", en: "Operations" }, icon: RadioTower },
  { href: "/dashboard/performance", label: { ja: "性能履歴", en: "Performance" }, icon: Activity },
  { href: "/dashboard/settings", label: { ja: "設定", en: "Settings" }, icon: Settings2 },
  { href: "/dashboard/database", label: { ja: "データベース", en: "Database" }, icon: Database },
];

export function DashboardNav() {
  const pathname = usePathname();
  const { locale } = useUiPreferences();
  return (
    <nav className="flex gap-1 overflow-x-auto overscroll-contain lg:block lg:space-y-1">
      {items.map((item) => {
        const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={`flex min-w-16 shrink-0 flex-col items-center gap-1 rounded-md px-2 py-1.5 text-[9px] font-medium transition sm:min-w-20 lg:min-w-0 lg:flex-row lg:gap-2.5 lg:px-3 lg:py-2.5 lg:text-[13px] ${active ? "bg-[#eef4fc] text-[#0051c3]" : "text-[#596477] hover:bg-[#f3f5f7] hover:text-[#1d232d]"}`}
          >
            <Icon className="size-4" /> {item.label[locale]}
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import { Activity, BarChart3, BookOpen, Bot, ChartNoAxesCombined, ChevronRight, Clapperboard, Command, Database, ListMusic, RadioTower, Settings2, Swords, Video } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUiPreferences } from "@/components/control-panel/ui-preferences";
import styles from "./console.module.css";

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

const groups = [
  { label: { ja: "ワークスペース", en: "Workspace" }, paths: ["/dashboard", "/dashboard/command-center", "/dashboard/commands"] },
  { label: { ja: "分析", en: "Analytics" }, paths: ["/dashboard/statistics", "/dashboard/bot-statistics", "/compare", "/dashboard/performance"] },
  { label: { ja: "メディア", en: "Media" }, paths: ["/dashboard/render", "/dashboard/videos", "/dashboard/music"] },
  { label: { ja: "管理", en: "Administration" }, paths: ["/dashboard/operations", "/dashboard/database", "/dashboard/settings"] },
];

function matchesPath(href: string, pathname: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
}

export function DashboardBreadcrumb() {
  const pathname = usePathname();
  const { locale } = useUiPreferences();
  const item = items.find((candidate) => matchesPath(candidate.href, pathname));
  const group = groups.find((candidate) => item && candidate.paths.includes(item.href));
  return <div className={styles.breadcrumb} aria-label={locale === "ja" ? "現在のページ" : "Current page"}>
    <span>{group?.label[locale] ?? "osu! Pulse"}</span><ChevronRight aria-hidden="true" /><strong>{item?.label[locale] ?? (locale === "ja" ? "管理画面" : "Console")}</strong>
  </div>;
}

export function DashboardNav() {
  const pathname = usePathname();
  const { locale } = useUiPreferences();
  return (
    <nav className={styles.nav} aria-label={locale === "ja" ? "管理メニュー" : "Console navigation"}>
      {groups.map((group) => <div key={group.label.en} className={styles.navGroup}>
        <p className={styles.navHeading}>{group.label[locale]}</p>
        {group.paths.map((path) => {
        const item = items.find((candidate) => candidate.href === path)!;
        const active = matchesPath(item.href, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={styles.navLink}
          >
            <Icon aria-hidden="true" /> {item.label[locale]}
          </Link>
        );
      })}</div>)}
    </nav>
  );
}

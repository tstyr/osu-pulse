"use client";

import { BarChart3, Clapperboard, Database, Settings2, Video } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard", label: "概要", icon: BarChart3 },
  { href: "/dashboard/render", label: "レンダー", icon: Clapperboard },
  { href: "/dashboard/videos", label: "動画", icon: Video },
  { href: "/dashboard/settings", label: "設定", icon: Settings2 },
  { href: "/dashboard/database", label: "データベース", icon: Database },
];

export function DashboardNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto lg:block lg:space-y-1">
      {items.map((item) => {
        const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2.5 text-[13px] font-medium transition ${active ? "bg-[#eef4fc] text-[#0051c3]" : "text-[#596477] hover:bg-[#f3f5f7] hover:text-[#1d232d]"}`}
          >
            <Icon className="size-4" /> {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

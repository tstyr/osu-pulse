import { LogOut, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { logout } from "@/app/actions/auth";
import { ControlLogo } from "@/components/control-panel/control-logo";
import { DashboardNav } from "@/components/control-panel/dashboard-nav";
import { hasControlPanelSession } from "@/lib/control/auth";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  if (!(await hasControlPanelSession())) redirect("/");
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="border-b border-[#dfe3e9] bg-white px-4 py-4 lg:fixed lg:inset-y-0 lg:left-0 lg:w-56 lg:border-b-0 lg:border-r lg:px-3 lg:py-5">
        <div className="px-2"><ControlLogo /></div>
        <div className="mt-4 lg:mt-8"><DashboardNav /></div>
        <div className="mt-4 hidden rounded-md border border-[#e1e5ea] bg-[#fafbfc] p-3 lg:absolute lg:bottom-5 lg:left-3 lg:right-3 lg:block">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-[#384252]"><ShieldCheck className="size-3.5 text-[#1f8f5f]" /> Private session</div>
          <p className="mt-1 text-[10px] leading-4 text-[#7b8492]">HttpOnly Cookie・7日間</p>
        </div>
      </aside>
      <div className="lg:col-start-2">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#dfe3e9] bg-white/90 px-4 backdrop-blur-md sm:px-7">
          <div>
            <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-[#8a94a3]">Private workspace</p>
            <p className="text-xs font-medium text-[#303846]">Local renderer + Vercel bridge</p>
          </div>
          <form action={logout}>
            <button type="submit" className="inline-flex h-8 items-center gap-2 rounded-md border border-[#d8dde5] bg-white px-3 text-xs font-medium text-[#4e596b] transition hover:bg-[#f5f6f8] hover:text-[#1b2028]">
              <LogOut className="size-3.5" /> ログアウト
            </button>
          </form>
        </header>
        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-7 sm:py-8">{children}</main>
      </div>
    </div>
  );
}

import { LogOut, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { logout } from "@/app/actions/auth";
import { ControlLogo } from "@/components/control-panel/control-logo";
import { DashboardBreadcrumb, DashboardNav } from "@/components/control-panel/dashboard-nav";
import { PageScaleControls, PageScaleSurface, UiPreferenceControls } from "@/components/control-panel/ui-preferences";
import { getControlPanelSession } from "@/lib/control/auth";
import styles from "@/components/control-panel/console.module.css";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await connection();
  const session = await getControlPanelSession();
  if (!session) redirect("/");
  return (
    <PageScaleSurface className={styles.shell}>
      <a href="#console-content" className={styles.skip}>本文へ移動</a>
      <aside className={styles.sidebar}>
        <div className={styles.brand}><ControlLogo /></div>
        <div className={styles.navContainer}><DashboardNav /></div>
        <div className={styles.session}>
          <ShieldCheck aria-hidden="true" />
          <div><span>{session.discordUsername ?? "管理者"}</span><p>{session.discordUsername ? "Discord認証でログイン中" : "キーフレーズでログイン中"}</p></div>
        </div>
      </aside>
      <div className={styles.body}>
        <header className={styles.header}>
          <DashboardBreadcrumb />
          <div className={styles.tools}><PageScaleControls /><UiPreferenceControls /><form action={logout}>
            <button type="submit" className={styles.logout}>
              <LogOut className="size-3.5" aria-hidden="true" /> ログアウト
            </button>
          </form>
          </div>
        </header>
        <main id="console-content" tabIndex={-1} className={styles.main}>{children}</main>
      </div>
    </PageScaleSurface>
  );
}

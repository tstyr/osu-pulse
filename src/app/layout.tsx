import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { publicAppOrigin } from "@/lib/public-app-url";
import Script from "next/script";
import { ServiceWorkerRegistrar, UiPreferencesProvider } from "@/components/control-panel/ui-preferences";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(publicAppOrigin()),
  title: {
    default: "osu! Pulse Control",
    template: "%s · osu! Pulse Control",
  },
  description: "osu! Pulseのレンダー、統計、設定をまとめて管理するプライベートコンソール。",
  robots: { index: false, follow: false },
  applicationName: "osu! Pulse Control",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "osu! Pulse" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body>
        <Script id="theme-init" strategy="beforeInteractive">{`try{document.documentElement.dataset.theme=localStorage.getItem('osu-pulse-theme')==='dark'?'dark':'light';document.documentElement.lang=localStorage.getItem('osu-pulse-locale')==='en'?'en':'ja'}catch(e){}`}</Script>
        <UiPreferencesProvider><ServiceWorkerRegistrar />{children}</UiPreferencesProvider>
      </body>
    </html>
  );
}

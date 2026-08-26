import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { SiteHeader } from "@/components/site-header";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.WEB_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "osu pulse — Discord analytics for osu!",
    template: "%s · osu pulse",
  },
  description:
    "osu!の成長、リザルト、4モード統計をDiscordとWebでリアルタイムに追跡。",
  openGraph: {
    title: "osu pulse",
    description: "Your osu! growth, live in Discord.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}>
      <body>
        <SiteHeader />
        {children}
        <footer className="mx-auto flex w-full max-w-[1480px] items-center justify-between px-7 py-8 text-[10px] text-zinc-700">
          <span>osu pulse · built for focused players</span>
          <span className="font-mono">Next.js · Neon · Discord · Lavalink</span>
        </footer>
      </body>
    </html>
  );
}

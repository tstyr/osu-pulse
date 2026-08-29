import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.WEB_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "osu! Pulse Control",
    template: "%s · osu! Pulse Control",
  },
  description: "osu! Pulseのレンダー、統計、設定をまとめて管理するプライベートコンソール。",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

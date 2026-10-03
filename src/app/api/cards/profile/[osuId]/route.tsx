/* eslint-disable @next/next/no-img-element -- Satori ImageResponse renders native image elements. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

import { formatRank } from "@/lib/format";
import { isOsuMode, MODE_LABELS } from "@/lib/osu/modes";
import { getPublicProfile } from "@/lib/public-profile";

export const runtime = "nodejs";

const regularFont = readFile(path.join(process.cwd(), "node_modules", "geist", "dist", "fonts", "geist-sans", "Geist-Regular.ttf"));
const boldFont = readFile(path.join(process.cwd(), "node_modules", "geist", "dist", "fonts", "geist-sans", "Geist-Bold.ttf"));

export async function GET(request: Request, { params }: { params: Promise<{ osuId: string }> }) {
  const { osuId } = await params;
  const modeValue = new URL(request.url).searchParams.get("mode");
  const mode = isOsuMode(modeValue) ? modeValue : "osu";
  if (!/^\d{1,10}$/.test(osuId)) return new Response("Not found", { status: 404 });
  const [profile, regularFontData, boldFontData] = await Promise.all([getPublicProfile(Number(osuId), mode), regularFont, boldFont]);
  if (!profile) return new Response("Not found", { status: 404 });
  const latest = profile.latest;
  const top = profile.scores.filter((score) => score.pp !== null).sort((a, b) => (b.pp ?? 0) - (a.pp ?? 0))[0];
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: 52, color: "white", backgroundImage: "linear-gradient(125deg,#0d1524 0%,#223758 68%,#f48120 130%)", fontFamily: "Geist" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
      {profile.account.avatarUrl ? <img src={profile.account.avatarUrl} alt="" width={130} height={130} style={{ borderRadius: 28, border: "3px solid rgba(255,255,255,.65)" }} /> : null}
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}><div style={{ fontSize: 19, letterSpacing: 3, color: "rgba(255,255,255,.6)" }}>{`OSU! PULSE · ${MODE_LABELS[mode].toUpperCase()}`}</div><div style={{ marginTop: 10, fontSize: 54, fontWeight: 700 }}>{profile.account.username}</div><div style={{ marginTop: 8, fontSize: 21, color: "rgba(255,255,255,.7)" }}>{`${profile.account.countryCode ?? "—"} · osu! user ${profile.account.osuUserId}`}</div></div>
    </div>
    <div style={{ display: "flex", gap: 14, marginTop: 42 }}>{[{ label: "PERFORMANCE", value: latest ? `${latest.pp.toFixed(1)} pp` : "—" }, { label: "GLOBAL RANK", value: formatRank(latest?.globalRank) }, { label: "ACCURACY", value: latest ? `${latest.accuracy.toFixed(2)}%` : "—" }, { label: "PLAY COUNT", value: latest?.playCount.toLocaleString() ?? "—" }].map((item) => <div key={item.label} style={{ display: "flex", flexDirection: "column", flex: 1, padding: "20px 22px", borderRadius: 16, background: "rgba(255,255,255,.09)", border: "1px solid rgba(255,255,255,.13)" }}><div style={{ fontSize: 14, letterSpacing: 1.6, color: "rgba(255,255,255,.55)" }}>{item.label}</div><div style={{ marginTop: 8, fontSize: 29, fontWeight: 700 }}>{item.value}</div></div>)}</div>
    <div style={{ display: "flex", marginTop: "auto", alignItems: "center", justifyContent: "space-between" }}><div style={{ display: "flex", flexDirection: "column" }}><div style={{ fontSize: 14, color: "rgba(255,255,255,.5)" }}>BEST SAVED PERFORMANCE</div><div style={{ marginTop: 6, fontSize: 23 }}>{top ? `${top.rank} · ${top.pp?.toFixed(1)}pp · ${top.artist} — ${top.title}` : "No saved scores"}</div></div><div style={{ fontSize: 19, fontWeight: 700, color: "#ffd2ac" }}>osu! Pulse</div></div>
  </div>, { width: 1200, height: 630, fonts: [{ name: "Geist", data: regularFontData, weight: 400 }, { name: "Geist", data: boldFontData, weight: 700 }] });
}

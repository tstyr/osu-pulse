import { ImageResponse } from "next/og";

import { getAccountByOsuId, getGrowthHistory } from "@/db/repository";
import { MODE_ACCENTS, MODE_LABELS, isOsuMode } from "@/lib/osu/modes";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ osuId: string }> },
) {
  const { osuId } = await params;
  const userId = Number(osuId);
  const modeValue = new URL(request.url).searchParams.get("mode");
  const mode = isOsuMode(modeValue) ? modeValue : "osu";

  if (!Number.isSafeInteger(userId)) {
    return new Response("Invalid osu! user ID", { status: 400 });
  }

  const account = await getAccountByOsuId(userId);
  if (!account) return new Response("Player not found", { status: 404 });

  const history = await getGrowthHistory(account.id, mode, 30);
  if (!history.length) return new Response("No growth data", { status: 404 });

  const values = history.map((point) => point.pp);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(maximum - minimum, 1);
  const plotWidth = 920;
  const plotHeight = 210;
  const points = history
    .map((point, index) => {
      const x = history.length === 1 ? plotWidth / 2 : (index / (history.length - 1)) * plotWidth;
      const y = plotHeight - ((point.pp - minimum) / range) * plotHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const gain = values.at(-1)! - values[0];
  const latest = history.at(-1)!;
  const accent = MODE_ACCENTS[mode];

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#0d0d14",
        color: "#ffffff",
        padding: "54px 62px",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 58, height: 58, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", background: `${accent}20`, border: `1px solid ${accent}55`, fontSize: 26 }}>
            {account.username.slice(0, 1).toUpperCase()}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.04em" }}>{account.username}</div>
            <div style={{ marginTop: 6, fontSize: 14, color: "#777786" }}>{MODE_LABELS[mode]} · 30 day growth</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div style={{ fontSize: 30, fontWeight: 600 }}>{latest.pp.toLocaleString()} pp</div>
          <div style={{ marginTop: 4, fontSize: 15, color: gain >= 0 ? "#7ce7b2" : "#ff879f" }}>{gain >= 0 ? "+" : ""}{gain.toFixed(0)} pp</div>
        </div>
      </div>
      <div style={{ marginTop: 40, width: plotWidth, height: plotHeight, display: "flex", position: "relative" }}>
        <svg width={plotWidth} height={plotHeight} viewBox={`0 0 ${plotWidth} ${plotHeight}`}>
          {[0, 1, 2, 3].map((line) => <line key={line} x1="0" y1={(plotHeight / 3) * line} x2={plotWidth} y2={(plotHeight / 3) * line} stroke="rgba(255,255,255,.07)" strokeWidth="1" />)}
          <polyline points={points} fill="none" stroke={accent} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", color: "#666674", fontSize: 13 }}>
        <span>{history[0].snapshotDate}</span>
        <span style={{ color: "#ff9bc7" }}>osu pulse · live Discord analytics</span>
        <span>{latest.snapshotDate}</span>
      </div>
    </div>,
    {
      width: 1044,
      height: 540,
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
    },
  );
}

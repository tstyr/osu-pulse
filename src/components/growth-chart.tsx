"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type GrowthPoint = {
  date: string;
  pp: number;
  rank?: number | null;
};

export function GrowthChart({
  data,
  accent,
}: {
  data: GrowthPoint[];
  accent: string;
}) {
  const values = data.map((point) => point.pp);
  const minimum = values.length ? Math.floor(Math.min(...values) / 100) * 100 : 0;

  return (
    <div className="h-[260px] w-full" role="img" aria-label="PPの成長グラフ">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 4, left: -24, bottom: 0 }}>
          <defs>
            <linearGradient id="ppGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accent} stopOpacity={0.34} />
              <stop offset="92%" stopColor={accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.055)" vertical={false} />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            minTickGap={32}
            tick={{ fill: "#6f7182", fontSize: 11 }}
          />
          <YAxis
            domain={[minimum, "dataMax + 80"]}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#6f7182", fontSize: 11 }}
          />
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,.18)", strokeDasharray: "4 4" }}
            contentStyle={{
              background: "#15151d",
              border: "1px solid rgba(255,255,255,.1)",
              borderRadius: 12,
              boxShadow: "0 18px 50px rgba(0,0,0,.45)",
              color: "#fff",
              fontSize: 12,
            }}
            formatter={(value) => [`${Number(value).toLocaleString()} pp`, "performance"]}
          />
          <Area
            type="monotone"
            dataKey="pp"
            stroke={accent}
            fill="url(#ppGradient)"
            strokeWidth={2.6}
            activeDot={{ r: 4, fill: accent, stroke: "#111118", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

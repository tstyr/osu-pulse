"use client";

import { Activity, Cpu, Gauge, HardDrive, MemoryStick, RefreshCw, Thermometer } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { liveRequestOptions, requestJson } from "@/lib/client/request-json";
import { RefreshNotice } from "@/components/control-panel/refresh-notice";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Sample = {
  id: string;
  sampledAt: string;
  cpuPercent: number;
  gpuPercent: number | null;
  cpuTemperatureC: number | null;
  gpuTemperatureC: number | null;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  activeRenders: number;
  queueSize: number;
};

type DataPoint = Sample & {
  time: string;
  memoryPercent: number;
  diskPercent: number;
};

type SeriesKey =
  | "cpuPercent"
  | "gpuPercent"
  | "memoryPercent"
  | "cpuTemperatureC"
  | "gpuTemperatureC"
  | "diskPercent"
  | "queueSize";

type SeriesDefinition = {
  key: SeriesKey;
  name: string;
  stroke: string;
  axis?: "percent" | "queue";
  type?: "monotone" | "stepAfter";
};

const utilizationSeries: SeriesDefinition[] = [
  { key: "cpuPercent", name: "CPU", stroke: "#2563eb" },
  { key: "gpuPercent", name: "GPU", stroke: "#f97316" },
  { key: "memoryPercent", name: "Memory", stroke: "#10b981" },
];

const temperatureSeries: SeriesDefinition[] = [
  { key: "cpuTemperatureC", name: "CPU Temp", stroke: "#ef4444" },
  { key: "gpuTemperatureC", name: "GPU Temp", stroke: "#a855f7" },
];

const diskQueueSeries: SeriesDefinition[] = [
  { key: "diskPercent", name: "Disk", stroke: "#475569", axis: "percent" },
  { key: "queueSize", name: "Queue", stroke: "#dc3d43", axis: "queue", type: "stepAfter" },
];

function percent(used: number, total: number) {
  return total > 0 ? Math.round((used / total) * 1_000) / 10 : 0;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

function averageValue(data: DataPoint[], key: SeriesKey) {
  const values = data.map((item) => item[key]).filter((value): value is number => typeof value === "number");
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function latestValue(value: number | null | undefined, digits = 1, unit = "") {
  return typeof value === "number" ? `${value.toFixed(digits)}${unit}` : "—";
}

function lineOpacity(activeSeries: SeriesKey | null, key: SeriesKey) {
  return !activeSeries || activeSeries === key ? 1 : 0.16;
}

function lineWidth(activeSeries: SeriesKey | null, key: SeriesKey) {
  return activeSeries === key ? 3.2 : 2.1;
}

function FocusHint({ activeSeries, onClear }: { activeSeries: SeriesKey | null; onClear: () => void }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-[#7d8795]">
      <span>{activeSeries ? "線をフォーカス中" : "線をクリックでフォーカス"}</span>
      {activeSeries ? (
        <button type="button" onClick={onClear} className="rounded border border-[#d8dde6] bg-white px-2 py-1 font-semibold text-[#435066]">
          解除
        </button>
      ) : null}
    </div>
  );
}

export function PerformanceHistory({ initial }: { initial: Sample[] }) {
  const [hours, setHours] = useState(24);
  const { data: result, error, isValidating: busy, mutate } = useSWR<{ samples: Sample[] }>(
    `/api/control/metrics?hours=${hours}`,
    requestJson,
    { ...liveRequestOptions, fallbackData: hours === 24 ? { samples: initial } : undefined, refreshInterval: 30_000 },
  );
  const samples = result?.samples ?? initial;
  const [activeSeries, setActiveSeries] = useState<SeriesKey | null>(null);

  const data = useMemo(() => samples.map((item) => ({
    ...item,
    time: formatTime(item.sampledAt),
    memoryPercent: percent(item.memoryUsedBytes, item.memoryTotalBytes),
    diskPercent: percent(item.diskUsedBytes, item.diskTotalBytes),
  })), [samples]);

  const latest = data.at(-1);
  const toggleFocus = (key: SeriesKey) => setActiveSeries((current) => (current === key ? null : key));
  const temperatureAverage = averageValue(data, "gpuTemperatureC") ?? averageValue(data, "cpuTemperatureC");

  const summaryCards = [
    { label: "CPU", value: latestValue(latest?.cpuPercent, 1, "%"), detail: averageValue(data, "cpuPercent"), unit: "%", icon: Cpu },
    { label: "GPU", value: latestValue(latest?.gpuPercent, 1, "%"), detail: averageValue(data, "gpuPercent"), unit: "%", icon: Gauge },
    { label: "Memory", value: latestValue(latest?.memoryPercent, 1, "%"), detail: averageValue(data, "memoryPercent"), unit: "%", icon: MemoryStick },
    { label: "Temperature", value: latestValue(latest?.gpuTemperatureC ?? latest?.cpuTemperatureC, 1, "℃"), detail: temperatureAverage, unit: "℃", icon: Thermometer },
    { label: "Queue", value: latestValue(latest?.queueSize, 0), detail: null, unit: "", icon: Activity },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f48120]">Performance telemetry</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">CPU・GPU 性能履歴</h1>
          <p className="mt-1 text-sm text-[#6f7a8c]">Rendererから約1分ごとに保存した実測値です。温度は取得できる端末のみ記録されます。</p>
        </div>
        <div className="flex gap-2">
          <select
            value={hours}
            onChange={(event) => {
              const value = Number(event.target.value);
              setHours(value);
            }}
            className="cp-select !mt-0 w-32"
          >
            <option value="6">6時間</option>
            <option value="24">24時間</option>
            <option value="168">7日</option>
            <option value="720">30日</option>
          </select>
          <button type="button" disabled={busy} onClick={() => void mutate().catch(() => undefined)} className="inline-flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-xs disabled:opacity-50">
            <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
            更新
          </button>
        </div>
      </div>

      <RefreshNotice error={error} retry={() => { void mutate().catch(() => undefined); }} />
      <p role="status" className="mt-3 text-xs text-[#6f7a8c]">{busy ? "選択した期間のデータを更新中…" : latest ? `最終記録 ${latest.time}（JST）` : "この期間の記録はまだありません。"}</p>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {summaryCards.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="cp-panel p-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7d8795]">{item.label}</p>
                <Icon className="size-4 text-[#637084]" />
              </div>
              <p className="mt-3 text-2xl font-semibold">{item.value}</p>
              <p className="mt-1 text-[10px] text-[#8a94a3]">
                {item.label === "Queue" ? `${latest?.activeRenders ?? 0}本 実行中` : item.detail === null ? "この期間の計測値なし" : `平均 ${item.detail.toFixed(1)}${item.unit}`}
              </p>
            </div>
          );
        })}
      </section>

      <section className="cp-panel mt-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">CPU / GPU / Memory</h2>
            <p className="mt-1 text-[11px] text-[#7d8795]">期間内 {data.length.toLocaleString()}サンプル</p>
          </div>
          <FocusHint activeSeries={activeSeries} onClear={() => setActiveSeries(null)} />
        </div>
        <div className="h-[430px] p-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" minTickGap={48} tick={{ fontSize: 9 }} />
              <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} onClick={(entry) => toggleFocus(entry.dataKey as SeriesKey)} />
              {utilizationSeries.map((series) => (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.name}
                  stroke={series.stroke}
                  dot={false}
                  strokeWidth={lineWidth(activeSeries, series.key)}
                  strokeOpacity={lineOpacity(activeSeries, series.key)}
                  activeDot={{ r: 5, onClick: () => toggleFocus(series.key) }}
                  onClick={() => toggleFocus(series.key)}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="cp-panel mt-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Thermometer className="size-4" />Temperature</h2>
            <p className="mt-1 text-[11px] text-[#7d8795]">CPU/GPU温度。センサーを読めない端末では空になります。</p>
          </div>
          <FocusHint activeSeries={activeSeries} onClear={() => setActiveSeries(null)} />
        </div>
        <div className="h-72 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" minTickGap={48} tick={{ fontSize: 9 }} />
              <YAxis domain={[0, 100]} unit="℃" tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} onClick={(entry) => toggleFocus(entry.dataKey as SeriesKey)} />
              {temperatureSeries.map((series) => (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.name}
                  stroke={series.stroke}
                  connectNulls
                  dot={false}
                  strokeWidth={lineWidth(activeSeries, series.key)}
                  strokeOpacity={lineOpacity(activeSeries, series.key)}
                  activeDot={{ r: 5, onClick: () => toggleFocus(series.key) }}
                  onClick={() => toggleFocus(series.key)}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="cp-panel mt-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><HardDrive className="size-4" />Disk / Queue</h2>
          <FocusHint activeSeries={activeSeries} onClear={() => setActiveSeries(null)} />
        </div>
        <div className="h-72 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" minTickGap={48} tick={{ fontSize: 9 }} />
              <YAxis yAxisId="percent" domain={[0, 100]} unit="%" tick={{ fontSize: 9 }} />
              <YAxis yAxisId="queue" orientation="right" allowDecimals={false} tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} onClick={(entry) => toggleFocus(entry.dataKey as SeriesKey)} />
              {diskQueueSeries.map((series) => (
                <Line
                  key={series.key}
                  yAxisId={series.axis}
                  type={series.type ?? "monotone"}
                  dataKey={series.key}
                  name={series.name}
                  stroke={series.stroke}
                  dot={false}
                  strokeWidth={lineWidth(activeSeries, series.key)}
                  strokeOpacity={lineOpacity(activeSeries, series.key)}
                  activeDot={{ r: 5, onClick: () => toggleFocus(series.key) }}
                  onClick={() => toggleFocus(series.key)}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

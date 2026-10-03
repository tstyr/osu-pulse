"use client";

import { Activity, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { liveRequestOptions, requestJson } from "@/lib/client/request-json";
import { RefreshNotice } from "@/components/control-panel/refresh-notice";

import type { PlayerStatisticsDataset } from "@/lib/control/statistics";

const PlayerStatistics = dynamic(
  () => import("@/components/control-panel/player-statistics").then((module) => module.PlayerStatistics),
  {
    ssr: false,
    loading: () => <StatisticsLoading label="グラフを準備しています" />,
  },
);

function StatisticsLoading({ label = "統計データを読み込んでいます" }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" className="cp-panel grid min-h-[420px] place-items-center p-8 text-center">
      <div>
        <Activity className="mx-auto size-7 animate-pulse text-[#0051c3]" />
        <p className="mt-4 text-sm font-semibold text-[#303846]">{label}</p>
        <p className="mt-1 text-[10px] text-[#7d8795]">このページを開いた時だけ全プレイヤーの履歴を集計します。</p>
      </div>
    </div>
  );
}

export function PlayerStatisticsLoader() {
  const { data: dataset, error, isValidating, mutate } = useSWR<PlayerStatisticsDataset>(
    "/api/control/statistics", requestJson,
    { ...liveRequestOptions, revalidateOnFocus: false, dedupingInterval: 15_000 },
  );
  const retry = () => { void mutate().catch(() => undefined); };
  return <>
    <RefreshNotice error={error} retry={retry} />
    {dataset ? <>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-3 text-xs text-[#6f7a8c]">
        <span>集計 {new Date(dataset.generatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} JST</span>
        <button type="button" onClick={retry} disabled={isValidating} className="inline-flex items-center gap-2 rounded border px-3 py-2 disabled:opacity-50">
          <RefreshCw className={`size-3.5 ${isValidating ? "animate-spin" : ""}`} />統計を更新
        </button>
      </div>
      <PlayerStatistics dataset={dataset} />
    </> : !error ? <StatisticsLoading /> : null}
  </>;
}

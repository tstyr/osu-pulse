import type { Metadata } from "next";
import { AlertTriangle, Database, RefreshCcw } from "lucide-react";
import { connection } from "next/server";

import { CommandCenter } from "@/components/control-panel/command-center";
import { ServiceRestartPanel } from "@/components/control-panel/service-restart-panel";
import { isDatabaseQuotaExceededError } from "@/db";
import { listServiceControlCommands } from "@/db/service-control-repository";
import { getCommandCenterView } from "@/lib/control/command-center";

export const metadata: Metadata = { title: "リアルタイム司令画面" };

export default async function CommandCenterPage() {
  await connection();
  let initial: Awaited<ReturnType<typeof getCommandCenterView>>;
  let serviceCommands: Awaited<ReturnType<typeof listServiceControlCommands>>;
  try {
    [initial, serviceCommands] = await Promise.all([
      getCommandCenterView(),
      listServiceControlCommands(),
    ]);
  } catch (error) {
    const quotaExceeded = isDatabaseQuotaExceededError(error);
    return <section className="cp-panel overflow-hidden">
      <div className="border-b border-[#e2e6eb] px-5 py-4">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f48120]">Live command center</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">リアルタイム司令画面</h1>
      </div>
      <div className="p-6 sm:p-10">
        <div className="mx-auto max-w-2xl rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <div className="flex items-start gap-3">
            {quotaExceeded ? <Database className="mt-0.5 size-5 shrink-0 text-amber-700" /> : <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700" />}
            <div>
              <h2 className="text-sm font-semibold">{quotaExceeded ? "データベース転送量の上限に達しています" : "管理データを取得できませんでした"}</h2>
              <p className="mt-2 text-xs leading-5 text-amber-900">{quotaExceeded
                ? "Neonのデータ転送量がプラン上限を超えています。上限が更新されるか、DB接続先を変更すると自動的に復旧します。ローカルのBot・Renderer・Lavalinkは通知領域アイコンから操作できます。"
                : "一時的な通信障害の可能性があります。少し待ってから再読み込みしてください。"}</p>
              <a href="/dashboard/command-center" className="mt-4 inline-flex h-8 items-center gap-2 rounded-md border border-amber-300 bg-white px-3 text-[10px] font-semibold text-amber-900 hover:bg-amber-100"><RefreshCcw className="size-3" />再読み込み</a>
            </div>
          </div>
        </div>
      </div>
    </section>;
  }
  return <>
    <CommandCenter initial={initial} />
    <ServiceRestartPanel initial={serviceCommands.map((command) => ({
      ...command,
      requestedAt: command.requestedAt.toISOString(),
      completedAt: command.completedAt?.toISOString() ?? null,
    }))} />
  </>;
}

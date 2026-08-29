import { Box, Database, HardDrive, Server, Table2, UserRound } from "lucide-react";
import type { Metadata } from "next";

import { getDatabaseDetails } from "@/lib/control/dashboard";

export const metadata: Metadata = { title: "データベース" };

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

export default async function DatabasePage() {
  const data = await getDatabaseDetails();
  return (
    <div>
      <div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f48120]">Data</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">データベース詳細</h1><p className="mt-1 text-sm text-[#6f7a8c]">Neon Postgresの容量、テーブル、インデックスを読み取り専用で表示します。</p></div>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="cp-panel p-4"><Database className="size-4 text-[#0051c3]" /><p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7d8795]">Database</p><p className="mt-1 truncate text-lg font-semibold">{data.database.name}</p></div>
        <div className="cp-panel p-4"><HardDrive className="size-4 text-[#f48120]" /><p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7d8795]">Total size</p><p className="mt-1 text-lg font-semibold">{formatBytes(data.database.sizeBytes)}</p></div>
        <div className="cp-panel p-4"><Table2 className="size-4 text-emerald-600" /><p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7d8795]">Tables</p><p className="mt-1 text-lg font-semibold">{data.tables.length}</p></div>
        <div className="cp-panel p-4"><Server className="size-4 text-[#667184]" /><p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7d8795]">Provider</p><p className="mt-1 text-lg font-semibold">{data.database.provider}</p></div>
      </section>

      <section className="cp-panel mt-5 overflow-hidden">
        <div className="border-b border-[#e2e6eb] px-5 py-4"><h2 className="text-sm font-semibold">接続情報</h2><p className="mt-1 text-[11px] text-[#7d8795]">パスワードや接続URLは表示しません。</p></div>
        <dl className="grid gap-px bg-[#e3e7ec] sm:grid-cols-2 xl:grid-cols-4">
          <div className="bg-white p-4"><dt className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[#7d8795]"><Database className="size-3.5" /> Database</dt><dd className="mt-2 font-mono text-xs font-semibold">{data.database.name}</dd></div>
          <div className="bg-white p-4"><dt className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[#7d8795]"><UserRound className="size-3.5" /> Role</dt><dd className="mt-2 font-mono text-xs font-semibold">{data.database.user}</dd></div>
          <div className="bg-white p-4 sm:col-span-2"><dt className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[#7d8795]"><Box className="size-3.5" /> Engine</dt><dd className="mt-2 truncate font-mono text-xs font-semibold">{data.database.version}</dd></div>
        </dl>
      </section>

      <section className="cp-panel mt-5 overflow-hidden">
        <div className="border-b border-[#e2e6eb] px-5 py-4"><h2 className="text-sm font-semibold">テーブル使用量</h2><p className="mt-1 text-[11px] text-[#7d8795]">行数はPostgreSQL統計の概算値です。</p></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead className="bg-[#fafbfc] text-[10px] uppercase tracking-[0.08em] text-[#7d8795]"><tr><th className="px-5 py-3 font-semibold">Table</th><th className="px-4 py-3 text-right font-semibold">Rows</th><th className="px-4 py-3 text-right font-semibold">Data</th><th className="px-4 py-3 text-right font-semibold">Indexes</th><th className="px-5 py-3 text-right font-semibold">Total</th></tr></thead>
            <tbody className="divide-y divide-[#e8ebef]">
              {data.tables.map((table) => <tr key={table.name} className="hover:bg-[#fbfcfd]"><td className="px-5 py-3 font-mono font-semibold text-[#303947]">{table.name}</td><td className="px-4 py-3 text-right font-mono text-[#667184]">{table.approximateRows.toLocaleString()}</td><td className="px-4 py-3 text-right font-mono text-[#667184]">{formatBytes(table.dataBytes)}</td><td className="px-4 py-3 text-right font-mono text-[#667184]">{formatBytes(table.indexBytes)}</td><td className="px-5 py-3 text-right font-mono font-semibold">{formatBytes(table.totalBytes)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

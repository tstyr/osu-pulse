"use client";

import Link from "next/link";

export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <section role="alert" className="cp-panel p-6">
    <h1 className="text-lg font-semibold">この画面を読み込めませんでした</h1>
    <p className="mt-2 text-sm text-[#6f7a8c]">接続先の応答を確認できませんでした。少し待ってから再試行してください。</p>
    {error.digest ? <p className="mt-2 font-mono text-xs text-[#6f7a8c]">エラーID: {error.digest}</p> : null}
    <div className="mt-5 flex flex-wrap gap-3">
      <button type="button" onClick={retry} className="rounded-md bg-[#0051c3] px-4 py-2 text-sm font-semibold text-white">再試行</button>
      <Link href="/dashboard" className="rounded-md border px-4 py-2 text-sm">概要に戻る</Link>
    </div>
  </section>;
}

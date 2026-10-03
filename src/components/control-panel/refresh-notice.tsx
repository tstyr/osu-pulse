"use client";

import Link from "next/link";
import { RequestError } from "@/lib/client/request-json";

export function RefreshNotice({ error, retry }: { error: unknown; retry: () => void }) {
  if (!error) return null;
  return <div role="status" className="my-3 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
    <span className="flex-1">{error instanceof Error ? error.message : "更新できませんでした。"} 保存済みの表示は保持しています。</span>
    {error instanceof RequestError && error.status === 401
      ? <Link href="/" className="rounded border border-amber-300 px-3 py-1.5 font-semibold">ログイン画面へ</Link>
      : <button type="button" onClick={retry} className="rounded border border-amber-300 px-3 py-1.5 font-semibold">再試行</button>}
  </div>;
}

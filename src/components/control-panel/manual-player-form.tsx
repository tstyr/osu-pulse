"use client";

import { AlertCircle, CheckCircle2, LoaderCircle, UserPlus } from "lucide-react";
import { useActionState } from "react";

import { addManualPlayer } from "@/app/dashboard/database/actions";

export function ManualPlayerForm() {
  const [state, action, pending] = useActionState(addManualPlayer, null);
  return (
    <form action={action} className="cp-panel mt-5 overflow-hidden">
      <div className="border-b border-[#e2e6eb] px-5 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><UserPlus className="size-4 text-[#0051c3]" /> プレイヤーを手動追加</h2>
        <p className="mt-1 text-[11px] leading-5 text-[#7d8795]">Discordで<code className="mx-1 rounded bg-[#eef1f5] px-1 font-mono text-[10px]">/osu link</code>を実行していないプレイヤーもDBへ追加し、4モードの統計収集を開始できます。</p>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end">
        <label className="cp-label">osu!ユーザー名 / User ID
          <input name="username" required maxLength={64} placeholder="例: hakaka_aa または 40389660" className="cp-input" />
        </label>
        <label className="cp-label">検索モード
          <select name="mode" defaultValue="osu" className="cp-select">
            <option value="osu">osu!standard</option>
            <option value="mania">mania</option>
            <option value="taiko">taiko</option>
            <option value="fruits">catch</option>
          </select>
        </label>
        <button type="submit" disabled={pending} className="cp-button-primary h-10 min-w-36">
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          {pending ? "登録・集計中…" : "追跡を開始"}
        </button>
      </div>
      {state ? (
        <div role="status" className={`mx-5 mb-5 flex items-start gap-2 rounded-md border px-4 py-3 text-xs leading-5 ${state.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {state.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertCircle className="mt-0.5 size-4 shrink-0" />}
          <span>{state.message}{state.ok && state.osuUserId ? <> <a href={`https://osu.ppy.sh/users/${state.osuUserId}`} target="_blank" rel="noreferrer" className="font-semibold underline">プロフィールを開く</a></> : null}</span>
        </div>
      ) : null}
    </form>
  );
}

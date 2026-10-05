"use client";

import { AlertCircle, ArrowRight, KeyRound, LoaderCircle, MessageCircle, RefreshCw } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { login } from "@/app/actions/auth";
import { loginRecoveryVisible, scheduleLoginRecovery } from "./login-recovery";

export function LoginForm({ discordEnabled, oauthError }: { discordEnabled: boolean; oauthError: string | null }) {
  const [state, action, pending] = useActionState(login, null);
  const [delayed, setDelayed] = useState(false);
  useEffect(() => scheduleLoginRecovery(pending, setDelayed), [pending]);
  return (
    <div>
      {discordEnabled ? <>
        <a href="/api/auth/discord/start" className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#5865f2] text-sm font-semibold text-white transition hover:bg-[#4752c4]">
          <MessageCircle className="size-4" /> Discordでログイン
        </a>
        <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-[0.12em] text-[#9aa2ae]"><span className="h-px flex-1 bg-[#e2e6ec]" />または<span className="h-px flex-1 bg-[#e2e6ec]" /></div>
      </> : null}
      {oauthError ? <p role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700"><AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {oauthError}</p> : null}
      <form action={action} onSubmit={() => setDelayed(false)}>
      <label className="cp-label" htmlFor="keyphrase">キーフレーズ</label>
      <div className="relative mt-1">
        <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8a94a3]" />
        <input
          id="keyphrase"
          name="keyphrase"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          placeholder="管理用キーフレーズ"
          className="cp-input !mt-0 !h-11 pl-10"
        />
      </div>
      {state?.error ? (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="cp-button-primary mt-5 w-full !min-h-11">
        {pending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
        {pending ? "確認中…" : "ログイン"}
      </button>
      {loginRecoveryVisible(pending, delayed) ? <div role="status" aria-live="polite" className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><p>応答が遅れています。古い画面の場合は再読み込みしてから、もう一度ログインしてください。通信状況も確認してください。</p><p className="mt-1 text-[11px]">この案内は認証の失敗を意味しません。自動で再送はしません。</p><button type="button" onClick={() => window.location.reload()} className="mt-3 inline-flex items-center gap-1.5 rounded border border-amber-300 bg-white px-3 py-1.5 font-semibold"><RefreshCw className="size-3.5" />ページを再読み込み</button></div> : null}
      </form>
    </div>
  );
}

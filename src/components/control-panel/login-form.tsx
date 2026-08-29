"use client";

import { AlertCircle, ArrowRight, KeyRound, LoaderCircle } from "lucide-react";
import { useActionState } from "react";

import { login } from "@/app/actions/auth";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action}>
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
    </form>
  );
}

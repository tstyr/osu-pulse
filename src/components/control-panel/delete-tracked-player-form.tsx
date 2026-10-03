"use client";

import { AlertCircle, CheckCircle2, LoaderCircle, Trash2 } from "lucide-react";
import { useActionState } from "react";

import { deleteTrackedPlayer } from "@/app/dashboard/database/actions";

type DeleteTrackedPlayerFormProps = {
  accountId: string;
  username: string;
};

export function DeleteTrackedPlayerForm({ accountId, username }: DeleteTrackedPlayerFormProps) {
  const [state, action, pending] = useActionState(deleteTrackedPlayer, null);
  return (
    <form action={action} className="flex min-w-[260px] flex-col items-end gap-2">
      <input type="hidden" name="accountId" value={accountId} />
      <label className="sr-only" htmlFor={`delete-confirm-${accountId}`}>{username} の削除確認</label>
      <div className="flex w-full items-center justify-end gap-2">
        <input
          id={`delete-confirm-${accountId}`}
          name="confirmUsername"
          placeholder={username}
          autoComplete="off"
          className="h-8 w-36 rounded-md border border-[#d8dde6] bg-white px-2 font-mono text-[11px] text-[#303947] outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 text-[11px] font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
          title="入力したユーザーをDBから削除"
        >
          {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          削除
        </button>
      </div>
      {state ? (
        <p className={`flex max-w-[260px] items-start gap-1.5 text-right text-[10px] leading-4 ${state.ok ? "text-emerald-700" : "text-red-700"}`}>
          {state.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 size-3.5 shrink-0" />}
          <span>{state.message}</span>
        </p>
      ) : (
        <p className="text-right text-[10px] leading-4 text-[#8a94a3]">削除するにはユーザー名を入力</p>
      )}
    </form>
  );
}

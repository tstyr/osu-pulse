"use client";

import { useMemo, useState } from "react";
import type { CommandGuideEntry } from "@/lib/discord/command-catalog";

export function CommandGuide({ entries }: { entries: CommandGuideEntry[] }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [notice, setNotice] = useState("");
  const groups = useMemo(() => [...new Set(entries.map((entry) => entry.group))].sort(), [entries]);
  const filtered = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter((entry) => (!group || entry.group === group) && terms.every((term) =>
      `${entry.command} ${entry.description} ${entry.options.map((option) => `${option.name} ${option.description} ${option.choices.join(" ")}`).join(" ")}`.toLocaleLowerCase().includes(term),
    ));
  }, [entries, query, group]);

  async function copy(command: string) {
    try { await navigator.clipboard.writeText(command); setNotice(`${command} をコピーしました。Discordの入力欄で候補を選び、引数を指定してください。`); }
    catch { setNotice("コピーできませんでした。コマンド名の文字を選択してコピーしてください。"); }
  }

  return <div>
    <h1 className="text-2xl font-semibold">Discordコマンドガイド</h1>
    <p className="mt-2 text-sm text-[#6f7a8c]">用途・名前・引数から検索できます。実行はDiscord上で行います。</p>
    <div className="cp-panel mt-5 flex flex-wrap gap-3 p-4">
      <label className="min-w-0 flex-1 text-xs font-medium">キーワード<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例：成長、音楽、レンダー、pp" className="cp-input" /></label>
      <label className="text-xs font-medium">コマンド<select value={group} onChange={(event) => setGroup(event.target.value)} className="cp-select"><option value="">すべて</option>{groups.map((name) => <option key={name} value={name}>/{name}</option>)}</select></label>
    </div>
    <p role="status" className="my-3 text-xs text-[#6f7a8c]">{filtered.length} / {entries.length} 操作 {notice ? `· ${notice}` : ""}</p>
    {!filtered.length ? <div className="cp-panel p-6"><p className="text-sm">一致するコマンドがありません。</p><button type="button" onClick={() => { setQuery(""); setGroup(""); }} className="mt-3 text-sm text-[#0051c3]">検索条件をクリア</button></div> : null}
    <div className="grid items-start gap-3 xl:grid-cols-2">{filtered.map((entry) => <article key={entry.command} className="cp-panel min-w-0 p-4">
      <div className="flex items-start gap-2"><h2 className="min-w-0 flex-1 break-words font-mono text-sm font-semibold text-[#0051c3]">{entry.command}</h2><button type="button" aria-label={`${entry.command}をコピー`} onClick={() => void copy(entry.command)} className="shrink-0 rounded border px-2 py-1 text-xs">コピー</button></div>
      <p className="mt-2 text-sm">{entry.description}</p>
      {entry.admin ? <p className="mt-2 text-xs text-amber-700">実行にはサーバーの管理権限などが必要です</p> : null}
      {entry.options.length ? <details className="mt-3 border-t pt-3"><summary className="cursor-pointer text-xs font-semibold">引数 {entry.options.length}個（必須 {entry.options.filter((option) => option.required).length}個）</summary><dl className="mt-3 space-y-3">{entry.options.map((option) => <div key={option.name}><dt className="text-xs font-semibold"><code>{option.name}</code> <span className={option.required ? "text-red-700" : "text-[#6f7a8c]"}>{option.required ? "必須" : "任意"}</span></dt><dd className="mt-1 break-words text-xs text-[#6f7a8c]">{option.description}{option.choices.length ? ` · 選択肢：${option.choices.join(" / ")}` : ""}</dd></div>)}</dl></details> : <p className="mt-3 text-xs text-[#6f7a8c]">引数なし</p>}
    </article>)}</div>
  </div>;
}

import { ExternalLink, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { getAccountByOsuId } from "@/db/repository";
import { formatAccuracy, formatNumber, formatRank } from "@/lib/format";
import { getOsuUser, OsuApiError } from "@/lib/osu/client";
import { isOsuMode, MODE_LABELS, OSU_MODES } from "@/lib/osu/modes";

export const dynamic = "force-dynamic";

export default async function PlayerSearch({ searchParams }: { searchParams: Promise<{ q?: string; mode?: string }> }) {
  const query = await searchParams;
  const username = query.q?.trim();
  const mode = isOsuMode(query.mode) ? query.mode : "osu";

  if (!username) return <SearchEmpty />;
  if (!process.env.OSU_CLIENT_ID || !process.env.OSU_CLIENT_SECRET) return <SearchSetupRequired username={username} />;

  const result = await lookupPlayer(username, mode);
  if (!result.ok) {
    return <main className="mx-auto max-w-2xl px-5 py-24 text-center"><div className="surface p-10"><Search className="mx-auto size-6 text-zinc-600" /><h1 className="mt-5 text-xl font-medium text-white">{result.missing ? "プレイヤーが見つかりません" : "osu! APIに接続できません"}</h1><p className="mt-2 text-xs leading-6 text-zinc-500">入力を確認して、もう一度検索してください。</p></div></main>;
  }

  const { user, tracked } = result;
  const stats = user.statistics;
  const metrics = [
    ["PP", stats ? `${formatNumber(stats.pp)} pp` : "—"],
    ["Global", stats ? formatRank(stats.global_rank) : "—"],
    ["Accuracy", stats ? formatAccuracy(stats.hit_accuracy) : "—"],
    ["Play count", stats ? formatNumber(stats.play_count) : "—"],
  ];

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-16">
      <div className="surface overflow-hidden">
        <div className="border-b border-white/[0.06] p-6 sm:p-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-pink-300">player lookup</p>
          <div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-medium tracking-[-0.045em] text-white">{user.username}</h1>
              <p className="mt-2 text-xs text-zinc-500">{user.country_code} · {MODE_LABELS[mode]}</p>
            </div>
            {tracked ? (
              <Link href={`/u/${user.id}?mode=${mode}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white px-4 text-xs font-semibold text-black">成長ダッシュボード <ExternalLink className="size-3.5" /></Link>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-xl border border-amber-300/10 bg-amber-300/[0.055] px-3 py-2 text-[10px] text-amber-200"><ShieldCheck className="size-3.5" /> /osu link で追跡を開始</span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px bg-white/[0.055] sm:grid-cols-4">
          {metrics.map(([label, value]) => (
            <div key={label} className="bg-[#15151d] p-5"><p className="text-[10px] text-zinc-600">{label}</p><p className="mt-2 font-mono text-lg text-white">{value}</p></div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 p-5">
          {OSU_MODES.map((item) => <Link key={item} href={`/player?q=${encodeURIComponent(username)}&mode=${item}`} className={`rounded-lg px-3 py-1.5 text-[10px] ${item === mode ? "bg-pink-300/10 text-pink-200" : "bg-white/[0.035] text-zinc-500"}`}>{MODE_LABELS[item]}</Link>)}
        </div>
      </div>
    </main>
  );
}

async function lookupPlayer(username: string, mode: (typeof OSU_MODES)[number]) {
  try {
    const user = await getOsuUser(username, mode);
    const tracked = await getAccountByOsuId(user.id);
    return { ok: true as const, tracked, user };
  } catch (error) {
    return {
      ok: false as const,
      missing: error instanceof OsuApiError && error.status === 404,
    };
  }
}

function SearchEmpty() {
  return <main className="mx-auto max-w-2xl px-5 py-24 text-center"><div className="surface p-10"><Search className="mx-auto size-6 text-pink-300" /><h1 className="mt-5 text-xl font-medium text-white">osu!プレイヤーを検索</h1><form action="/player" className="mx-auto mt-6 flex max-w-md gap-2"><input name="q" required placeholder="username" className="h-11 min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-black/20 px-4 text-sm text-white outline-none" /><button className="rounded-xl bg-white px-5 text-xs font-semibold text-black">検索</button></form></div></main>;
}

function SearchSetupRequired({ username }: { username: string }) {
  return <main className="mx-auto max-w-2xl px-5 py-24 text-center"><div className="surface p-10"><ShieldCheck className="mx-auto size-6 text-amber-300" /><h1 className="mt-5 text-xl font-medium text-white">osu! APIの設定が必要です</h1><p className="mt-3 text-xs leading-6 text-zinc-500">OSU_CLIENT_ID と OSU_CLIENT_SECRET をVercelに追加すると「{username}」を検索できます。</p><Link href="/docs" className="mt-6 inline-flex rounded-xl bg-white px-5 py-3 text-xs font-semibold text-black">セットアップを見る</Link></div></main>;
}

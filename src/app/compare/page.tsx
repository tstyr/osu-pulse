import { Swords, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ComparisonLauncher } from "@/components/comparison-launcher";
import { listAccounts } from "@/db/repository";
import { isOsuMode } from "@/lib/osu/modes";

export const metadata: Metadata = {
  title: "VS比較",
  description: "登録済みosu!プレイヤーを選んで成長記録を比較します。",
};
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ left?: string; mode?: string }> };

export default async function ComparisonSelectPage({ searchParams }: Props) {
  const query = await searchParams;
  const accounts = await listAccounts();
  const players = accounts.map((account) => ({ osuUserId: account.osuUserId, username: account.username }));
  const requestedLeft = /^\d{1,10}$/.test(query.left ?? "") ? Number(query.left) : undefined;
  const mode = isOsuMode(query.mode) ? query.mode : "osu";

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-7 sm:py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#f48120]">Player versus</p>
          <h1 className="mt-2 flex items-center gap-2 text-3xl font-semibold tracking-[-0.04em]"><Swords className="size-7 text-[#8c7cff]" /> VS比較</h1>
          <p className="mt-2 text-sm text-[#697386]">登録済みプレイヤーとモードを選ぶと、成長・実力・共通譜面を比較できます。</p>
        </div>
        <Link href="/dashboard/statistics" className="text-xs font-semibold text-[#0051c3]">プレイヤー統計へ</Link>
      </header>

      <section className="cp-panel mt-7 overflow-hidden">
        <div className="border-b border-[#e2e6eb] px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><UsersRound className="size-4 text-[#0f67d8]" /> 対戦カードを作成</h2>
          <p className="mt-1 text-[10px] text-[#7d8795]">登録済み {players.length}人から選択</p>
        </div>
        <div className="p-5 sm:p-6">
          <ComparisonLauncher players={players} initialLeftOsuId={requestedLeft} initialMode={mode} />
        </div>
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          ["成長推移", "総PPと順位の保存履歴を同じ時間軸で比較"],
          ["スキル対戦", "Aim・速度・精密性・認識力・持久力を比較"],
          ["共通譜面", "同じBeatmapのPP・精度・Pulse Indexを直接比較"],
        ].map(([title, detail]) => <article key={title} className="rounded-lg border border-[#dfe4ea] bg-white p-4"><h2 className="text-xs font-semibold text-[#303947]">{title}</h2><p className="mt-1 text-[10px] leading-5 text-[#7d8795]">{detail}</p></article>)}
      </section>
    </main>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import useSWR from "swr";
import { liveRequestOptions, requestJson } from "@/lib/client/request-json";

type OverlayData = {
  generatedAt: string;
  score: null | {
    id: string;
    osuScoreId: string;
    username: string;
    avatarUrl: string | null;
    artist: string;
    title: string;
    difficulty: string;
    coverUrl: string | null;
    pp: number | null;
    accuracy: number;
    rank: string;
    maxCombo: number | null;
    mods: string[];
    endedAt: string;
  };
};

export function ObsScoreOverlay({ token, initial }: { token: string; initial: OverlayData }) {
  const { data = initial } = useSWR<OverlayData>(`/api/overlay/${encodeURIComponent(token)}`, requestJson, {
    ...liveRequestOptions,
    fallbackData: initial,
    refreshInterval: 5_000,
    // An OBS browser source must keep updating even when its window is hidden.
    refreshWhenHidden: true,
  });
  const previousId = useRef(initial.score?.id);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    const id = data.score?.id;
    if (!id || id === previousId.current) return;
    previousId.current = id;
    const start = window.setTimeout(() => setFresh(true), 0);
    const end = window.setTimeout(() => setFresh(false), 1_200);
    return () => { window.clearTimeout(start); window.clearTimeout(end); };
  }, [data.score?.id]);
  const score = data.score;
  if (!score) return <main className="grid min-h-screen place-items-end bg-transparent p-8"><div className="rounded-xl border border-white/20 bg-black/75 px-5 py-4 text-sm text-white shadow-2xl backdrop-blur">osu! Pulse · リザルト待機中</div></main>;
  const rankColor = score.rank.startsWith("X") ? "#f8d36a" : score.rank.startsWith("S") ? "#ffd84c" : score.rank === "A" ? "#5ce39a" : "#72adff";
  return <main className="flex min-h-screen items-end bg-transparent p-8"><article className={`relative w-[720px] overflow-hidden rounded-2xl border border-white/20 bg-[#0c1220]/90 text-white shadow-2xl backdrop-blur-xl transition duration-700 ${fresh?"scale-[1.03] ring-4 ring-[#f48120]/70":""}`}>
    {score.coverUrl?<Image src={score.coverUrl} alt="" fill sizes="720px" unoptimized className="object-cover opacity-20"/>:null}<div className="relative flex items-center gap-5 p-6">{score.avatarUrl?<Image src={score.avatarUrl} alt="" width={80} height={80} unoptimized className="size-20 rounded-xl border border-white/25 object-cover"/>:null}<div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-mono text-4xl font-bold" style={{color:rankColor}}>{score.rank}</span><div><p className="font-semibold">{score.username}</p><p className="font-mono text-xs text-white/55">{score.mods.length?`+${score.mods.join("")}`:"NM"}</p></div></div><h1 className="mt-3 truncate text-lg font-semibold">{score.artist} — {score.title}</h1><p className="mt-1 truncate text-xs text-white/60">[{score.difficulty}]</p></div><div className="grid min-w-44 grid-cols-2 gap-4 text-right"><div><p className="font-mono text-2xl font-bold">{score.pp?.toFixed(1)??"—"}</p><p className="text-[9px] uppercase text-white/45">PP</p></div><div><p className="font-mono text-2xl font-bold">{(score.accuracy*100).toFixed(2)}%</p><p className="text-[9px] uppercase text-white/45">Accuracy</p></div><div className="col-span-2"><p className="font-mono text-lg font-bold">{score.maxCombo??"—"}x</p><p className="text-[9px] uppercase text-white/45">Combo</p></div></div></div>
  </article></main>;
}

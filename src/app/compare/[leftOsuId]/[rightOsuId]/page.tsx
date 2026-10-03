import { ArrowRightLeft, Crosshair, ExternalLink, Swords, Target, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatNumber, formatRank } from "@/lib/format";
import { isOsuMode, MODE_ACCENTS, MODE_LABELS, OSU_MODES } from "@/lib/osu/modes";
import { calculatePulseHistory, calculatePulseIndex } from "@/lib/osu/pulse-index";
import { calculateSkillProfile, skillLabels, type SkillProfile } from "@/lib/osu/skill-profile";
import { getPublicProfile, type PublicProfile } from "@/lib/public-profile";

type Props = { params: Promise<{ leftOsuId: string; rightOsuId: string }>; searchParams: Promise<{ mode?: string }> };

async function profiles(props: Props) {
  const [{ leftOsuId, rightOsuId }, query] = await Promise.all([props.params, props.searchParams]);
  if (!/^\d{1,10}$/.test(leftOsuId) || !/^\d{1,10}$/.test(rightOsuId)) return null;
  const mode = isOsuMode(query.mode) ? query.mode : "osu";
  const [left, right] = await Promise.all([getPublicProfile(Number(leftOsuId), mode), getPublicProfile(Number(rightOsuId), mode)]);
  return left && right ? { left, right, mode } : null;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const data = await profiles(props);
  return data ? { title: `${data.left.account.username} vs ${data.right.account.username}`, description: `${MODE_LABELS[data.mode]}の公開成長比較` } : { title: "Comparison not found" };
}

function GrowthChart({ left, right }: { left: PublicProfile; right: PublicProfile }) {
  const dates = [...new Set([...left.snapshots, ...right.snapshots].map((item) => item.date))].sort();
  if (dates.length < 2) return <p className="grid h-72 place-items-center text-xs text-[#8a94a3]">比較できる履歴がまだありません。</p>;
  const values = [...left.snapshots, ...right.snapshots].map((item) => item.pp);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const points = (profile: PublicProfile) => {
    const map = new Map(profile.snapshots.map((item) => [item.date, item.pp]));
    let last: number | null = null;
    return dates.flatMap((date, index) => {
      const current = map.get(date) ?? last;
      if (current === null) return [];
      last = current;
      return [`${40 + index / (dates.length - 1) * 920},${280 - (current - min) / range * 230}`];
    }).join(" ");
  };
  return <svg viewBox="0 0 1000 320" role="img" aria-label="PP成長比較グラフ" className="h-auto w-full">
    {[0,1,2,3,4].map((index)=><line key={index} x1="40" y1={50+index*57.5} x2="960" y2={50+index*57.5} stroke="#e4e8ed" strokeDasharray="4 5" />)}
    <polyline points={points(left)} fill="none" stroke="#0f67d8" strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" />
    <polyline points={points(right)} fill="none" stroke="#f48120" strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" />
    <text x="40" y="310" fontSize="20" fill="#7d8795">{dates[0]}</text><text x="960" y="310" textAnchor="end" fontSize="20" fill="#7d8795">{dates.at(-1)}</text>
  </svg>;
}

function playerAnalysis(profile: PublicProfile) {
  const history = calculatePulseHistory(profile.scores, profile.snapshots, profile.mode);
  const latest = history.at(-1) ?? null;
  const lastTime = profile.scores.length ? Math.max(...profile.scores.map((score) => new Date(score.endedAt).getTime())) : Date.now();
  const recentScores = profile.scores.filter((score) => new Date(score.endedAt).getTime() >= lastTime - 30 * 86_400_000);
  return {
    history,
    latest,
    skills: calculateSkillProfile(recentScores.length ? recentScores : profile.scores, profile.mode),
    activeDays: new Set(recentScores.map((score) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(score.endedAt)))).size,
    plays: recentScores.length,
  };
}

function SkillRadar({ left, right, leftName, rightName, mode }: { left: SkillProfile; right: SkillProfile; leftName: string; rightName: string; mode: PublicProfile["mode"] }) {
  const labels = skillLabels(mode);
  const axes = [
    ["aim", labels.aim], ["speed", labels.speed], ["precision", labels.precision], ["reading", labels.reading], ["endurance", labels.endurance],
  ] as const;
  const center = 210;
  const radius = 142;
  const point = (index: number, value: number) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / axes.length;
    const length = radius * value / 100;
    return [center + Math.cos(angle) * length, center + Math.sin(angle) * length] as const;
  };
  const polygon = (profile: SkillProfile) => axes.map(([key], index) => point(index, profile[key]).join(",")).join(" ");
  return <svg viewBox="0 0 420 420" role="img" aria-label={`${leftName}と${rightName}のスキル比較`} className="mx-auto h-auto w-full max-w-[470px]">
    {[20,40,60,80,100].map((level) => <polygon key={level} points={axes.map((_, index) => point(index, level).join(",")).join(" ")} fill={level === 100 ? "#f8fafc" : "none"} stroke="#dfe5eb" strokeWidth="1" />)}
    {axes.map(([, label], index) => { const [x, y] = point(index, 112); return <g key={label}><line x1={center} y1={center} x2={point(index, 100)[0]} y2={point(index, 100)[1]} stroke="#e2e7ed" /><text x={x} y={y} textAnchor={x < center - 10 ? "end" : x > center + 10 ? "start" : "middle"} dominantBaseline="middle" fontSize="12" fontWeight="600" fill="#536071">{label}</text></g>; })}
    <polygon points={polygon(left)} fill="#0f67d8" fillOpacity="0.16" stroke="#0f67d8" strokeWidth="3" />
    <polygon points={polygon(right)} fill="#f48120" fillOpacity="0.14" stroke="#f48120" strokeWidth="3" />
    {axes.flatMap(([key], index) => [<circle key={`l-${key}`} cx={point(index, left[key])[0]} cy={point(index, left[key])[1]} r="4" fill="#0f67d8" />, <circle key={`r-${key}`} cx={point(index, right[key])[0]} cy={point(index, right[key])[1]} r="4" fill="#f48120" />])}
  </svg>;
}

function commonBeatmaps(left: PublicProfile, right: PublicProfile) {
  const best = (profile: PublicProfile) => {
    const rows = new Map<number, PublicProfile["scores"][number]>();
    for (const score of profile.scores) {
      const current = rows.get(score.beatmapId);
      if (!current || calculatePulseIndex(score, profile.mode).total > calculatePulseIndex(current, profile.mode).total) rows.set(score.beatmapId, score);
    }
    return rows;
  };
  const leftBest = best(left);
  const rightBest = best(right);
  return [...leftBest.entries()].flatMap(([beatmapId, leftScore]) => {
    const rightScore = rightBest.get(beatmapId);
    if (!rightScore) return [];
    const leftPulse = calculatePulseIndex(leftScore, left.mode).total;
    const rightPulse = calculatePulseIndex(rightScore, right.mode).total;
    const leftSkill = calculateSkillProfile([leftScore], left.mode);
    const rightSkill = calculateSkillProfile([rightScore], right.mode);
    return [{ beatmapId, leftScore, rightScore, leftPulse, rightPulse, leftSkill, rightSkill }];
  }).sort((a, b) => Math.max(b.leftPulse, b.rightPulse) - Math.max(a.leftPulse, a.rightPulse));
}

function PlayerCard({ profile, color, analysis }: { profile: PublicProfile; color: string; analysis: ReturnType<typeof playerAnalysis> }) {
  return <article className="cp-panel p-5"><div className="flex items-center gap-3">{profile.account.avatarUrl?<Image src={profile.account.avatarUrl} alt="" width={64} height={64} className="size-14 rounded-xl object-cover"/>:<div className="size-14 rounded-xl bg-slate-100"/>}<div className="min-w-0"><h2 className="truncate text-lg font-semibold">{profile.account.username}</h2><a href={`https://osu.ppy.sh/users/${profile.account.osuUserId}/${profile.mode}`} className="mt-1 inline-flex items-center gap-1 text-[10px] text-[#0051c3]">osu! profile <ExternalLink className="size-3"/></a></div><div className="ml-auto text-right"><p className="text-[9px] uppercase text-[#8992a0]">Pulse</p><p className="font-mono text-2xl font-bold" style={{color}}>{analysis.latest?.rollingIndex.toFixed(2) ?? "—"}</p></div></div><div className="mt-5 grid grid-cols-3 gap-3"><div><p className="text-[9px] uppercase text-[#8992a0]">PP</p><p className="mt-1 font-mono text-sm font-semibold" style={{color}}>{formatNumber(profile.latest?.pp,1)}</p></div><div><p className="text-[9px] uppercase text-[#8992a0]">Rank</p><p className="mt-1 font-mono text-sm font-semibold">{formatRank(profile.latest?.globalRank)}</p></div><div><p className="text-[9px] uppercase text-[#8992a0]">30d activity</p><p className="mt-1 font-mono text-sm font-semibold">{analysis.activeDays}日 · {analysis.plays}回</p></div></div><div className="mt-4 flex items-center justify-between rounded-md bg-[#f6f8fa] px-3 py-2 text-[10px]"><span className="text-[#758092]">DB期間内成長</span><strong className={analysis.latest?.growthRate && analysis.latest.growthRate < 0 ? "text-red-600" : "text-emerald-600"}>{analysis.latest?.growthRate === null || analysis.latest?.growthRate === undefined ? "—" : `${analysis.latest.growthRate >= 0 ? "+" : ""}${analysis.latest.growthRate.toFixed(2)}%`}</strong></div></article>;
}

export default async function ComparePage(props: Props) {
  const data = await profiles(props);
  if (!data) notFound();
  const pair = [data.left, data.right];
  const leftAnalysis = playerAnalysis(data.left);
  const rightAnalysis = playerAnalysis(data.right);
  const shared = commonBeatmaps(data.left, data.right);
  const labels = skillLabels(data.mode);
  const skills = [["aim", labels.aim], ["speed", labels.speed], ["precision", labels.precision], ["reading", labels.reading], ["endurance", labels.endurance]] as const;
  return <main className="mx-auto min-h-screen max-w-6xl px-4 py-10 sm:px-7">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#f48120]">Public comparison</p><h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold tracking-[-0.04em]">{data.left.account.username}<ArrowRightLeft className="size-6 text-[#8a94a3]"/>{data.right.account.username}</h1><p className="mt-2 text-sm text-[#697386]">{MODE_LABELS[data.mode]} · DB保存履歴の比較</p></div><div className="flex items-center gap-4"><Link href={`/compare?left=${data.left.account.osuUserId}&mode=${data.mode}`} className="text-xs font-semibold text-[#0051c3]">相手を変更</Link><Link href="/status" className="text-xs font-semibold text-[#0051c3]">Service Status</Link></div></header>
    <nav className="mt-6 flex gap-1 overflow-x-auto rounded-lg border bg-white p-1">{OSU_MODES.map((mode)=><Link key={mode} href={`/compare/${data.left.account.osuUserId}/${data.right.account.osuUserId}?mode=${mode}`} className={`rounded-md px-4 py-2 text-xs font-semibold ${mode===data.mode?"text-white":"text-[#667184] hover:bg-[#f4f6f8]"}`} style={mode===data.mode?{background:MODE_ACCENTS[mode]}:undefined}>{MODE_LABELS[mode]}</Link>)}</nav>
    <section className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-center"><PlayerCard profile={data.left} color="#0f67d8" analysis={leftAnalysis}/><span className="hidden size-11 place-items-center rounded-full border bg-white font-mono text-xs font-bold text-[#8a94a3] lg:grid">VS</span><PlayerCard profile={data.right} color="#f48120" analysis={rightAnalysis}/></section>
    {leftAnalysis.skills && rightAnalysis.skills ? <section className="cp-panel mt-5 overflow-hidden"><div className="border-b px-5 py-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><Crosshair className="size-4 text-[#8c7cff]"/>スキル対戦</h2><p className="mt-1 text-[10px] text-[#7d8795]">直近30日の上位30プレイ · 青 {data.left.account.username} · 橙 {data.right.account.username}</p></div><div className="grid items-center gap-5 p-5 lg:grid-cols-[1.05fr_.95fr]"><SkillRadar left={leftAnalysis.skills} right={rightAnalysis.skills} leftName={data.left.account.username} rightName={data.right.account.username} mode={data.mode}/><div className="space-y-2">{skills.map(([key,label])=>{const left=leftAnalysis.skills![key];const right=rightAnalysis.skills![key];const leftWins=left>right;return <div key={key} className="grid grid-cols-[1fr_86px_1fr] items-center gap-2 rounded-lg border border-[#e1e6ec] p-3"><div className={`font-mono text-right text-sm font-semibold ${leftWins?"text-[#0f67d8]":"text-[#778294]"}`}>{left.toFixed(1)}</div><div className="text-center"><p className="text-[9px] font-semibold text-[#536071]">{label}</p><p className="mt-0.5 text-[8px] text-[#9aa2ad]">差 {Math.abs(left-right).toFixed(1)}</p></div><div className={`font-mono text-sm font-semibold ${!leftWins&&right!==left?"text-[#f48120]":"text-[#778294]"}`}>{right.toFixed(1)}</div></div>})}<p className="pt-2 text-[8px] leading-4 text-[#929aa6]">osu!では公式Aim/Speed難度を使用。未取得の過去譜面は★・AR・CS・OD・BPMから推定します。成果指数は譜面要求値に精度・PP・コンボ・判定を組み合わせた独自指標です。</p></div></div></section> : null}
    <section className="cp-panel mt-5 overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><Trophy className="size-4 text-[#f48120]"/>PP成長推移</h2><p className="mt-1 text-[10px] text-[#7d8795]">青 {data.left.account.username} · 橙 {data.right.account.username}</p></div><Target className="size-4 text-[#7d8795]"/></div><div className="p-4"><GrowthChart left={data.left} right={data.right}/></div></section>
    <section className="cp-panel mt-5 overflow-hidden"><div className="border-b px-5 py-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><Swords className="size-4 text-[#f48120]"/>共通譜面 Head-to-Head</h2><p className="mt-1 text-[10px] text-[#7d8795]">両者がプレイした同じBeatmapのベスト保存結果を直接比較 · {shared.length}譜面</p></div><div className="max-h-[520px] overflow-auto"><table className="w-full min-w-[860px] text-left text-[10px]"><thead className="sticky top-0 bg-[#fafbfc] text-[8px] uppercase text-[#7d8795]"><tr><th className="px-5 py-3">Beatmap</th><th className="px-3 py-3 text-right">{data.left.account.username}</th><th className="px-3 py-3 text-center">Winner</th><th className="px-3 py-3 text-left">{data.right.account.username}</th><th className="px-5 py-3 text-right">{labels.aim}</th></tr></thead><tbody className="divide-y divide-[#e8ebef]">{shared.slice(0,50).map((row)=>{const leftWins=row.leftPulse>row.rightPulse;const tied=Math.abs(row.leftPulse-row.rightPulse)<0.01;return <tr key={row.beatmapId} className="hover:bg-[#fbfcfd]"><td className="max-w-[330px] px-5 py-3"><a href={`https://osu.ppy.sh/beatmaps/${row.beatmapId}`} target="_blank" rel="noreferrer" className="block truncate font-semibold text-[#26303d] hover:text-[#0051c3]">{row.leftScore.artist} — {row.leftScore.title} [{row.leftScore.difficulty}]</a><p className="mt-0.5 text-[8px] text-[#8a94a3]">{row.leftScore.starRating?.toFixed(2) ?? "—"}★ · {row.leftScore.bpm?.toFixed(0) ?? "—"} BPM</p></td><td className={`px-3 py-3 text-right font-mono ${leftWins?"font-bold text-[#0f67d8]":""}`}>{row.leftPulse.toFixed(2)}<br/><span className="text-[8px] text-[#8791a0]">{row.leftScore.pp?.toFixed(1)??"—"}pp · {(row.leftScore.accuracy*100).toFixed(2)}%</span></td><td className="px-3 py-3 text-center"><span className={`rounded-full px-2 py-1 text-[8px] font-bold ${tied?"bg-slate-100 text-slate-600":leftWins?"bg-blue-50 text-blue-700":"bg-orange-50 text-orange-700"}`}>{tied?"DRAW":leftWins?data.left.account.username:data.right.account.username}</span></td><td className={`px-3 py-3 font-mono ${!leftWins&&!tied?"font-bold text-[#f48120]":""}`}>{row.rightPulse.toFixed(2)}<br/><span className="text-[8px] text-[#8791a0]">{row.rightScore.pp?.toFixed(1)??"—"}pp · {(row.rightScore.accuracy*100).toFixed(2)}%</span></td><td className="px-5 py-3 text-right font-mono">{row.leftSkill?.aim.toFixed(1)??"—"} / {row.rightSkill?.aim.toFixed(1)??"—"}</td></tr>})}{!shared.length?<tr><td colSpan={5} className="px-5 py-12 text-center text-[#8a94a3]">共通して保存された譜面がまだありません。</td></tr>:null}</tbody></table></div></section>
    <section className="mt-5 grid gap-5 lg:grid-cols-2">{pair.map((profile)=><div key={profile.account.id} className="cp-panel overflow-hidden"><div className="border-b px-5 py-4"><h2 className="text-sm font-semibold">{profile.account.username} · recent</h2></div><div className="divide-y">{profile.scores.slice(0,8).map((score)=><a key={score.id} href={`https://osu.ppy.sh/scores/${score.osuScoreId}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-5 py-3 hover:bg-[#fafbfc]"><span className={`grid size-8 place-items-center rounded font-mono text-[10px] font-bold ${score.rank==="A"?"bg-emerald-50 text-emerald-700":score.rank.includes("S")||score.rank.includes("X")?"bg-amber-50 text-amber-700":"bg-blue-50 text-blue-700"}`}>{score.rank}</span><span className="min-w-0 flex-1 truncate text-xs">{score.artist} — {score.title}</span><span className="font-mono text-[10px] font-semibold">{score.pp?.toFixed(1)??"—"}pp</span></a>)}</div></div>)}</section>
  </main>;
}

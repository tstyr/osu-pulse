import {
  Activity,
  ArrowDown,
  ArrowUp,
  BellRing,
  Bot,
  Check,
  ChevronRight,
  Clock3,
  Crown,
  Disc3,
  Flame,
  Gamepad2,
  Headphones,
  Medal,
  Radio,
  Sparkles,
  Target,
  TimerReset,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import {
  formatAccuracy,
  formatNumber,
  formatRank,
  formatScoreAccuracy,
  formatSigned,
} from "@/lib/format";
import {
  MODE_ACCENTS,
  MODE_LABELS,
  OSU_MODES,
  type OsuMode,
} from "@/lib/osu/modes";

import { GrowthChart } from "./growth-chart";

type DashboardProfile = {
  osuUserId: number;
  username: string;
  countryCode: string | null;
  avatarUrl: string | null;
};

type DashboardStats = {
  pp: number;
  globalRank: number | null;
  countryRank: number | null;
  accuracy: number;
  playCount: number;
  level?: number;
};

type DashboardPlay = {
  id: string;
  rank: string;
  artist: string;
  title: string;
  difficulty: string;
  pp: number | null;
  accuracy: number;
  maxCombo: number | null;
  mods: string[];
  endedAt: Date;
};

type GrowthPoint = {
  date: string;
  pp: number;
  rank?: number | null;
};

export type ProfileDashboardProps = {
  profile: DashboardProfile;
  mode: OsuMode;
  stats: DashboardStats;
  previous?: DashboardStats | null;
  growth: GrowthPoint[];
  recent: DashboardPlay[];
  modeScoreCounts?: Partial<Record<OsuMode, number>>;
  profileHref: string;
  demo?: boolean;
};

function ChangeBadge({ value, inverse = false }: { value: number; inverse?: boolean }) {
  const positive = inverse ? value < 0 : value > 0;
  const Icon = value < 0 ? ArrowDown : ArrowUp;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
        positive ? "bg-emerald-400/10 text-emerald-300" : "bg-rose-400/10 text-rose-300"
      }`}
    >
      <Icon className="size-2.5" />
      {formatNumber(Math.abs(value))}
    </span>
  );
}

function ModeTabs({ mode, href }: { mode: OsuMode; href: string }) {
  return (
    <div className="inline-flex rounded-xl border border-white/[0.065] bg-black/20 p-1">
      {OSU_MODES.map((item) => {
        const active = item === mode;
        return (
          <Link
            key={item}
            href={`${href}?mode=${item}`}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition sm:px-4 ${
              active
                ? "bg-white/[0.095] text-white shadow-sm"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {MODE_LABELS[item]}
          </Link>
        );
      })}
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
  change,
  inverse,
  icon: Icon,
}: {
  label: string;
  value: string;
  note: string;
  change?: number;
  inverse?: boolean;
  icon: typeof TrendingUp;
}) {
  return (
    <div className="metric-card group">
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-medium text-zinc-500">{label}</span>
        <span className="grid size-7 place-items-center rounded-lg border border-white/[0.06] bg-white/[0.025] text-zinc-600 transition group-hover:border-pink-300/15 group-hover:text-pink-300">
          <Icon className="size-3.5" />
        </span>
      </div>
      <div className="mt-5 flex items-end gap-2">
        <strong className="font-mono text-[24px] font-medium tracking-[-0.05em] text-white">
          {value}
        </strong>
        {change !== undefined && change !== 0 ? (
          <ChangeBadge value={change} inverse={inverse} />
        ) : null}
      </div>
      <p className="mt-1 text-[10px] text-zinc-600">{note}</p>
    </div>
  );
}

function RankMark({ rank }: { rank: string }) {
  const palette: Record<string, string> = {
    SS: "border-yellow-200/20 bg-yellow-200/10 text-yellow-100",
    SSH: "border-slate-200/20 bg-slate-200/10 text-white",
    S: "border-yellow-300/20 bg-yellow-300/10 text-yellow-200",
    SH: "border-slate-200/20 bg-slate-200/10 text-white",
    A: "border-emerald-300/20 bg-emerald-300/10 text-emerald-200",
    B: "border-sky-300/20 bg-sky-300/10 text-sky-200",
    F: "border-rose-300/20 bg-rose-300/10 text-rose-200",
  };

  return (
    <span
      className={`grid size-9 shrink-0 place-items-center rounded-xl border font-mono text-xs font-semibold ${
        palette[rank] ?? palette.B
      }`}
    >
      {rank}
    </span>
  );
}

export function ProfileDashboard({
  profile,
  mode,
  stats,
  previous,
  growth,
  recent,
  modeScoreCounts = {},
  profileHref,
  demo = false,
}: ProfileDashboardProps) {
  const accent = MODE_ACCENTS[mode];
  const ppChange = previous ? stats.pp - previous.pp : 0;
  const rankChange = previous?.globalRank && stats.globalRank
    ? stats.globalRank - previous.globalRank
    : 0;
  const playChange = previous ? stats.playCount - previous.playCount : 0;
  const accuracyChange = previous ? stats.accuracy - previous.accuracy : 0;

  return (
    <main className="mx-auto w-full max-w-[1480px] px-4 py-5 sm:px-7 sm:py-7">
      {demo ? (
        <div className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-pink-300/10 bg-pink-300/[0.045] px-4 py-2.5 text-[11px] text-pink-100/70">
          <span className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-pink-300" />
            デモデータを表示中。Discordで <code className="font-mono text-pink-200">/osu link</code> を実行すると自分のページが作成されます。
          </span>
          <Link href="/docs" className="hidden font-medium text-pink-200 hover:text-white sm:block">
            3分でセットアップ →
          </Link>
        </div>
      ) : null}

      <section className="surface relative overflow-hidden p-5 sm:p-6">
        <div
          className="pointer-events-none absolute -right-24 -top-36 size-96 rounded-full opacity-[0.09] blur-3xl"
          style={{ background: accent }}
        />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-4 sm:gap-5">
            <div className="relative grid size-[70px] shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-pink-300/25 via-violet-400/10 to-transparent shadow-[0_18px_60px_rgba(0,0,0,.35)] sm:size-20">
              {profile.avatarUrl ? (
                <Image
                  src={profile.avatarUrl}
                  alt={`${profile.username} avatar`}
                  fill
                  sizes="80px"
                  className="object-cover"
                  priority
                />
              ) : (
                <span className="text-2xl font-medium text-pink-100">
                  {profile.username.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="absolute bottom-1.5 right-1.5 size-2.5 rounded-full border-2 border-[#16161e] bg-emerald-400" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-medium tracking-[-0.045em] text-white sm:text-[30px]">
                  {profile.username}
                </h1>
                <span className="rounded-md border border-white/[0.07] bg-white/[0.035] px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">
                  {profile.countryCode ?? "--"}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <Gamepad2 className="size-3" /> {MODE_LABELS[mode]}
                </span>
                <span className="flex items-center gap-1.5">
                  <Radio className="size-3 text-emerald-400" /> リアルタイム追跡中
                </span>
                <a
                  href={`https://osu.ppy.sh/users/${profile.osuUserId}/${mode}`}
                  target="_blank"
                  rel="noreferrer"
                  className="transition hover:text-white"
                >
                  osu! profile ↗
                </a>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <ModeTabs mode={mode} href={profileHref} />
            <button className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/[0.075] bg-white/[0.035] px-3 text-[11px] font-medium text-zinc-300 transition hover:bg-white/[0.07]">
              <BellRing className="size-3.5 text-pink-300" /> 通知設定
            </button>
          </div>
        </div>
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Performance"
          value={`${formatNumber(stats.pp, 0)} pp`}
          note="前日のスナップショット比"
          change={Math.round(ppChange)}
          icon={Zap}
        />
        <MetricCard
          label="Global rank"
          value={formatRank(stats.globalRank)}
          note={`国内 ${formatRank(stats.countryRank)}`}
          change={rankChange}
          inverse
          icon={Crown}
        />
        <MetricCard
          label="Accuracy"
          value={formatAccuracy(stats.accuracy)}
          note={formatSigned(accuracyChange, "%")}
          icon={Target}
        />
        <MetricCard
          label="Play count"
          value={formatNumber(stats.playCount)}
          note={`今日 ${formatSigned(playChange)} plays`}
          change={playChange}
          icon={Activity}
        />
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(310px,.72fr)]">
        <section className="surface overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-4 sm:px-6">
            <div>
              <div className="flex items-center gap-2">
                <TrendingUp className="size-4" style={{ color: accent }} />
                <h2 className="text-sm font-medium text-white">成長曲線</h2>
              </div>
              <p className="mt-1 text-[10px] text-zinc-600">Performance points · 直近28日</p>
            </div>
            <div className="flex items-center gap-5">
              <div className="text-right">
                <p className="font-mono text-[10px] text-zinc-600">28D GAIN</p>
                <p className="mt-0.5 font-mono text-sm text-emerald-300">
                  +{formatNumber(growth.at(-1)?.pp && growth[0]?.pp ? growth.at(-1)!.pp - growth[0].pp : 0, 0)} pp
                </p>
              </div>
              <div className="hidden h-8 w-px bg-white/[0.06] sm:block" />
              <div className="hidden text-right sm:block">
                <p className="font-mono text-[10px] text-zinc-600">TREND</p>
                <p className="mt-0.5 flex items-center gap-1 font-mono text-sm text-white">
                  <Flame className="size-3.5 text-orange-300" /> +3.2%
                </p>
              </div>
            </div>
          </div>
          <div className="px-2 pb-1 pt-3 sm:px-4">
            <GrowthChart data={growth} accent={accent} />
          </div>
          <div className="grid grid-cols-2 border-t border-white/[0.06] sm:grid-cols-4">
            {OSU_MODES.map((item) => (
              <Link
                href={`${profileHref}?mode=${item}`}
                key={item}
                className={`flex items-center justify-between border-r border-white/[0.055] px-4 py-3 text-[10px] transition last:border-r-0 hover:bg-white/[0.025] ${
                  item === mode ? "text-white" : "text-zinc-600"
                }`}
              >
                <span>{MODE_LABELS[item]}</span>
                <span className="font-mono">{formatNumber(modeScoreCounts[item] ?? 0)}</span>
              </Link>
            ))}
          </div>
        </section>

        <aside className="surface flex min-h-[390px] flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
            <div>
              <h2 className="text-sm font-medium text-white">Live pipeline</h2>
              <p className="mt-1 text-[10px] text-zinc-600">Bot worker health</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/10 bg-emerald-300/[0.06] px-2 py-1 font-mono text-[9px] text-emerald-300">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-300" /> LIVE
            </span>
          </div>
          <div className="flex-1 p-4">
            <div className="pipeline-line">
              <span className="pipeline-icon bg-pink-300/10 text-pink-300"><Radio className="size-3.5" /></span>
              <div><p>osu! API poll</p><span>45–75秒のジッター</span></div>
              <Check className="ml-auto size-3.5 text-emerald-300" />
            </div>
            <div className="pipeline-line">
              <span className="pipeline-icon bg-violet-300/10 text-violet-300"><Disc3 className="size-3.5" /></span>
              <div><p>Score ingest</p><span>重複排除・4モード</span></div>
              <Check className="ml-auto size-3.5 text-emerald-300" />
            </div>
            <div className="pipeline-line">
              <span className="pipeline-icon bg-sky-300/10 text-sky-300"><Bot className="size-3.5" /></span>
              <div><p>Discord delivery</p><span>設定チャンネルへ即時投稿</span></div>
              <span className="ml-auto font-mono text-[9px] text-zinc-600">~1m</span>
            </div>
            <div className="pipeline-line">
              <span className="pipeline-icon bg-orange-300/10 text-orange-300"><Clock3 className="size-3.5" /></span>
              <div><p>Daily growth DM</p><span>毎日 21:00 JST</span></div>
              <span className="ml-auto font-mono text-[9px] text-zinc-600">12:00Z</span>
            </div>
          </div>
          <div className="m-4 mt-0 rounded-xl border border-white/[0.06] bg-black/20 p-3.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-zinc-500">今月のイベント</span>
              <span className="font-mono text-white">1,482</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.055]">
              <div className="h-full w-[68%] rounded-full bg-gradient-to-r from-pink-400 to-violet-400" />
            </div>
          </div>
        </aside>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,.65fr)]">
        <section className="surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-sm font-medium text-white">最新のプレイ</h2>
              <p className="mt-1 text-[10px] text-zinc-600">新しいリザルトはDiscordへ自動送信</p>
            </div>
            <Link href={`${profileHref}?mode=${mode}`} className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-white">
              すべて表示 <ChevronRight className="size-3" />
            </Link>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {recent.length ? recent.map((play) => (
              <div key={play.id} className="play-row group">
                <RankMark rank={play.rank} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-zinc-200 group-hover:text-white">
                    {play.artist} — {play.title}
                  </p>
                  <p className="mt-1 truncate text-[10px] text-zinc-600">
                    {play.difficulty} · {play.maxCombo ? `${formatNumber(play.maxCombo)}x` : "—"}
                  </p>
                </div>
                <div className="hidden items-center gap-1 sm:flex">
                  {play.mods.length ? play.mods.map((mod) => (
                    <span key={mod} className="rounded bg-violet-300/10 px-1.5 py-1 font-mono text-[8px] text-violet-200">{mod}</span>
                  )) : <span className="font-mono text-[9px] text-zinc-700">NM</span>}
                </div>
                <div className="w-[68px] text-right">
                  <p className="font-mono text-xs text-white">{play.pp ? `${play.pp.toFixed(1)}pp` : "—"}</p>
                  <p className="mt-1 font-mono text-[9px] text-zinc-600">{formatScoreAccuracy(play.accuracy)}</p>
                </div>
              </div>
            )) : (
              <div className="px-6 py-14 text-center text-xs text-zinc-600">まだプレイ履歴がありません。</div>
            )}
          </div>
        </section>

        <section className="surface overflow-hidden" id="setup">
          <div className="border-b border-white/[0.06] px-5 py-4">
            <h2 className="text-sm font-medium text-white">Productivity kit</h2>
            <p className="mt-1 text-[10px] text-zinc-600">Discordだけで集中と予定を管理</p>
          </div>
          <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="feature-row">
              <span className="feature-icon text-pink-300"><TimerReset className="size-4" /></span>
              <div><p>Pomodoro</p><span>/pomodoro start</span></div>
              <span className="ml-auto rounded-md bg-white/[0.045] px-2 py-1 font-mono text-[9px] text-zinc-500">25 · 5</span>
            </div>
            <div className="feature-row">
              <span className="feature-icon text-amber-300"><BellRing className="size-4" /></span>
              <div><p>Reminder</p><span>/remind create</span></div>
              <ChevronRight className="ml-auto size-3.5 text-zinc-700" />
            </div>
            <div className="feature-row">
              <span className="feature-icon text-sky-300"><Headphones className="size-4" /></span>
              <div><p>Lavalink music</p><span>/music play</span></div>
              <span className="ml-auto flex items-center gap-1 font-mono text-[9px] text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-300" /> ready</span>
            </div>
            <div className="feature-row">
              <span className="feature-icon text-emerald-300"><Medal className="size-4" /></span>
              <div><p>Daily digest</p><span>成長を毎日DM</span></div>
              <ChevronRight className="ml-auto size-3.5 text-zinc-700" />
            </div>
          </div>
          <div className="mx-3 mb-3 rounded-xl border border-pink-300/10 bg-gradient-to-r from-pink-300/[0.055] to-violet-300/[0.035] p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-white">
              <Users className="size-3.5 text-pink-300" /> 最初のアカウント登録
            </div>
            <code className="mt-3 block rounded-lg border border-white/[0.06] bg-black/25 px-3 py-2.5 font-mono text-[10px] text-pink-100">
              /osu link username:{profile.username}
            </code>
          </div>
        </section>
      </div>
    </main>
  );
}

"use client";

import { ArrowRight, Swords } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { MODE_LABELS, OSU_MODES, type OsuMode } from "@/lib/osu/modes";

export type ComparisonPlayerOption = {
  osuUserId: number;
  username: string;
};

type ComparisonLauncherProps = {
  players: ComparisonPlayerOption[];
  initialLeftOsuId?: number;
  initialMode?: OsuMode;
  lockLeft?: boolean;
  compact?: boolean;
};

export function ComparisonLauncher({
  players,
  initialLeftOsuId,
  initialMode = "osu",
  lockLeft = false,
  compact = false,
}: ComparisonLauncherProps) {
  const router = useRouter();
  const orderedPlayers = useMemo(
    () => [...players].sort((left, right) => left.username.localeCompare(right.username, "ja")),
    [players],
  );
  const initialLeft = orderedPlayers.some((player) => player.osuUserId === initialLeftOsuId)
    ? initialLeftOsuId!
    : orderedPlayers[0]?.osuUserId ?? 0;
  const [leftOsuId, setLeftOsuId] = useState(initialLeft);
  const [rightOsuId, setRightOsuId] = useState(
    orderedPlayers.find((player) => player.osuUserId !== initialLeft)?.osuUserId ?? 0,
  );
  const [mode, setMode] = useState<OsuMode>(initialMode);
  const opponents = orderedPlayers.filter((player) => player.osuUserId !== leftOsuId);
  const selectedRight = opponents.some((player) => player.osuUserId === rightOsuId)
    ? rightOsuId
    : opponents[0]?.osuUserId ?? 0;
  const ready = Boolean(leftOsuId && selectedRight && leftOsuId !== selectedRight);

  function updateLeft(value: number) {
    setLeftOsuId(value);
    if (value === rightOsuId) {
      setRightOsuId(orderedPlayers.find((player) => player.osuUserId !== value)?.osuUserId ?? 0);
    }
  }

  function openComparison() {
    if (!ready) return;
    router.push(`/compare/${leftOsuId}/${selectedRight}?mode=${mode}`);
  }

  if (orderedPlayers.length < 2) {
    return <p className="text-xs text-[#7d8795]">比較には登録済みプレイヤーが2人以上必要です。</p>;
  }

  return (
    <div className={compact ? "flex flex-wrap items-end gap-2" : "grid gap-4 md:grid-cols-[1fr_auto_1fr_160px_auto] md:items-end"}>
      {!lockLeft ? (
        <label className="grid min-w-0 gap-1.5 text-[10px] font-semibold text-[#667184]">
          プレイヤー1
          <select value={leftOsuId} onChange={(event) => updateLeft(Number(event.target.value))} className="cp-select h-10">
            {orderedPlayers.map((player) => <option key={player.osuUserId} value={player.osuUserId}>{player.username}</option>)}
          </select>
        </label>
      ) : null}
      {!compact && !lockLeft ? <div className="hidden h-10 items-center text-[#9aa3af] md:flex"><Swords className="size-4" /></div> : null}
      <label className={`grid min-w-0 gap-1.5 text-[10px] font-semibold text-[#667184] ${compact ? "min-w-52 flex-1" : ""}`}>
        {lockLeft ? "比較する相手" : "プレイヤー2"}
        <select value={selectedRight} onChange={(event) => setRightOsuId(Number(event.target.value))} className="cp-select h-10">
          {opponents.map((player) => <option key={player.osuUserId} value={player.osuUserId}>{player.username}</option>)}
        </select>
      </label>
      {!lockLeft ? (
        <label className="grid gap-1.5 text-[10px] font-semibold text-[#667184]">
          モード
          <select value={mode} onChange={(event) => setMode(event.target.value as OsuMode)} className="cp-select h-10">
            {OSU_MODES.map((value) => <option key={value} value={value}>{MODE_LABELS[value]}</option>)}
          </select>
        </label>
      ) : null}
      <button type="button" disabled={!ready} onClick={openComparison} className="cp-button-primary h-10 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-45">
        <Swords className="size-4" /> VS比較 <ArrowRight className="size-3.5" />
      </button>
    </div>
  );
}

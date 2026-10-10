import { PermissionFlagsBits } from "discord.js";
import { legacyCommands } from "./commands";

export type PulseOption = {
  type: number; name: string; description: string; required?: boolean;
  min_value?: number; max_value?: number; min_length?: number; max_length?: number;
  choices?: { name: string; value: string | number }[]; channel_types?: number[];
  options?: PulseOption[];
};
export type PulseAction = {
  id: string; root: string; path: string[]; label: string; description: string;
  category: string; access: "general" | "admin" | "operator"; options: PulseOption[];
  confirm: boolean; extra?: string;
};
export const pulseCategories = [
  { id: "osu", label: "osu! · プロフィール・成長・分析" },
  { id: "rival", label: "ライバル・ランキング・比較" },
  { id: "render", label: "レンダリング・動画" },
  { id: "music", label: "音楽・音源・プレイリスト" },
  { id: "tools", label: "リマインダー・集中・便利機能" },
  { id: "community", label: "参加認証・チケット・コミュニティ" },
  { id: "admin", label: "管理者 · サーバー設定・通知・登録" },
  { id: "operator", label: "運用者専用 · ストレージ・ワーカー" },
];
const adminRoots = new Set(["panel", "updates", "setup", "reports", "admin-log", "onboarding", "verify-panel", "track-player", "overlay", "montage", "server-status"]);
function accessFor(root: string, path: string[]): PulseAction["access"] {
  return adminRoots.has(root) || (root === "ticket" && ["setup", "panel"].includes(path[0]))
    || (root === "community" && path[0] !== "status") ? "admin" : "general";
}
function categoryFor(root: string, access: PulseAction["access"]) {
  if (access === "admin") return "admin";
  if (["rival", "leaderboard"].includes(root)) return "rival";
  if (root.startsWith("render")) return "render";
  if (root === "music") return "music";
  if (["osu", "stats", "analysis", "session", "profile-card", "goal"].includes(root)) return "osu";
  if (["verify", "ticket", "community"].includes(root)) return "community";
  return "tools";
}
export function flattenPulseCommands(definitions: readonly unknown[]): PulseAction[] {
  const result: PulseAction[] = [];
  for (const raw of definitions) {
    const command = raw as { name: string; description?: string; options?: PulseOption[] };
    if (!command.description) continue;
    function visit(options: PulseOption[], path: string[], description: string) {
      const nested = options.filter((option) => option.type === 1 || option.type === 2);
      if (nested.length) {
        for (const option of nested) visit(option.options ?? [], [...path, option.name], option.description);
        return;
      }
      const access = accessFor(command.name, path);
      result.push({
        id: [command.name, ...path].join("/"), root: command.name, path,
        label: description, description: `${command.description} · ${[command.name, ...path].join(" › ")}`,
        category: categoryFor(command.name, access), access, options,
        confirm: [command.name, ...path].some((part) => /(?:^|-)(?:delete|remove|clear|cancel|unlink|disable|stop|leave)(?:$|-)/.test(part)),
      });
    }
    visit(command.options ?? [], [], command.description);
  }
  return result;
}
const modeOption: PulseOption = { type: 3, name: "mode", description: "対象モード", choices: [
  { name: "osu!", value: "osu" }, { name: "taiko", value: "taiko" }, { name: "catch", value: "fruits" }, { name: "mania", value: "mania" },
] };
const extraActions = [
  ["521", "stability", "安定性分析 · 精度・PPのばらつき"],
  ["522", "fatigue", "セッション前半・後半のパフォーマンス比較"],
  ["523", "improve", "自己ベスト更新候補の譜面"],
  ["526", "milestones", "初達成・マイルストーン"],
  ["527", "calendar", "毎日のプレイ・PPカレンダー"],
  ["528", "bests", "個人ベスト一覧"],
  ["529", "compare-sessions", "直近2セッションを比較"],
  ["544", "storage", "ストレージ状況・削除候補（確認のみ）"],
  ["546", "workers", "Oracle・PCワーカーの稼働確認"],
].map(([number, extra, label]): PulseAction => ({
  id: `extra/${extra}`, root: "pulse", path: [extra], label, description: `追加機能 ${number}`,
  access: ["storage", "workers"].includes(extra) ? "operator" : "general",
  category: ["storage", "workers"].includes(extra) ? "operator" : "osu",
  options: ["storage", "workers"].includes(extra) ? [] : [modeOption], confirm: false, extra,
}));
export const pulseActions = [...flattenPulseCommands(legacyCommands), ...extraActions];
export type PulseActor = { userId: string; guildId: string | null; permissions: bigint; operator: boolean };
export function canUsePulseAction(action: PulseAction, actor: PulseActor) {
  if (action.access === "operator") return actor.operator;
  if (action.access === "admin") return !!actor.guildId && (actor.permissions & (PermissionFlagsBits.ManageGuild | PermissionFlagsBits.Administrator)) !== BigInt(0);
  return true;
}
export function validatePulseValue(option: PulseOption, value: unknown): string | null {
  if (value == null) return option.required ? `${option.description} は必須です。` : null;
  if (option.type === 3 && (typeof value !== "string" || value.length < (option.min_length ?? 1) || value.length > (option.max_length ?? 6000))) return "文字数が入力範囲外です。";
  if ([4, 10].includes(option.type) && (typeof value !== "number" || !Number.isFinite(value) || option.type === 4 && !Number.isInteger(value)
    || value < (option.min_value ?? -Infinity) || value > (option.max_value ?? Infinity))) return "数値が入力範囲外です。";
  if (option.type === 5 && typeof value !== "boolean") return "オン／オフを選択してください。";
  if ([6, 7, 8, 11].includes(option.type) && (typeof value !== "object" || !("id" in value) || !/^\d+$/.test(String(value.id)))) return "Discordから対象を選び直してください。";
  if (option.type === 7 && option.channel_types?.length && !option.channel_types.includes((value as { type: number }).type)) return "この種類のチャンネルは指定できません。";
  if (option.choices && !option.choices.some((choice) => choice.value === value)) return "用意された選択肢を選んでください。";
  return null;
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  configureGuildAutomationChannels,
  createNotificationRule,
  deleteNotificationRule,
  recordDiscordAnnouncement,
  resolveBotError,
  toggleNotificationRule,
} from "@/db/feature-repository";
import { sendDiscordChannelMessage } from "@/lib/discord/rest";
import { hasControlPanelSession } from "@/lib/control/auth";
import { auditAdminAction } from "@/services/admin-log";
import { backfillRecentScoreNotificationDeliveries } from "@/services/score-notification-delivery";

const announcementSchema = z.object({
  channelId: z.string().regex(/^\d{17,20}$/),
  title: z.string().trim().min(1).max(256),
  message: z.string().trim().min(1).max(4_000),
});

export async function sendControlAnnouncement(formData: FormData) {
  if (!(await hasControlPanelSession())) throw new Error("認証が必要です。");
  const input = announcementSchema.parse({
    channelId: formData.get("channelId"),
    title: formData.get("title"),
    message: formData.get("message"),
  });
  await sendDiscordChannelMessage(input.channelId, {
    embeds: [{ title: input.title, description: input.message, color: 0xf48120, timestamp: new Date().toISOString(), footer: { text: "osu! Pulse announcement" } }],
    allowed_mentions: { parse: [] },
  });
  await recordDiscordAnnouncement(input);
  await auditAdminAction({ source: "web", action: "discord-announcement", summary: `Web UIからチャンネル ${input.channelId} へ告知を送信しました。`, details: { title: input.title, channelId: input.channelId } });
  revalidatePath("/dashboard/operations");
}

export async function resolveControlError(formData: FormData) {
  if (!(await hasControlPanelSession())) throw new Error("認証が必要です。");
  const traceId = z.string().regex(/^[A-F0-9]{10}$/).parse(formData.get("traceId"));
  await resolveBotError(traceId);
  await auditAdminAction({ source: "web", action: "resolve-error", summary: `エラー ${traceId} を対応済みに変更しました。` });
  revalidatePath("/dashboard/operations");
}

const snowflake = z.string().regex(/^\d{17,20}$/);
const uuidOrEmpty = z.union([z.literal(""), z.string().uuid()]);

export async function createControlNotificationRule(formData: FormData) {
  if (!(await hasControlPanelSession())) throw new Error("認証が必要です。");
  const input = z.object({
    guildId: snowflake,
    channelId: snowflake,
    name: z.string().trim().min(1).max(100),
    accountId: uuidOrEmpty,
    minimumPp: z.coerce.number().min(0).max(5_000),
    maximumPp: z.union([z.literal(""), z.coerce.number().min(0).max(5_000)]),
    minimumAccuracy: z.coerce.number().min(0).max(100),
  }).parse({
    guildId: formData.get("guildId"), channelId: formData.get("channelId"), name: formData.get("name"), accountId: formData.get("accountId") ?? "",
    minimumPp: formData.get("minimumPp") ?? 0, maximumPp: formData.get("maximumPp") ?? "", minimumAccuracy: formData.get("minimumAccuracy") ?? 0,
  });
  const modes = formData.getAll("modes").map(String).filter((mode): mode is "osu" | "taiko" | "fruits" | "mania" => ["osu", "taiko", "fruits", "mania"].includes(mode));
  const ranks = formData.getAll("ranks").map(String).filter((rank) => /^(?:XH|X|SH|S|A|B|C|D|F)$/.test(rank));
  if (!modes.length) throw new Error("対象モードを1つ以上選択してください。");
  const requiredMods = [...new Set(String(formData.get("requiredMods") ?? "").toUpperCase().split(/[\s,+]+/).filter((mod) => /^[A-Z0-9]{2,4}$/.test(mod)))];
  const rule = await createNotificationRule({
    guildId: input.guildId,
    channelId: input.channelId,
    name: input.name,
    accountId: input.accountId || null,
    conditions: {
      modes, ranks, minimumPp: input.minimumPp, maximumPp: input.maximumPp === "" ? null : input.maximumPp,
      minimumAccuracy: input.minimumAccuracy, requiredMods,
      personalBestOnly: formData.has("personalBestOnly"), anomalyOnly: formData.has("anomalyOnly"),
    },
    createdBy: "control-panel",
  });
  await backfillRecentScoreNotificationDeliveries();
  await auditAdminAction({ guildId: input.guildId, source: "web", action: "create-notification-rule", summary: `通知ルール「${input.name}」を作成しました。`, details: { ruleId: rule?.id, channelId: input.channelId } });
  revalidatePath("/dashboard/operations");
}

export async function setControlNotificationRuleState(formData: FormData) {
  if (!(await hasControlPanelSession())) throw new Error("認証が必要です。");
  const id = z.string().uuid().parse(formData.get("id"));
  const enabled = formData.get("enabled") === "true";
  await toggleNotificationRule(id, enabled);
  await auditAdminAction({ source: "web", action: "toggle-notification-rule", summary: `通知ルール ${id.slice(0, 8)} を${enabled ? "有効" : "無効"}にしました。` });
  revalidatePath("/dashboard/operations");
}

export async function deleteControlNotificationRule(formData: FormData) {
  if (!(await hasControlPanelSession())) throw new Error("認証が必要です。");
  const id = z.string().uuid().parse(formData.get("id"));
  await deleteNotificationRule(id);
  await auditAdminAction({ source: "web", action: "delete-notification-rule", summary: `通知ルール ${id.slice(0, 8)} を削除しました。` });
  revalidatePath("/dashboard/operations");
}

export async function configureControlAdminChannels(formData: FormData) {
  if (!(await hasControlPanelSession())) throw new Error("認証が必要です。");
  const input = z.object({ guildId: snowflake, auditLogChannelId: snowflake, consoleLogChannelId: snowflake, dailyReportChannelId: snowflake, weeklyAwardsChannelId: snowflake }).parse(Object.fromEntries(formData));
  await configureGuildAutomationChannels(input);
  await auditAdminAction({ guildId: input.guildId, source: "web", action: "configure-admin-channels", summary: "管理ログ・コンソール・定期レポートのチャンネルを更新しました。" });
  revalidatePath("/dashboard/operations");
}

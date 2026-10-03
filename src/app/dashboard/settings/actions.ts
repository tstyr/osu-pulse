"use server";

import { revalidatePath } from "next/cache";

import type { ControlPanelSecretName } from "@/db/schema";
import { hasControlPanelSession } from "@/lib/control/auth";
import { saveControlSettings } from "@/lib/control/settings";
import { auditAdminAction } from "@/services/admin-log";

export type SettingsActionState = {
  ok: boolean;
  message: string;
  savedAt?: string;
} | null;

function checked(formData: FormData, name: string) {
  return formData.has(name);
}

function idList(value: FormDataEntryValue | null, kind: "discord" | "osu") {
  if (typeof value !== "string") return [];
  const ids = value
    .split(/[\s,]+/)
    .map((item) => {
      const trimmed = item.trim();
      if (kind === "osu") return trimmed.match(/(?:osu\.ppy\.sh\/users\/)?(\d{1,10})(?:\/.*)?$/i)?.[1];
      return /^\d{17,20}$/.test(trimmed) ? trimmed : undefined;
    })
    .filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

export async function saveSettings(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  if (!(await hasControlPanelSession())) return { ok: false, message: "セッションが切れました。再ログインしてください。" };
  const input = {
    renderDefaults: {
      resolution: formData.get("resolution"),
      fps: formData.get("fps"),
      speed: formData.get("speed"),
      motionBlur: checked(formData, "motionBlur"),
    },
    renderer: {
      maxConcurrentRenders: formData.get("maxConcurrentRenders"),
      renderTimeoutSeconds: formData.get("renderTimeoutSeconds"),
      outputRetentionHours: formData.get("outputRetentionHours"),
      videoEncoder: formData.get("videoEncoder"),
      autoDownloadBeatmaps: checked(formData, "autoDownloadBeatmaps"),
      beatmapDownloadNoVideo: checked(formData, "beatmapDownloadNoVideo"),
      videoCompress: checked(formData, "videoCompress"),
      videoCompressQuality: formData.get("videoCompressQuality"),
      videoCompressAudioKbps: formData.get("videoCompressAudioKbps"),
      watermarkEnabled: checked(formData, "watermarkEnabled"),
      watermarkText: formData.get("watermarkText"),
      watermarkPosition: formData.get("watermarkPosition"),
      storageRetentionHours: formData.get("storageRetentionHours"),
      scheduleEnabled: checked(formData, "renderScheduleEnabled"),
      allowedStartTime: formData.get("renderAllowedStartTime"),
      allowedEndTime: formData.get("renderAllowedEndTime"),
      idleOnly: checked(formData, "renderIdleOnly"),
      idleMinutes: formData.get("renderIdleMinutes"),
    },
    appearance: {
      maniaScrollSpeed: formData.get("maniaScrollSpeed"),
      maniaJudgmentScale: formData.get("maniaJudgmentScale"),
      maniaScoreScale: formData.get("maniaScoreScale"),
      maniaComboScale: formData.get("maniaComboScale"),
      standardBackgroundParallax: checked(formData, "standardBackgroundParallax"),
      standardKeyOverlay: checked(formData, "standardKeyOverlay"),
      standardKeyOverlayScale: formData.get("standardKeyOverlayScale"),
    },
    youtube: {
      autoUpload: checked(formData, "youtubeAutoUpload"),
      privacyStatus: formData.get("youtubePrivacyStatus"),
      deleteAfterUpload: checked(formData, "youtubeDeleteAfterUpload"),
      categoryId: formData.get("youtubeCategoryId"),
      titleTemplate: formData.get("youtubeTitleTemplate"),
      descriptionTemplate: formData.get("youtubeDescriptionTemplate"),
      tags: String(formData.get("youtubeTags") ?? "").split(/[,\n]+/).map((value) => value.trim()).filter(Boolean),
      playlistIds: {
        x: formData.get("youtubePlaylistX"),
        s: formData.get("youtubePlaylistS"),
        a: formData.get("youtubePlaylistA"),
        pp100: formData.get("youtubePlaylistPp100"),
        pp200: formData.get("youtubePlaylistPp200"),
        pp300: formData.get("youtubePlaylistPp300"),
        pp400: formData.get("youtubePlaylistPp400"),
      },
    },
    storage: {
      r2Endpoint: formData.get("r2Endpoint"),
      r2Bucket: formData.get("r2Bucket"),
    },
    autoRender: {
      enabled: checked(formData, "autoRenderEnabled"),
      personalBestOnly: checked(formData, "autoRenderPersonalBestOnly"),
      discordUserIds: idList(formData.get("autoRenderDiscordUserIds"), "discord"),
      osuUserIds: idList(formData.get("autoRenderOsuUserIds"), "osu"),
      ranks: formData.getAll("autoRenderRanks"),
      modes: formData.getAll("autoRenderModes"),
      minimumPp: formData.get("autoRenderMinimumPp"),
      minimumAccuracy: formData.get("autoRenderMinimumAccuracy"),
      resolution: formData.get("autoRenderResolution"),
      fps: formData.get("autoRenderFps"),
      speed: formData.get("autoRenderSpeed"),
      motionBlur: checked(formData, "autoRenderMotionBlur"),
    },
    monitoring: {
      alertsEnabled: checked(formData, "monitoringAlertsEnabled"),
      alertChannelId: formData.get("monitoringAlertChannelId"),
      osuDailyRequestLimit: formData.get("monitoringOsuDailyRequestLimit"),
      youtubeDailyQuota: formData.get("monitoringYoutubeDailyQuota"),
      r2StorageLimitGb: formData.get("monitoringR2StorageLimitGb"),
    },
  };
  const secretNames: ControlPanelSecretName[] = [
    "OSU_CLIENT_ID",
    "OSU_CLIENT_SECRET",
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET",
    "YOUTUBE_REFRESH_TOKEN",
    "SPOTIFY_CLIENT_ID",
    "SPOTIFY_CLIENT_SECRET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ];
  const secrets: Partial<Record<ControlPanelSecretName, string>> = {};
  for (const name of secretNames) {
    const value = formData.get(name);
    if (typeof value === "string" && value.trim()) secrets[name] = value;
  }
  try {
    const saved = await saveControlSettings(input, secrets);
    await auditAdminAction({ source: "web", action: "save-settings", summary: `コントロールパネル設定をv${saved.version}へ更新しました。`, details: { updatedSecrets: Object.keys(secrets) } });
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/render");
    revalidatePath("/dashboard/settings");
    return {
      ok: true,
      message: "保存しました。ローカルRendererがアイドルになり次第、安全に同期して自動再起動します。",
      savedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Control-panel settings update failed", error);
    return { ok: false, message: "入力内容を確認してください。設定は変更されていません。" };
  }
}

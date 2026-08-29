"use server";

import { revalidatePath } from "next/cache";

import type { ControlPanelSecretName } from "@/db/schema";
import { hasControlPanelSession } from "@/lib/control/auth";
import { saveControlSettings } from "@/lib/control/settings";

export type SettingsActionState = {
  ok: boolean;
  message: string;
  savedAt?: string;
} | null;

function checked(formData: FormData, name: string) {
  return formData.has(name);
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
    },
    youtube: {
      autoUpload: checked(formData, "youtubeAutoUpload"),
      privacyStatus: formData.get("youtubePrivacyStatus"),
      deleteAfterUpload: checked(formData, "youtubeDeleteAfterUpload"),
      categoryId: formData.get("youtubeCategoryId"),
    },
    storage: {
      r2Endpoint: formData.get("r2Endpoint"),
      r2Bucket: formData.get("r2Bucket"),
    },
  };
  const secretNames: ControlPanelSecretName[] = [
    "OSU_CLIENT_ID",
    "OSU_CLIENT_SECRET",
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET",
    "YOUTUBE_REFRESH_TOKEN",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ];
  const secrets: Partial<Record<ControlPanelSecretName, string>> = {};
  for (const name of secretNames) {
    const value = formData.get(name);
    if (typeof value === "string" && value.trim()) secrets[name] = value;
  }
  try {
    await saveControlSettings(input, secrets);
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

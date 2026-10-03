"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import {
  clearLoginFailures,
  createControlPanelSession,
  deleteControlPanelSession,
  loginAllowed,
  isControlPanelAuthStoreUnavailable,
  registerLoginFailure,
  requestFingerprint,
  verifyKeyphrase,
} from "@/lib/control/auth";

export type LoginState = { error: string } | null;

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = z.string().min(3).max(256).safeParse(formData.get("keyphrase"));
  if (!parsed.success) return { error: "キーフレーズを入力してください。" };
  try {
    const fingerprint = await requestFingerprint();
    if (!(await loginAllowed(fingerprint))) {
      return { error: "試行回数が多すぎます。15分後にもう一度お試しください。" };
    }
    if (!verifyKeyphrase(parsed.data)) {
      await registerLoginFailure(fingerprint);
      return { error: "キーフレーズが違います。" };
    }
    await clearLoginFailures(fingerprint);
    await createControlPanelSession();
  } catch (error) {
    if (isControlPanelAuthStoreUnavailable(error)) {
      return { error: "クラウドDBが利用上限に達しているため、現在Web管理画面へログインできません。ローカルBotの統計収集は継続中です。" };
    }
    throw error;
  }
  redirect("/dashboard");
}

export async function logout() {
  await deleteControlPanelSession();
  redirect("/");
}

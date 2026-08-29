"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import {
  clearLoginFailures,
  createControlPanelSession,
  deleteControlPanelSession,
  loginAllowed,
  registerLoginFailure,
  requestFingerprint,
  verifyKeyphrase,
} from "@/lib/control/auth";

export type LoginState = { error: string } | null;

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = z.string().min(3).max(256).safeParse(formData.get("keyphrase"));
  if (!parsed.success) return { error: "キーフレーズを入力してください。" };
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
  redirect("/dashboard");
}

export async function logout() {
  await deleteControlPanelSession();
  redirect("/");
}

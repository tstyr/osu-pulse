"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { accounts } from "@/db/schema";
import { hasControlPanelSession } from "@/lib/control/auth";
import { getBridgeConfiguration } from "@/lib/control/settings";
import { OsuApiError } from "@/lib/osu/client";
import { registerManuallyTrackedOsuAccount } from "@/services/osu-sync";
import { eq } from "drizzle-orm";

const manualPlayerSchema = z.object({
  username: z.string().trim().min(1).max(64),
  mode: z.enum(["osu", "taiko", "fruits", "mania"]),
});

export type ManualPlayerActionState = {
  ok: boolean;
  message: string;
  osuUserId?: number;
} | null;

const deletePlayerSchema = z.object({
  accountId: z.string().uuid(),
  confirmUsername: z.string().trim().min(1).max(64),
});

export type DeletePlayerActionState = {
  ok: boolean;
  message: string;
} | null;

export async function addManualPlayer(
  _previous: ManualPlayerActionState,
  formData: FormData,
): Promise<ManualPlayerActionState> {
  if (!(await hasControlPanelSession())) {
    return { ok: false, message: "セッションが切れました。再ログインしてください。" };
  }
  const parsed = manualPlayerSchema.safeParse({
    username: formData.get("username"),
    mode: formData.get("mode"),
  });
  if (!parsed.success) {
    return { ok: false, message: "osu!ユーザー名またはモードを確認してください。" };
  }
  try {
    const configuration = await getBridgeConfiguration();
    const clientId = configuration.env.OSU_CLIENT_ID ?? process.env.OSU_CLIENT_ID;
    const clientSecret = configuration.env.OSU_CLIENT_SECRET ?? process.env.OSU_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return { ok: false, message: "osu! API資格情報が未設定です。設定画面でClient IDとSecretを保存してください。" };
    }
    const result = await registerManuallyTrackedOsuAccount({
      username: parsed.data.username,
      primaryMode: parsed.data.mode,
      apiCredentials: { clientId, clientSecret },
    });
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/database");
    revalidatePath("/dashboard/statistics");
    return {
      ok: true,
      message: `${result.account.username} を追加しました。${result.capturedModes}モード・最近の${result.importedScores}件を取り込み、継続集計を開始しています。`,
      osuUserId: result.account.osuUserId,
    };
  } catch (error) {
    console.error("Manual osu! account registration failed", error);
    if (error instanceof OsuApiError && error.status === 404) {
      return { ok: false, message: "指定したosu!ユーザーが見つかりませんでした。" };
    }
    return { ok: false, message: "osu! APIまたはDBへの接続に失敗しました。少し待ってから再試行してください。" };
  }
}

export async function deleteTrackedPlayer(
  _previous: DeletePlayerActionState,
  formData: FormData,
): Promise<DeletePlayerActionState> {
  if (!(await hasControlPanelSession())) {
    return { ok: false, message: "セッションが切れました。再ログインしてください。" };
  }
  const parsed = deletePlayerSchema.safeParse({
    accountId: formData.get("accountId"),
    confirmUsername: formData.get("confirmUsername"),
  });
  if (!parsed.success) {
    return { ok: false, message: "削除対象と確認用ユーザー名を確認してください。" };
  }

  const db = getDb();
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, parsed.data.accountId),
    columns: { id: true, username: true },
  });
  if (!account) {
    return { ok: false, message: "指定されたプレイヤーは既に削除されています。" };
  }
  if (account.username !== parsed.data.confirmUsername) {
    return { ok: false, message: `確認欄には ${account.username} と正確に入力してください。` };
  }

  try {
    await db.delete(accounts).where(eq(accounts.id, account.id));
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/database");
    revalidatePath("/dashboard/statistics");
    revalidatePath("/dashboard/operations");
    return { ok: true, message: `${account.username} をDBから削除しました。関連する統計履歴・Discord連携・自動条件も削除されています。` };
  } catch (error) {
    console.error("Tracked osu! account deletion failed", error);
    return { ok: false, message: "DBから削除できませんでした。ログを確認してください。" };
  }
}

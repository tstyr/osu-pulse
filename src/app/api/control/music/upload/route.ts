import { z } from "zod";

import { hasControlPanelSession } from "@/lib/control/auth";
import { createR2AudioUpload, ensureR2MusicUploadCors } from "@/lib/music/r2-audio";
import { publicAppOrigin } from "@/lib/public-app-url";

const maximumSizeInBytes = Math.max(1_048_576, Number.parseInt(process.env.BOT_AUDIO_MAX_UPLOAD_BYTES ?? "209715200", 10) || 209_715_200);
const requestSchema = z.object({
  fileName: z.string().trim().min(1).max(255).regex(/\.(flac|wav|mp3|m4a)$/i),
  contentType: z.string().trim().min(1).max(100),
  sizeBytes: z.number().int().positive(),
  origin: z.string().url().max(300).optional(),
});

export async function POST(request: Request) {
  if (!(await hasControlPanelSession())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const invalidFields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "request")))];
    const fileNameInvalid = invalidFields.includes("fileName");
    return Response.json({
      error: fileNameInvalid
        ? "対応形式は FLAC / WAV / MP3 / M4A です。"
        : `アップロード情報が不足しています: ${invalidFields.join(", ")}`,
    }, { status: 400 });
  }
  if (parsed.data.sizeBytes > maximumSizeInBytes) {
    return Response.json({ error: `音源は最大 ${Math.round(maximumSizeInBytes / 1_048_576)}MB です。` }, { status: 413 });
  }
  try {
    const requestOrigin = request.headers.get("origin");
    const origin = new URL(parsed.data.origin || requestOrigin || request.url).origin;
    if (parsed.data.origin && requestOrigin && new URL(requestOrigin).origin !== origin) {
      return Response.json({ error: "アップロード元URLが一致しません。" }, { status: 403 });
    }
    const host = new URL(origin).hostname;
    const allowed = origin === publicAppOrigin()
      || ["localhost", "127.0.0.1", "::1"].includes(host);
    if (!allowed) return Response.json({ error: "このURLからのアップロードは許可されていません。" }, { status: 403 });
    await ensureR2MusicUploadCors(origin);
    return Response.json(await createR2AudioUpload(parsed.data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "R2アップロードを開始できませんでした。" }, { status: 503 });
  }
}

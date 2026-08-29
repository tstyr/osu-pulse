import { createHash } from "node:crypto";

import { z } from "zod";

import { renderApiError } from "@/lib/render/api";
import { WEB_REPLAY_MAX_BYTES } from "@/lib/render/constants";
import {
  createCloudRenderJob,
  createJobToken,
  parseScoreUrl,
  publicJob,
  RenderApiError,
  renderOptionsSchema,
  requireWebRenderAccess,
} from "@/lib/render/server";

export const runtime = "nodejs";

function formValues(form: FormData) {
  return {
    resolution: form.get("resolution"),
    fps: form.get("fps"),
    speed: form.get("speed"),
    motionBlur: form.get("motionBlur"),
  };
}
export async function POST(request: Request) {
  try {
    await requireWebRenderAccess(request);
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 4_400_000) {
      throw new RenderApiError("REPLAY_TOO_LARGE", "Web から送れる .osr は 3 MB までです。", 413);
    }

    const contentType = request.headers.get("content-type") ?? "";
    let inputType: "score_url" | "replay";
    let scoreUrl: string | undefined;
    let replayData: string | undefined;
    let source: Uint8Array | string;
    let options;

    if (contentType.startsWith("application/json")) {
      const body = z.object({ type: z.literal("score_url"), url: z.string().max(2_000) })
        .and(renderOptionsSchema)
        .parse(await request.json());
      inputType = "score_url";
      scoreUrl = parseScoreUrl(body.url);
      source = scoreUrl;
      options = {
        resolution: body.resolution,
        fps: body.fps,
        speed: body.speed,
        motionBlur: body.motionBlur,
      };
    } else if (contentType.startsWith("multipart/form-data")) {
      const form = await request.formData();
      if (form.get("type") !== "replay") {
        throw new RenderApiError("INVALID_REQUEST", "Replay リクエストが正しくありません。", 400);
      }
      const replay = form.get("replay");
      if (!(replay instanceof File) || !replay.name.toLowerCase().endsWith(".osr")) {
        throw new RenderApiError("INVALID_REPLAY", ".osr ファイルを選択してください。", 400);
      }
      if (replay.size <= 0 || replay.size > WEB_REPLAY_MAX_BYTES) {
        throw new RenderApiError("REPLAY_TOO_LARGE", "Web から送れる .osr は 3 MB までです。", 413);
      }
      const bytes = new Uint8Array(await replay.arrayBuffer());
      inputType = "replay";
      source = bytes;
      replayData = Buffer.from(bytes).toString("base64");
      options = renderOptionsSchema.parse(formValues(form));
    } else {
      throw new RenderApiError("UNSUPPORTED_MEDIA_TYPE", "JSON または multipart/form-data を使用してください。", 415);
    }

    const { token, hash } = createJobToken();
    const sourceHash = createHash("sha256").update(source).digest("hex");
    const job = await createCloudRenderJob({
      tokenHash: hash,
      inputType,
      sourceHash,
      scoreUrl,
      replayData,
      options,
    });
    return Response.json({ job: publicJob(job), jobToken: token }, { status: 202 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ errorCode: "INVALID_OPTIONS", error: "レンダー設定が正しくありません。" }, { status: 400 });
    }
    return renderApiError(error);
  }
}

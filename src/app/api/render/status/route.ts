import { noStoreJson, renderApiError } from "@/lib/render/api";
import { rendererStatus, requireWebRenderAccess } from "@/lib/render/server";

export async function GET(request: Request) {
  try {
    await requireWebRenderAccess(request);
    return noStoreJson(await rendererStatus());
  } catch (error) {
    return renderApiError(error);
  }
}

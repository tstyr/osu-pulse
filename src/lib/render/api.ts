import { RenderApiError } from "./server";

export function renderApiError(error: unknown) {
  if (error instanceof RenderApiError) {
    return Response.json({ errorCode: error.code, error: error.message }, { status: error.status });
  }
  console.error("Render API error", error);
  return Response.json({ errorCode: "INTERNAL_ERROR", error: "レンダーAPIでエラーが発生しました。" }, { status: 500 });
}
export function noStoreJson(value: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store, max-age=0");
  return Response.json(value, { ...init, headers });
}

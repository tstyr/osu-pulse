import { getOverlaySnapshot } from "@/db/advanced-features";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const snapshot = await getOverlaySnapshot((await params).token);
  if (!snapshot) return Response.json({ error: "Overlay not found" }, { status: 404 });
  return Response.json(snapshot, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

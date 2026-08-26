import { pingDatabase } from "@/db/repository";

export async function GET() {
  try {
    await pingDatabase();
    return Response.json({ ok: true, database: "connected", timestamp: new Date().toISOString() });
  } catch (error) {
    return Response.json({ ok: false, database: "unavailable", error: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  }
}

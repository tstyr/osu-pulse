import { getPublicServiceStatus } from "@/db/advanced-features";

export async function GET() {
  return Response.json(await getPublicServiceStatus(), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

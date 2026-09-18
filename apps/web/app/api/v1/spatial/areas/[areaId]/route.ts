import { areaContext } from "@/lib/server/areas";
import { adaptAreaContext } from "@/features/spatial/data/legacy-adapter";
import type { WorldState } from "@ulpin/contracts";
export const runtime = "nodejs";
/** Local single-operator compatibility endpoint. Not a public authenticated API or a bulk world feed. */
export async function GET(request: Request, context: { params: Promise<{ areaId: string }> }) {
  const { areaId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(areaId)) return Response.json({ error: { message: "Invalid area ID" } }, { status: 400 });
  const world = new URL(request.url).searchParams.get("world");
  if (!world || !["observed", "planned", "hypothetical", "synthetic"].includes(world)) return Response.json({ error: { message: "Choose an explicit world: observed, planned, hypothetical or synthetic" } }, { status: 400 });
  try {
    return Response.json(adaptAreaContext(await areaContext(areaId), world as WorldState), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: { message: "Area data is unavailable or outside the supported compatibility profile. Existing records were not changed." } }, { status: 422 });
  }
}

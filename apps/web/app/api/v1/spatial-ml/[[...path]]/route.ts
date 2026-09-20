import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { AppError } from "@/lib/server/errors";
import { spatialMlRoutes } from "@/lib/server/spatial-ml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };

async function handle(request: Request, context: Context) {
  const requestId = randomUUID();
  try {
    const local = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    if (!local(new URL(request.url).hostname)) throw new AppError(403, "LOCAL_DEMO_ONLY", "This single-operator workbench is available only on localhost.");
    const origin = request.headers.get("origin");
    if (origin) {
      let allowed = false;
      try { allowed = local(new URL(origin).hostname); } catch { /* opaque origins are not local */ }
      if (!allowed) throw new AppError(403, "ORIGIN_DENIED", "The request did not originate from the local workbench.");
    }
    return await spatialMlRoutes(request, (await context.params).path ?? []);
  } catch (error) {
    const status = error instanceof AppError ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 422 : 503;
    const code = error instanceof AppError ? error.code : error instanceof ZodError || error instanceof SyntaxError ? "INVALID_INPUT" : "SERVICE_UNAVAILABLE";
    const message = error instanceof AppError ? error.message : error instanceof ZodError ? "Check the source selection, request fields and calibration controls." : error instanceof SyntaxError ? "The request must contain valid JSON." : "The local spatial extraction service could not complete this operation. Check service health and retry.";
    return Response.json({ error: { code, message, requestId } }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
export const GET = handle;
export const POST = handle;

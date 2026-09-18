import {handleLegacyCoreRead} from "@/lib/server/spatial-core-http";

export const runtime="nodejs";
export const dynamic="force-dynamic";

/** Additive local-only v2 read bridge. Existing spatial v1 consumers are unchanged. */
export async function GET(request:Request,context:{params:Promise<{areaId:string}>}) {
  const {areaId}=await context.params;
  return handleLegacyCoreRead(request,areaId);
}

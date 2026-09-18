import {handleNeighbourhoodScene} from "@/lib/server/spatial-core-scene";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{areaId:string;asset:string[]}>}) {
  const {areaId,asset}=await context.params;
  return handleNeighbourhoodScene(request,areaId,asset);
}

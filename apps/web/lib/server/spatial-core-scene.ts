import {compileSpatialSnapshot,type CompiledPublication} from "@/features/spatial/compiler/compile";
import {projectCoreNeighbourhood,type NeighbourhoodView} from "@/features/spatial/data/core-display";
import {normalizeLegacySpatialSlice} from "@/features/spatial/data/core-legacy-adapter";
import {localRequest} from "./spatial-core-http";
import {LegacySpatialReadError,readLegacySpatialSlice} from "./spatial-core-read";
import type {WorldState} from "@ulpin/contracts";

type SceneEntry={view:NeighbourhoodView;publication:CompiledPublication;bytes:number;expires:number;used:number};
/** Per-process, local-operator derived assets only. No original documents or DB writes. */
export class NeighbourhoodSceneCache {
  private entries=new Map<string,SceneEntry>();
  constructor(private readonly maximumBytes=96*1024*1024,private readonly clock=()=>Date.now()){}
  key(areaId:string,world:string,digest:string){return `${areaId}:${world}:${digest}`;}
  get(areaId:string,world:string,digest:string){
    const key=this.key(areaId,world,digest),entry=this.entries.get(key);
    if(!entry)return null;if(entry.expires<this.clock()){this.entries.delete(key);return null;}entry.used=this.clock();return entry;
  }
  put(areaId:string,world:string,digest:string,view:NeighbourhoodView,publication:CompiledPublication){
    const bytes=publication.summary.bytes+Buffer.byteLength(JSON.stringify(view));
    if(bytes>this.maximumBytes)throw new LegacySpatialReadError(413,"SCENE_LIMIT","This scene exceeds the bounded neighbourhood display budget");
    const key=this.key(areaId,world,digest);this.entries.delete(key);
    const now=this.clock();for(const [id,entry] of this.entries)if(entry.expires<now)this.entries.delete(id);
    while([...this.entries.values()].reduce((sum,e)=>sum+e.bytes,0)+bytes>this.maximumBytes||this.entries.size>=3){
      const oldest=[...this.entries].sort((a,b)=>a[1].used-b[1].used)[0];if(!oldest)break;this.entries.delete(oldest[0]);
    }
    const entry={view,publication,bytes,used:now,expires:now+20*60*1000};this.entries.set(key,entry);return entry;
  }
  get size(){return this.entries.size;}
}
const cache=new NeighbourhoodSceneCache();
const inflight=new Map<string,Promise<SceneEntry>>();
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const worlds=new Set(["observed","planned","hypothetical","synthetic"]);
async function compileCurrent(areaId:string,world:WorldState,expected?:string) {
  const key=`${areaId}:${world}:${expected??"current"}`;
  let task=inflight.get(key);if(task)return task;
  if(inflight.size>=2)throw new LegacySpatialReadError(429,"SCENE_BUSY","Two neighbourhoods are being prepared; retry shortly");
  task=(async()=>{
    const data=await normalizeLegacySpatialSlice(await readLegacySpatialSlice(areaId,world),world);
    if(expected&&data.readDigest!==expected)throw new LegacySpatialReadError(409,"SNAPSHOT_CHANGED","Records changed or the old scene expired. Reload the neighbourhood coherently");
    const existing=cache.get(areaId,world,data.readDigest);if(existing)return existing;
    const view=projectCoreNeighbourhood(data),base=`/api/v1/spatial/core/areas/${areaId}/scene/${world}/${data.readDigest}`;
    const publication=compileSpatialSnapshot(view.snapshot,base);
    return cache.put(areaId,world,data.readDigest,view,publication);
  })();
  inflight.set(key,task);try{return await task;}finally{inflight.delete(key);}
}
export async function handleNeighbourhoodScene(request:Request,areaId:string,path:string[]) {
  const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
  try{
    localRequest(request);
    if(!UUID.test(areaId)||path.length<2||!worlds.has(path[0]))throw new LegacySpatialReadError(400,"SCENE_SELECTION","Choose an explicit supported area and world");
    const world=path[0] as WorldState;
    if(path.length===2&&path[1]==="descriptor.json"){
      const entry=await compileCurrent(areaId,world);
      return Response.json({...entry.view,publicationId:entry.publication.id,manifestUrl:`/api/v1/spatial/core/areas/${areaId}/scene/${world}/${entry.view.readDigest}/manifest.json`},{headers});
    }
    const digest=path[1];if(!HASH.test(digest)||![3,4].includes(path.length))throw new LegacySpatialReadError(404,"SCENE_ASSET","Invalid scene asset path");
    if(path.length===3&&path[2]!=="manifest.json"||path.length===4&&(!HASH.test(path[2])||!/^[-a-z0-9_]+\.glb$/.test(path[3])))throw new LegacySpatialReadError(404,"SCENE_ASSET","Unknown scene asset");
    const entry=cache.get(areaId,world,digest)??await compileCurrent(areaId,world,digest);
    if(path.length===3)return Response.json(entry.publication.manifest,{headers});
    if(path[2]!==entry.publication.id)throw new LegacySpatialReadError(409,"SCENE_VERSION","Scene compiler output changed; reload the descriptor");
    const bytes=entry.publication.assets.get(path[3]);if(!bytes)throw new LegacySpatialReadError(404,"SCENE_ASSET","Unknown scene tile");
    return new Response(new Uint8Array(bytes),{headers:{...headers,"Content-Type":"model/gltf-binary","ETag":`"${entry.publication.id}:${path[3]}"`}});
  }catch(error){
    const status=error instanceof LegacySpatialReadError?error.status:422;
    return Response.json({error:{code:error instanceof LegacySpatialReadError?error.code:"SCENE_UNAVAILABLE",message:error instanceof LegacySpatialReadError?error.message:"This neighbourhood cannot be rendered with the current qualified profile. Its original records are unchanged."}},{status,headers});
  }
}

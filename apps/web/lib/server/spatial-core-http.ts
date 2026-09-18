import {CoreContractError} from "@ulpin/contracts";
import {normalizeLegacySpatialSlice} from "../../features/spatial/data/core-legacy-adapter";
import {CORE_LEGACY_LIMITS} from "../../features/spatial/data/core-legacy-types";
import {LegacySpatialReadError,readLegacySpatialSlice,validateLegacyReadSelection} from "./spatial-core-read";

const loopback=(host:string)=>["localhost","127.0.0.1","[::1]"].includes(host.toLowerCase());
export function localRequest(request:Request):void {
  const url=new URL(request.url),host=request.headers.get("host");
  let hostValid=!host;
  if(host)try{const declared=new URL(`http://${host}`);hostValid=loopback(declared.hostname)&&!declared.username&&!declared.password&&declared.pathname==="/"&&!declared.search&&!declared.hash;}catch{hostValid=false;}
  if(!loopback(url.hostname)||!hostValid)throw new LegacySpatialReadError(403,"LOCAL_READ_ONLY","This endpoint is qualified for the local single-operator deployment only");
  const origin=request.headers.get("origin");
  if(origin&&origin!==url.origin||request.headers.get("sec-fetch-site")==="cross-site")throw new LegacySpatialReadError(403,"CROSS_ORIGIN_READ","Cross-origin spatial reads are not allowed");
}

export async function handleLegacyCoreRead(request:Request,areaId:string,read=readLegacySpatialSlice):Promise<Response> {
  const headers={"Cache-Control":"no-store","Content-Type":"application/json; charset=utf-8","X-Content-Type-Options":"nosniff"};
  try {
    localRequest(request);
    const url=new URL(request.url),world=url.searchParams.get("world")??"";
    for(const key of url.searchParams.keys())if(!["world","expectedDigest"].includes(key)||url.searchParams.getAll(key).length!==1)throw new LegacySpatialReadError(400,"READ_PARAMETER","Unsupported or repeated core read parameter");
    validateLegacyReadSelection(areaId,world);
    const expected=url.searchParams.get("expectedDigest");
    if(expected&&!/^[a-f0-9]{64}$/.test(expected))throw new LegacySpatialReadError(400,"SNAPSHOT_DIGEST","Expected snapshot digest is invalid");
    const slice=await read(areaId,world),result=await normalizeLegacySpatialSlice(slice,world);
    if(expected&&expected!==result.readDigest)throw new LegacySpatialReadError(409,"SNAPSHOT_CHANGED","The selected legacy records changed; reload the complete read slice");
    const body=JSON.stringify({...result,consistency:"repeatable-read-read-only",selection:"published-current-only"});
    if(Buffer.byteLength(body,"utf8")>CORE_LEGACY_LIMITS.outputBytes)throw new LegacySpatialReadError(413,"LEGACY_READ_BYTES","Normalized response exceeds the bounded payload profile");
    return new Response(body,{status:200,headers:{...headers,ETag:`"${result.readDigest}"`}});
  }catch(error){
    if(error instanceof LegacySpatialReadError)return new Response(JSON.stringify({error:{code:error.code,message:error.message}}),{status:error.status,headers});
    if(error instanceof CoreContractError)return new Response(JSON.stringify({error:{code:error.code,message:"The legacy slice could not be normalized without changing its meaning"}}),{status:422,headers});
    return new Response(JSON.stringify({error:{code:"LEGACY_READ_FAILED",message:"The consistent spatial read is unavailable"}}),{status:503,headers});
  }
}

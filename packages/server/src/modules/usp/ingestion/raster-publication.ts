import {z} from 'zod';
import {RASTER_WINDOW_LIMITS,RasterWindowMetadataSchema,type RasterWindowInput} from '@ulpin/contracts/usp';
import type {DbDeadline} from '../../../infrastructure/db';
import {AppError} from '../../../infrastructure/errors';
import {settings} from '../../../infrastructure/config';
import {sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';

const reply=z.strictObject({metadata:RasterWindowMetadataSchema,artifactBase64:z.string().max(6*1024*1024),
  artifactSha256:z.string().regex(/^[a-f0-9]{64}$/),artifactBytes:z.number().int().positive().max(RASTER_WINDOW_LIMITS.artifactBytes)});
export const RASTER_NATIVE_REPLY_BYTES=6*1024*1024;
export function rasterPublicationLive(bounds:DbDeadline){
  if(bounds.signal?.aborted){
    if(bounds.signal.reason instanceof AppError)throw bounds.signal.reason;
    if(bounds.signal.reason?.name==='TimeoutError')throw new AppError(504,'RASTER_TIMEOUT','The bounded raster transport deadline elapsed.');
    throw new AppError(503,'RASTER_CANCELLED','Owned raster processing stopped; the original remains retained.');
  }
  if(Date.now()>=bounds.deadlineAt)throw new AppError(504,'RASTER_TIMEOUT','The absolute raster publication deadline elapsed.');
}
/** Cap wire bytes before JSON/base64 allocation; cancel the owned response on
 * refusal/stop. Fetch and this body share the same finite native deadline. */
export async function rasterNativeJson(response:Response,cap:number,bounds:DbDeadline):Promise<unknown>{
  try{rasterPublicationLive(bounds);}catch(error){await response.body?.cancel().catch(()=>{});throw error;}
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>cap)){
    await response.body?.cancel().catch(()=>{});
    throw new AppError(413,'RASTER_REPLY_LIMIT','The raster reader reply exceeds its bounded profile.');
  }
  if(!response.body)throw new AppError(503,'RASTER_PROCESSOR_UNAVAILABLE','The raster reader returned no bounded body.');
  const reader=response.body.getReader(),chunks:Buffer[]=[];let count=0;
  const stop=()=>{void reader.cancel().catch(()=>{});};bounds.signal?.addEventListener('abort',stop,{once:true});
  try{
    while(true){rasterPublicationLive(bounds);const {done,value}=await reader.read();rasterPublicationLive(bounds);if(done)break;
      count+=value.byteLength;if(count>cap)throw new AppError(413,'RASTER_REPLY_LIMIT','The raster reader reply exceeds its bounded profile.');
      chunks.push(Buffer.from(value));}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,count)));
  }catch(error){rasterPublicationLive(bounds);throw error;}
  finally{bounds.signal?.removeEventListener('abort',stop);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function nativeRasterWindow(input:RasterWindowInput,bounds:DbDeadline,request:typeof fetch=fetch){
  rasterPublicationLive(bounds);
  const deadlineAt=Math.min(bounds.deadlineAt,Date.now()+100000),signal=AbortSignal.any([
    AbortSignal.timeout(Math.max(1,deadlineAt-Date.now())),...(bounds.signal?[bounds.signal]:[])]),nativeBounds={deadlineAt,signal};
  let response:Response;
  try{response=await request(`${settings.geoUrl}/internal/raster/window`,{method:'POST',headers:{
    Authorization:`Bearer ${settings.geoToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({sourceId:input.sourceId,objectKey:input.objectKey,sha256:input.sourceSha256,bytes:input.sourceBytes,window:input.window}),signal});
  }catch(error){rasterPublicationLive(nativeBounds);throw error;}
  if(response.status===422){
    let value:unknown;try{value=await rasterNativeJson(response,RASTER_WINDOW_LIMITS.resultBytes,nativeBounds);}
    catch(error){if(error instanceof AppError)throw error;value=null;}
    const detail=z.object({detail:z.string().max(2048)}).safeParse(value),text=detail.success?detail.data.detail:'';
    if(text==='Pixel window is outside the retained raster dimensions.')
      throw new AppError(422,'RASTER_WINDOW_OUT_OF_BOUNDS','Select a window within the retained raster dimensions. The original remains available.');
    if(text==='Raster source hash or byte count differs from its retained receipt.'||text==='Raster source exceeds its retained byte receipt.')
      throw new AppError(422,'RASTER_SOURCE_INTEGRITY','The retained raster differs from its source receipt. Re-upload the original.');
    throw new AppError(422,'RASTER_UNSUPPORTED','The retained GeoTIFF or selected native window is unsupported; the original remains available.');
  }
  if(!response.ok){await response.body?.cancel().catch(()=>{});
    throw new AppError(503,'RASTER_PROCESSOR_UNAVAILABLE','The bounded raster reader is unavailable; retry the retained source.');}
  const parsed=reply.parse(await rasterNativeJson(response,RASTER_NATIVE_REPLY_BYTES,nativeBounds));
  if(input.window&&fingerprint(parsed.metadata.window)!==fingerprint(input.window))
    throw new AppError(422,'RASTER_WINDOW_SCOPE','The reader returned a different pixel window.');
  if(parsed.artifactBase64.length!==4*Math.ceil(parsed.artifactBytes/3))
    throw new AppError(422,'RASTER_ARTIFACT_INTEGRITY','The reader artifact differs from its bounded base64 length.');
  const bytes=Buffer.from(parsed.artifactBase64,'base64');
  if(bytes.length!==parsed.artifactBytes||bytes.toString('base64')!==parsed.artifactBase64||sha256(bytes)!==parsed.artifactSha256)
    throw new AppError(422,'RASTER_ARTIFACT_INTEGRITY','The reader artifact failed its exact hash or byte count.');
  rasterPublicationLive(nativeBounds);return {metadata:parsed.metadata,bytes,hash:parsed.artifactSha256};
}

import { query } from './db';
import { readObject } from './storage';
import { settings } from './config';
import { AppError } from './errors';
import { type AiPart } from './officer-ai-validation';
import { createHash } from 'node:crypto';

export async function selectedImageCrops(parts:AiPart[],regions:{partId:string;region:{x:number;y:number;width:number;height:number}}[]) {
  const results=[];
  for(const selected of regions) {
    const part=parts.find(p=>p.id===selected.partId);
    if(!part) throw new AppError(422,'AI_CROP','Select an associated image source part.');
    const source=(await query('SELECT mime_type,object_key,sha256,bytes FROM sources WHERE id=$1',[part.sourceRevisionId])).rows[0];
    if(!source||!['image/png','image/jpeg'].includes(source.mime_type)||Number(source.bytes)>16*1024*1024) throw new AppError(422,'AI_IMAGE_FORMAT','Select a PNG/JPEG original up to 16 MiB. PDF image pages need an explicit render derivative first.');
    const bytes=await readObject(source.object_key);
    if(bytes.length>16*1024*1024||createHash('sha256').update(bytes).digest('hex')!==source.sha256) throw new AppError(422,'AI_IMAGE_INTEGRITY','Image original checksum could not be verified.');
    const response=await fetch(`${settings.geoUrl}/internal/area/crop`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${settings.geoToken}`},body:JSON.stringify({format:source.mime_type==='image/png'?'png':'jpeg',base64:Buffer.from(bytes).toString('base64'),region:selected.region}),signal:AbortSignal.timeout(30000),redirect:'error'});
    if(!response.ok) throw new AppError(422,'AI_CROP_UNAVAILABLE','The native image crop could not be prepared. Check the selected region and processing service.');
    const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let total=0;
    if(!reader)throw new AppError(422,'AI_CROP_INTEGRITY','The native crop response is empty.');
    try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>6*1024*1024)throw new AppError(413,'AI_CROP_LIMIT','The native crop response exceeds its byte limit.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
    let crop:any;try{crop=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError(422,'AI_CROP_INTEGRITY','The native crop response is not valid JSON.');}
    const derivative=Buffer.from(crop.base64??'','base64');
    if(!derivative.length||derivative.length>4*1024*1024||![crop.width,crop.height].every(n=>Number.isInteger(n)&&n>0)||crop.width*crop.height>4_000_000||crop.method!=='native-image-crop-v1'||JSON.stringify(crop.region)!==JSON.stringify(selected.region)||createHash('sha256').update(derivative).digest('hex')!==crop.sha256||crop.sourceSha256!==source.sha256) throw new AppError(422,'AI_CROP_INTEGRITY','Image crop metadata or checksum failed verification.');
    results.push({partId:part.id,sourceSha256:source.sha256,sha256:crop.sha256,width:crop.width,height:crop.height,region:crop.region,sourcePixels:crop.sourcePixels,pixelRegion:crop.pixelRegion,orientation:crop.orientation,method:crop.method,bytes:derivative,dataUrl:`data:image/png;base64,${crop.base64}`});
  }
  return results;
}

import {HeadObjectCommand,S3Client} from '@aws-sdk/client-s3';
import {openObjectStream,sha256} from '../../../infrastructure/storage';
import {settings} from '../../../infrastructure/config';
import {AppError} from '../../../infrastructure/errors';
import type {DbDeadline} from '../../../infrastructure/db';
import {POINT_BATCH_LIMITS} from '@ulpin/contracts/usp';

export function pointReadLive(bounds:DbDeadline){
  if(bounds.signal?.aborted||Date.now()>=bounds.deadlineAt)
    throw new AppError(503,'POINT_READ_DEADLINE','The bounded point read expired; the original remains retained.');
}
export const pointReadDeadline=():DbDeadline=>({deadlineAt:Date.now()+30000,signal:AbortSignal.timeout(30000)});
// Legacy point result refs contain no byte count. A temporary HEAD client gets
// bounded metadata only; exact GET/ETag transport uses the canonical primitive.
async function resultHead(key:string,bounds:DbDeadline){
  pointReadLive(bounds);
  const client=new S3Client({endpoint:settings.s3Endpoint,region:settings.s3Region,forcePathStyle:true,
    credentials:{accessKeyId:settings.s3AccessKey,secretAccessKey:settings.s3SecretKey}});
  try{
    const response=await client.send(new HeadObjectCommand({Bucket:settings.s3Bucket,Key:key}),
      {abortSignal:AbortSignal.any([AbortSignal.timeout(Math.max(1,bounds.deadlineAt-Date.now())),...(bounds.signal?[bounds.signal]:[])])});
    pointReadLive(bounds);return {bytes:response.ContentLength,etag:response.ETag};
  }catch(error){pointReadLive(bounds);throw error;}finally{client.destroy();}
}
type Dependencies={head:typeof resultHead;open:typeof openObjectStream};
const defaults:Dependencies={head:resultHead,open:openObjectStream};

/** Only content-addressed point receipts/artifacts; refuse size before reading,
 * then count/hash the stream. A single absolute deadline covers HEAD and GET. */
export async function readPointObject(key:string,hash:string,size:number|null,bounds:DbDeadline=pointReadDeadline(),deps:Dependencies=defaults){
  pointReadLive(bounds);
  const receipt=key.endsWith('.json'),cap=receipt?POINT_BATCH_LIMITS.resultBytes:POINT_BATCH_LIMITS.artifactBytes;
  if(!/^[a-f0-9]{64}$/.test(hash)||!new RegExp(`^point-batches/[a-f0-9-]{36}/${hash}\\.${receipt?'json':'bin'}$`).test(key)||(!receipt&&size===null))
    throw new AppError(422,'POINT_OBJECT_SCOPE','Read an exact point receipt or artifact key.');
  let etag:string|undefined;
  if(size===null){const head=await deps.head(key,bounds);size=head.bytes??0;etag=head.etag;
    if(!etag)throw new AppError(422,'POINT_RESULT_INTEGRITY','The point receipt lacks immutable streaming metadata.');}
  if(!Number.isSafeInteger(size)||size<1||size>cap)
    throw new AppError(422,'POINT_OBJECT_LIMIT','The stored point object exceeds its bounded receipt profile.');
  pointReadLive(bounds);
  const {body}=await deps.open(key,size,Math.max(1,bounds.deadlineAt-Date.now()),etag,bounds.signal),chunks:Buffer[]=[];let count=0;
  try{
    for await(const chunk of body){pointReadLive(bounds);count+=chunk.length;
      if(count>size)throw new AppError(422,'POINT_OBJECT_INTEGRITY','Stored point bytes exceed their receipt.');chunks.push(Buffer.from(chunk));}
    const bytes=Buffer.concat(chunks,count);
    if(count!==size||sha256(bytes)!==hash)throw new AppError(422,'POINT_OBJECT_INTEGRITY','Stored point bytes differ from their exact hash/length.');
    pointReadLive(bounds);return bytes;
  }finally{body.destroy();}
}

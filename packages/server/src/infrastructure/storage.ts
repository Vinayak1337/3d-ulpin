import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  AbortMultipartUploadCommand, ListMultipartUploadsCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { Readable } from 'node:stream';
import { settings } from "./config";
import { AppError } from "./errors";

let client: S3Client | undefined;
/** Release only this process's client during API shutdown. */
export function closeStorageClient(): void {
  client?.destroy();
  client = undefined;
}
function s3() {
  client ??= new S3Client({
    endpoint: settings.s3Endpoint,
    region: settings.s3Region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: settings.s3AccessKey,
      secretAccessKey: settings.s3SecretKey,
    },
  });
  return client;
}
export function sha256(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}
export async function checkStorage() {
  await s3().send(new HeadBucketCommand({ Bucket: settings.s3Bucket }));
}
export async function ensureBucket() {
  try {
    await checkStorage();
  } catch (error) {
    const code = (error as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    if (code !== 404) throw error;
    await s3().send(new CreateBucketCommand({ Bucket: settings.s3Bucket }));
  }
}
export async function readObject(key: string): Promise<Uint8Array> {
  if (key.startsWith('large-originals/')) throw new AppError(413, 'STREAMING_ORIGINAL_REQUIRED', 'This large original requires the bounded native streaming download.');
  const result = await s3().send(
    new GetObjectCommand({ Bucket: settings.s3Bucket, Key: key }),
  );
  if (!result.Body)
    throw new AppError(
      503,
      "SOURCE_UNAVAILABLE",
      "The stored original is unavailable.",
    );
  return result.Body.transformToByteArray();
}
export async function putOriginal(
  key: string,
  bytes: Uint8Array,
  mimeType: string,
  signal?: AbortSignal,
) {
  try {await s3().send(
    new PutObjectCommand({
      Bucket: settings.s3Bucket,
      Key: key,
      Body: bytes,
      ContentType: mimeType,
      IfNoneMatch: "*",
      Metadata: { sha256: sha256(bytes) },
    }),
    signal ? {abortSignal: signal} : undefined,
  );} catch(error) {
    // Opt-in fenced publication may replay an immutable content address. Other
    // failures (including abort/timeouts) remain failures, never prior success.
    if(!signal || (error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==412)throw error;
  }
  if(signal){await verifyObjectStream(key,bytes.length,sha256(bytes),30_000,undefined,signal);return;}
  const stored = await readObject(key);
  if (stored.length !== bytes.length || sha256(stored) !== sha256(bytes)) {
    throw new AppError(
      422,
      "UPLOAD_INTEGRITY",
      "The uploaded bytes could not be verified. Retry the upload.",
    );
  }
}
export async function removeOrphan(key: string, signal?:AbortSignal) {
  await s3().send(
    new DeleteObjectCommand({ Bucket: settings.s3Bucket, Key: key }),
    {abortSignal:signal},
  );
}

/** Node streams remain bounded by backpressure; no whole-original byte array is allocated. */
export async function openObjectStream(key: string, bytes: number, timeoutMs: number, etag?: string, signal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs); timer.unref();
  const parentAbort=()=>controller.abort();signal?.addEventListener('abort',parentAbort,{once:true});
  if(signal?.aborted)controller.abort();
  try {
    const result = await s3().send(new GetObjectCommand({Bucket:settings.s3Bucket,Key:key,...(etag?{IfMatch:etag}:{})}),{abortSignal:controller.signal});
    const body = result.Body as Readable | undefined;
    if (!(body instanceof Readable) || result.ContentLength !== bytes || !result.ETag) {
      body?.destroy(); throw new AppError(422,'SOURCE_INTEGRITY','Stored object size or streaming metadata does not match its receipt.');
    }
    const abort=()=>body.destroy(new AppError(503,'STORAGE_TIMEOUT','The bounded object read timed out.'));
    const stop = () => {clearTimeout(timer);signal?.removeEventListener('abort',parentAbort);controller.signal.removeEventListener('abort',abort);if(!body.readableEnded)controller.abort();};
    body.once('close',stop);body.once('end',stop);
    controller.signal.addEventListener('abort',abort,{once:true});
    return {body,etag:result.ETag};
  } catch(error) {const timedOut=controller.signal.aborted;clearTimeout(timer);signal?.removeEventListener('abort',parentAbort);controller.abort();
    if(timedOut)throw new AppError(503,'STORAGE_TIMEOUT','The bounded object read was interrupted or timed out.');throw error;}
}
export async function verifyObjectStream(key: string, bytes: number, expectedHash: string, timeoutMs: number, etag?: string,signal?:AbortSignal,onProgress?:(bytesRead:number)=>Promise<void>) {
  const object=await openObjectStream(key,bytes,timeoutMs,etag,signal),hash=createHash('sha256');let count=0;
  let reported=0,lastProgress=Date.now();
  try {
    for await(const value of object.body) {
      const chunk=value as Buffer;count+=chunk.length;
      if(count>bytes)throw new AppError(422,'SOURCE_INTEGRITY','Stored object exceeds its source receipt.');
      hash.update(chunk);
      if(onProgress && (count-reported>=8*1024*1024||Date.now()-lastProgress>=30000)){
        await onProgress(count);reported=count;lastProgress=Date.now();
      }
    }
    const actual=hash.digest('hex');
    if(count!==bytes || actual!==expectedHash)throw new AppError(422,'SOURCE_INTEGRITY','Stored original hash/size does not match its receipt.');
    if(onProgress)await onProgress(count);
    return {sha256:actual,bytes:count,etag:object.etag};
  }finally{object.body.destroy();}
}
/** Only one bounded upload part may enter this buffer API. */
export async function readPartObject(key:string,bytes:number,expectedHash:string,maxBytes:number,signal?:AbortSignal) {
  if(bytes>maxBytes || !key.startsWith('upload-parts/'))throw new AppError(422,'UPLOAD_PART','Choose a bounded stored byte part.');
  const object=await openObjectStream(key,bytes,30000,undefined,signal),chunks:Buffer[]=[];let count=0;
  try{
    for await(const value of object.body){const chunk=value as Buffer;count+=chunk.length;if(count>bytes)throw new AppError(422,'PART_INTEGRITY','Stored part exceeds its receipt.');chunks.push(chunk);}
    const result=Buffer.concat(chunks,count);
    if(count!==bytes || sha256(result)!==expectedHash)throw new AppError(422,'PART_INTEGRITY','Stored part hash/size does not match its receipt.');
    return result;
  }finally{object.body.destroy();}
}
export async function putPartObject(key:string,bytes:Uint8Array,expectedHash:string,maxBytes:number) {
  if(!key.startsWith('upload-parts/') || !bytes.length || bytes.length>maxBytes || sha256(bytes)!==expectedHash)
    throw new AppError(422,'PART_INTEGRITY','Received part hash/size is invalid.');
  await assertLargeOriginalStorageProfile();
  try {
    await s3().send(new PutObjectCommand({Bucket:settings.s3Bucket,Key:key,Body:bytes,ContentLength:bytes.length,
      ContentType:'application/octet-stream',IfNoneMatch:'*',Metadata:{sha256:expectedHash}}),{abortSignal:AbortSignal.timeout(30000)});
  }catch(error){if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==412)throw error;}
  return verifyObjectStream(key,bytes.length,expectedHash,30000);
}
/** Registered private tile derivatives only; callers reserve the exact bytes before PUT. */
export async function putPrivateMvtObject(key:string,bytes:Uint8Array,expectedHash:string,maxBytes:number,mediaType:string,timeoutMs=10000){
  if(!/^private-mvt\/[a-f0-9]{64}\/[a-f0-9]{64}\/(tiles|maps|manifests)\/[a-f0-9-]+-[a-f0-9]{64}\.(mvt|json)$/.test(key)
    ||!key.endsWith(`-${expectedHash}.${key.endsWith('.mvt')?'mvt':'json'}`)||!Number.isInteger(maxBytes)||maxBytes>2*1024*1024
    ||bytes.length>maxBytes||(!bytes.length&&!key.endsWith('.mvt'))||sha256(bytes)!==expectedHash
    ||!['application/vnd.mapbox-vector-tile','application/json'].includes(mediaType)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)
    throw new AppError(422,'MVT_ASSET_SCOPE','The bounded immutable tile artifact does not match its registered content address.');
  try{await s3().send(new PutObjectCommand({Bucket:settings.s3Bucket,Key:key,Body:bytes,ContentLength:bytes.length,ContentType:mediaType,
    IfNoneMatch:'*',Metadata:{sha256:expectedHash}}),{abortSignal:AbortSignal.timeout(timeoutMs)});}
  catch(error){if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==412)throw error;}
  await verifyObjectStream(key,bytes.length,expectedHash,timeoutMs);
}
const assemblyKey=(key:string)=>{if(!/^large-originals\/[a-f0-9-]{36}\/[a-f0-9]{64}$/.test(key))throw new Error('Invalid server assembly key.');};
/** This receipt profile reclaims payload by overwriting exact keys with permanent empty markers. */
export async function assertLargeOriginalStorageProfile(signal?:AbortSignal) {
  const result=await s3().send(new GetBucketVersioningCommand({Bucket:settings.s3Bucket}),{abortSignal:AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])])});
  if(result.$metadata.httpStatusCode!==200 || result.Status)throw new AppError(503,'UPLOAD_STORAGE_PROFILE','Large-original receipts require a confirmed unversioned private bucket; version history reclamation is unsupported.');
}
/** A single conditional streaming PUT has no independent multipart parts that can outlive abort. */
export async function putOriginalStream(key:string,body:Readable,bytes:number,mime:string,hash:string,signal:AbortSignal) {
  assemblyKey(key);
  if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>128*1024*1024){body.destroy();throw new AppError(422,'UPLOAD_STREAM_LIMIT','The original stream exceeds its bounded storage profile.');}
  try {
    await assertLargeOriginalStorageProfile(signal);
    await s3().send(new PutObjectCommand({Bucket:settings.s3Bucket,Key:key,Body:body,ContentLength:bytes,
      ContentType:mime,IfNoneMatch:'*',Metadata:{sha256:hash}}),{abortSignal:signal});
    return {alreadyExists:false};
  }catch(error){if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==412)throw error;return {alreadyExists:true};}
  finally{body.destroy();}
}
/** Assemble only verified, bounded transport parts; complete conditionally so an abort fence wins. */
export async function putOriginalMultipart(key:string,parts:AsyncIterable<{number:number;bytes:Uint8Array}>,bytes:number,mime:string,
  hash:string,maxBytes:number,maxParts:number,requestMs:number,signal:AbortSignal,onPart:(number:number)=>Promise<void>) {
  assemblyKey(key);
  if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>maxBytes||maxParts<1||maxParts>10000
    ||!Number.isInteger(requestMs)||requestMs<1000||requestMs>60000)
    throw new AppError(422,'UPLOAD_STREAM_LIMIT','The original exceeds its configured multipart storage profile.');
  await assertLargeOriginalStorageProfile(signal);
  const created=await s3().send(new CreateMultipartUploadCommand({Bucket:settings.s3Bucket,Key:key,ContentType:mime,Metadata:{sha256:hash}}),
    {abortSignal:AbortSignal.any([signal,AbortSignal.timeout(requestMs)])});
  if(!created.UploadId)throw new AppError(503,'UPLOAD_STORAGE_PROFILE','Object storage did not allocate a multipart assembly.');
  const uploadId=created.UploadId,completedParts:{PartNumber:number;ETag:string}[]=[],digest=createHash('sha256');
  let total=0,completed=false;
  try{
    for await(const part of parts){
      signal.throwIfAborted();
      if(part.number!==completedParts.length+1||part.number>maxParts||!part.bytes.length||part.bytes.length>8*1024*1024
        ||part.bytes.length<5*1024*1024 && total+part.bytes.length!==bytes)
        throw new AppError(422,'UPLOAD_PART','Multipart assembly requires ordered bounded complete byte parts.');
      total+=part.bytes.length;if(total>bytes)throw new AppError(422,'ORIGINAL_INTEGRITY','Multipart assembly exceeds the admitted size.');
      digest.update(part.bytes);
      const result=await s3().send(new UploadPartCommand({Bucket:settings.s3Bucket,Key:key,UploadId:uploadId,
        PartNumber:part.number,Body:part.bytes,ContentLength:part.bytes.length}),
        {abortSignal:AbortSignal.any([signal,AbortSignal.timeout(requestMs)])});
      if(!result.ETag)throw new AppError(503,'UPLOAD_STORAGE_PROFILE','Object storage returned no multipart part identity.');
      completedParts.push({PartNumber:part.number,ETag:result.ETag});
      await onPart(part.number);
    }
    if(total!==bytes||digest.digest('hex')!==hash)throw new AppError(422,'ORIGINAL_INTEGRITY','Verified transport parts do not match the admitted original hash/size.');
    await onPart(completedParts.length);
    const completing=new AbortController(),completeSignal=AbortSignal.any([signal,completing.signal,AbortSignal.timeout(30*60*1000)]);
    let heartbeat:Promise<void>|undefined,heartbeatFailure:unknown;
    const timer=setInterval(()=>{
      if(heartbeat)return;
      heartbeat=onPart(completedParts.length).catch(error=>{heartbeatFailure=error;completing.abort();}).finally(()=>{heartbeat=undefined;});
    },30000);timer.unref();
    try{
      await s3().send(new CompleteMultipartUploadCommand({Bucket:settings.s3Bucket,Key:key,UploadId:uploadId,
        MultipartUpload:{Parts:completedParts},IfNoneMatch:'*'}),{abortSignal:completeSignal});
      if(heartbeat)await heartbeat;
      if(heartbeatFailure)throw heartbeatFailure;
    }finally{clearInterval(timer);}
    completed=true;
  }finally{
    if(!completed){try{await s3().send(new AbortMultipartUploadCommand({Bucket:settings.s3Bucket,Key:key,UploadId:uploadId}),
      {abortSignal:AbortSignal.timeout(30000)});}catch{/* Exact-key cleanup retries abandoned assemblies. */}}
  }
}
/** Never delete this marker: conditional producers must continue to see an existing key. */
export async function sealUploadObject(key:string,uploadId:string,signal:AbortSignal) {
  if(!/^[a-f0-9-]{36}$/.test(uploadId))throw new Error('Invalid upload tombstone owner.');
  if(!key.startsWith(`upload-parts/${uploadId}/`))assemblyKey(key);
  await assertLargeOriginalStorageProfile(signal);
  await s3().send(new PutObjectCommand({Bucket:settings.s3Bucket,Key:key,Body:Buffer.alloc(0),ContentLength:0,
    ContentType:'application/octet-stream',Metadata:{'upload-tombstone':uploadId}}),{abortSignal:signal});
  await verifyObjectStream(key,0,sha256(Buffer.alloc(0)),30000,undefined,signal);
}
/** Exact server-key cleanup only; never lists a bucket or an arbitrary caller prefix. */
export async function abortOriginalAssemblies(key:string,signal?:AbortSignal) {
  assemblyKey(key);
  const result=await s3().send(new ListMultipartUploadsCommand({Bucket:settings.s3Bucket,Prefix:key,MaxUploads:16}),{abortSignal:AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])])});
  if(result.IsTruncated)throw new AppError(503,'UPLOAD_CLEANUP','Storage assembly cleanup exceeds its bounded inventory.');
  for(const upload of result.Uploads||[])if(upload.Key===key && upload.UploadId)
    await s3().send(new AbortMultipartUploadCommand({Bucket:settings.s3Bucket,Key:key,UploadId:upload.UploadId}),{abortSignal:AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])])});
}
export function objectMissing(error:unknown){return (error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404;}

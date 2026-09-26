import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand, ListMultipartUploadsCommand,
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
) {
  await s3().send(
    new PutObjectCommand({
      Bucket: settings.s3Bucket,
      Key: key,
      Body: bytes,
      ContentType: mimeType,
      IfNoneMatch: "*",
      Metadata: { sha256: sha256(bytes) },
    }),
  );
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
export async function verifyObjectStream(key: string, bytes: number, expectedHash: string, timeoutMs: number, etag?: string,signal?:AbortSignal) {
  const object=await openObjectStream(key,bytes,timeoutMs,etag,signal),hash=createHash('sha256');let count=0;
  try {
    for await(const value of object.body) {
      const chunk=value as Buffer;count+=chunk.length;
      if(count>bytes)throw new AppError(422,'SOURCE_INTEGRITY','Stored object exceeds its source receipt.');
      hash.update(chunk);
    }
    const actual=hash.digest('hex');
    if(count!==bytes || actual!==expectedHash)throw new AppError(422,'SOURCE_INTEGRITY','Stored original hash/size does not match its receipt.');
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
  try {
    await s3().send(new PutObjectCommand({Bucket:settings.s3Bucket,Key:key,Body:bytes,ContentLength:bytes.length,
      ContentType:'application/octet-stream',IfNoneMatch:'*',Metadata:{sha256:expectedHash}}),{abortSignal:AbortSignal.timeout(30000)});
  }catch(error){if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==412)throw error;}
  return verifyObjectStream(key,bytes.length,expectedHash,30000);
}
const assemblyKey=(key:string)=>{if(!/^large-originals\/[a-f0-9-]{36}\/[a-f0-9]{64}$/.test(key))throw new Error('Invalid server assembly key.');};
export async function createOriginalAssembly(key:string,mime:string,hash:string,signal?:AbortSignal) {
  assemblyKey(key);
  const result=await s3().send(new CreateMultipartUploadCommand({Bucket:settings.s3Bucket,Key:key,ContentType:mime,Metadata:{sha256:hash}}),{abortSignal:AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])])});
  if(!result.UploadId)throw new AppError(503,'STORAGE_UPLOAD','The storage upload could not be created.');return result.UploadId;
}
export async function writeAssemblyPart(key:string,uploadId:string,number:number,bytes:Uint8Array,signal?:AbortSignal) {
  assemblyKey(key);
  const result=await s3().send(new UploadPartCommand({Bucket:settings.s3Bucket,Key:key,UploadId:uploadId,PartNumber:number,Body:bytes,ContentLength:bytes.length}),{abortSignal:AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])])});
  if(!result.ETag)throw new AppError(503,'STORAGE_UPLOAD','A storage part lacks its completion receipt.');return {PartNumber:number,ETag:result.ETag};
}
export async function finishOriginalAssembly(key:string,uploadId:string,parts:{PartNumber:number;ETag:string}[],signal?:AbortSignal) {
  assemblyKey(key);
  return s3().send(new CompleteMultipartUploadCommand({Bucket:settings.s3Bucket,Key:key,UploadId:uploadId,MultipartUpload:{Parts:parts},IfNoneMatch:'*'}),{abortSignal:AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])])});
}
export async function abortOriginalAssembly(key:string,uploadId:string){assemblyKey(key);await s3().send(new AbortMultipartUploadCommand({Bucket:settings.s3Bucket,Key:key,UploadId:uploadId}),{abortSignal:AbortSignal.timeout(30000)});}
/** Exact server-key cleanup only; never lists a bucket or an arbitrary caller prefix. */
export async function abortOriginalAssemblies(key:string,signal?:AbortSignal) {
  assemblyKey(key);
  const result=await s3().send(new ListMultipartUploadsCommand({Bucket:settings.s3Bucket,Prefix:key,MaxUploads:16}),{abortSignal:AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])])});
  if(result.IsTruncated)throw new AppError(503,'UPLOAD_CLEANUP','Storage assembly cleanup exceeds its bounded inventory.');
  for(const upload of result.Uploads||[])if(upload.Key===key && upload.UploadId)
    await s3().send(new AbortMultipartUploadCommand({Bucket:settings.s3Bucket,Key:key,UploadId:upload.UploadId}),{abortSignal:AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])])});
}
export function objectMissing(error:unknown){return (error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404;}

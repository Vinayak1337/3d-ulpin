import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Readable } from 'node:stream';
import { z } from 'zod';
import {
  LARGE_ORIGINAL_LIMITS as limits, LARGE_ORIGINAL_V2_LIMITS as v2Limits, LargeUploadCreateSchema, LargeUploadGuardSchema, LargeUploadFinalizeSchema,
  LargeUploadPartSchema, LargeUploadStatusSchema, LargeOriginalEvidenceSchema, type LargeUploadGuard,
} from '@ulpin/contracts/usp';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { sha256, putPartObject, readPartObject, verifyObjectStream, putOriginalStream, putOriginalMultipart, sealUploadObject, assertLargeOriginalStorageProfile, abortOriginalAssemblies, objectMissing } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { localOperatorSubject } from '../principal';
import { lockUnassignedSourceCase } from './service';
import { appendCaseIngestionTx } from './events';

const uuid=z.string().uuid(),lease=()=>new Date(Date.now()+limits.leaseSeconds*1000);
type Upload=Record<string,any>;
const v2=(upload:Upload)=>upload.body.input.profile==='large-original/2';
function configuredV2Capacity(){
  const raw=process.env.ULPIN_LARGE_ORIGINAL_V2_CAPACITY_BYTES;
  const bytes=raw&&/^\d+$/.test(raw)?Number(raw):0;
  return Number.isSafeInteger(bytes)&&bytes>=3*(16*1024*1024+1)?bytes:0;
}
const objectKey=(upload:Upload)=>`large-originals/${upload.source_id}/${upload.body.input.sha256}`;
const busy=(message:string)=>{throw new AppError(409,'UPLOAD_BUSY',message);};
const iso=(value:Date|string)=>new Date(value).toISOString();
async function caseRow(client:PoolClient,id:string){
  const row=(await client.query('SELECT id,revision FROM cases WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row)notFound('Source case not found.');return row;
}
async function load(client:PoolClient,caseId:string,id:string){
  const upload=(await client.query('SELECT * FROM usp_source_uploads WHERE id=$1 AND case_id=$2 FOR UPDATE',[id,caseId])).rows[0];
  if(!upload)notFound('Source upload not found in this case.');
  if(upload.operator_subject!==localOperatorSubject())throw new AppError(403,'UPLOAD_OPERATOR','This upload belongs to another configured local operator context.');
  return upload as Upload;
}
async function status(client:PoolClient,upload:Upload,currentCaseRevision:number){
  const parts=(await client.query('SELECT * FROM usp_source_upload_parts WHERE upload_id=$1 ORDER BY part_number',[upload.id])).rows;
  return LargeUploadStatusSchema.parse({version:v2(upload)?v2Limits.version:limits.version,id:upload.id,caseId:upload.case_id,revision:upload.revision,
    currentCaseRevision,pinnedCaseRevision:upload.case_revision,state:upload.state,operatorSubject:upload.operator_subject,
    filename:upload.body.input.filename,mediaType:upload.body.input.mediaType,bytes:Number(upload.original_bytes),
    declaredSha256:upload.body.input.sha256,verifiedSha256:upload.body.verified?.sha256||null,partBytes:limits.partBytes,
    partCount:Math.ceil(Number(upload.original_bytes)/limits.partBytes),receivedBytes:parts.filter(p=>p.state==='received').reduce((n,p)=>n+p.bytes,0),
    expiresAt:iso(upload.expires_at),parts:parts.map(p=>({partNumber:p.part_number,bytes:p.bytes,state:p.state,sha256:p.sha256,
      requestKey:p.request_key,attempts:p.attempts,leaseExpiresAt:p.lease_expires_at?iso(p.lease_expires_at):null})),
    source:upload.state==='retained'?{sourceId:upload.source_id,sourceRevision:1,sha256:upload.body.verified.sha256,bytes:Number(upload.original_bytes)}:null,
    conversion:'unsupported',bundleCompleteness:'single_original_only_archive_dependencies_not_assessed',
    cleanupPending:upload.body.cleanupPending,lastError:upload.body.lastError||null,
    ...(v2(upload)&&upload.body.storageJobId?{finalization:{jobId:upload.body.storageJobId,
      phase:!upload.body.cleanupPending?'complete':upload.state==='retained'||upload.state==='aborting'||upload.state==='aborted'?'cleaning':upload.body.finalizationPhase||'queued',
      completedParts:upload.body.completedParts||0}}:{})});
}
async function guard(client:PoolClient,upload:Upload,input:LargeUploadGuard,currentRevision:number,unassigned=true){
  if(input.expectedRevision!==upload.revision || input.expectedCaseRevision!==currentRevision)conflict('Upload or case revision changed; read current status before continuing.');
  if(unassigned){
    const scope=await lockUnassignedSourceCase(client,upload.case_id);
    if(scope.revision!==upload.case_revision)conflict('The source case changed after upload admission; abort this receipt or refresh its current context.');
  }
}
function receiving(upload:Upload){
  if(upload.state!=='receiving')throw new AppError(409,'UPLOAD_STATE','Only an open byte receipt accepts parts or finalization.');
  if(new Date(upload.expires_at).getTime()<=Date.now())throw new AppError(410,'UPLOAD_EXPIRED','The receipt expired; use its scoped abort/cleanup action.');
}
async function save(client:PoolClient,upload:Upload){
  await client.query('UPDATE usp_source_uploads SET revision=$2,case_revision=$3,state=$4,body=$5,lease_token=$6,lease_expires_at=$7,finalize_attempts=$8 WHERE id=$1',
    [upload.id,upload.revision,upload.case_revision,upload.state,upload.body,upload.lease_token||null,upload.lease_expires_at||null,upload.finalize_attempts]);
  await uploadEvent(client,upload);
}
async function uploadEvent(client:PoolClient,upload:Upload){
  await appendCaseIngestionTx(client,upload.case_id,{kind:'upload.changed',uploadId:upload.id,uploadRevision:upload.revision,status:upload.state},upload.operator_subject);
}
async function failure(id:string,token:string,code:string){
  await transaction(async client=>{
    const row=(await client.query('SELECT * FROM usp_source_uploads WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(row?.state==='finalizing' && row.lease_token===token){row.state='receiving';row.lease_token=null;row.lease_expires_at=null;row.body.lastError=code;row.revision++;await save(client,row);}
  });
}
async function queueV2JobTx(client:PoolClient,upload:Upload){
  const jobId=upload.body.storageJobId||randomUUID();
  if(!upload.body.storageJobId){
    upload.body.storageJobId=jobId;
    await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload)
      VALUES($1,$2,NULL,'large-original-storage',$3,$4,$5)`,
      [jobId,upload.case_id,upload.case_revision,upload.body.input.sha256,{uploadId:upload.id,profile:v2Limits.version}]);
  }else await client.query("UPDATE jobs SET status='queued',attempts=0,next_attempt_at=now(),error=NULL,completed_at=NULL WHERE id=$1 AND operation='large-original-storage'",
    [jobId]);
  return jobId;
}

export const largeOriginalStorage={putPartObject,readPartObject,verifyObjectStream,putOriginalStream,putOriginalMultipart,sealUploadObject,assertLargeOriginalStorageProfile,abortOriginalAssemblies};

/** Durable byte-receipt metadata beside the existing source authority; v2 finalization uses the canonical dispatcher. */
export class LargeOriginalService {
  constructor(private readonly storage=largeOriginalStorage){}
  capacity(){const configuredBytes=configuredV2Capacity();return {available:configuredBytes>0,
    fullCeilingConfigured:configuredBytes>=v2Limits.maxStoredBytesIncludingTemporaryCopies,configuredBytes,
    requiredBytes:v2Limits.maxStoredBytesIncludingTemporaryCopies};}
  async create(caseIdValue:string,value:unknown){
    const caseId=uuid.parse(caseIdValue),input=LargeUploadCreateSchema.parse(value),subject=localOperatorSubject(),digest=fingerprint(input);
    const isV2=input.profile==='large-original/2',configuredBytes=configuredV2Capacity();
    if(isV2&&!configuredBytes)throw new AppError(503,'UPLOAD_CAPACITY_UNCONFIGURED','The large-original/2 storage reservation is not configured on this service.');
    await this.storage.assertLargeOriginalStorageProfile();
    return transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('large-original-quota-v1',0))");
      const current=await caseRow(client,caseId);
      const prior=(await client.query('SELECT * FROM usp_source_uploads WHERE case_id=$1 AND operator_subject=$2 AND request_key=$3',[caseId,subject,input.requestKey])).rows[0];
      if(prior){if(prior.request_hash!==digest)conflict('This upload request key already names different original inputs.');return status(client,prior,current.revision);}
      const scope=await lockUnassignedSourceCase(client,caseId);
      if(scope.revision!==input.expectedCaseRevision)conflict('The source case changed before upload admission.');
      const quota=(await client.query(`SELECT
        count(*) FILTER(WHERE COALESCE(body->'input'->>'profile','large-original/1')='large-original/1')::int v1_receipts,
        count(*) FILTER(WHERE body->'input'->>'profile'='large-original/2')::int v2_receipts,
        count(*) FILTER(WHERE state IN('receiving','finalizing','aborting') AND COALESCE(body->'input'->>'profile','large-original/1')='large-original/1')::int v1_active,
        count(*) FILTER(WHERE state IN('receiving','finalizing','aborting') AND body->'input'->>'profile'='large-original/2')::int v2_active,
        count(*) FILTER(WHERE state IN('receiving','finalizing','aborting') AND case_id=$1 AND COALESCE(body->'input'->>'profile','large-original/1')='large-original/1')::int case_active,
        count(*) FILTER(WHERE state IN('receiving','finalizing','aborting') AND operator_subject=$2 AND COALESCE(body->'input'->>'profile','large-original/1')='large-original/1')::int operator_active,
        COALESCE(sum(original_bytes) FILTER(WHERE state<>'aborted' AND COALESCE(body->'input'->>'profile','large-original/1')='large-original/1'),0)::bigint v1_reserved,
        COALESCE(sum(original_bytes) FILTER(WHERE state<>'aborted' AND body->'input'->>'profile'='large-original/2'),0)::bigint v2_reserved
        FROM usp_source_uploads`,[caseId,subject])).rows[0];
      const v1Reserved=Number(quota.v1_reserved)+(isV2?0:input.bytes),v2Reserved=Number(quota.v2_reserved)+(isV2?input.bytes:0);
      if((isV2?(quota.v2_receipts>=v2Limits.maxUploadReceipts||quota.v2_active>=v2Limits.maxActiveGlobal||v2Reserved>v2Limits.maxReservedOriginalBytes)
          :(quota.v1_receipts>=limits.maxUploadReceipts||quota.v1_active>=limits.maxActiveGlobal||quota.case_active>=limits.maxActivePerCase
            ||quota.operator_active>=limits.maxActivePerOperator||v1Reserved>limits.maxReservedOriginalBytes))
        || configuredBytes>0 && 2*v1Reserved+3*v2Reserved>configuredBytes)
        throw new AppError(429,'UPLOAD_QUOTA','The bounded active-upload or retained/temporary storage allowance is full; finish or safely abort an owned receipt.');
      const id=randomUUID(),sourceId=randomUUID(),expiresAt=new Date(Date.now()+(isV2?v2Limits:limits).uploadLifetimeSeconds*1000);
      const body={input,cleanupPending:true,lastError:null};
      const upload=(await client.query(`INSERT INTO usp_source_uploads(id,case_id,operator_subject,request_key,request_hash,revision,case_revision,state,source_id,original_bytes,body,expires_at)
        VALUES($1,$2,$3,$4,$5,1,$6,'receiving',$7,$8,$9,$10) RETURNING *`,[id,caseId,subject,input.requestKey,digest,current.revision,sourceId,input.bytes,body,expiresAt])).rows[0];
      await uploadEvent(client,upload);
      return status(client,upload,current.revision);
    });
  }
  async read(caseIdValue:string,idValue:string){
    const caseId=uuid.parse(caseIdValue),id=uuid.parse(idValue);
    return transaction(async client=>{const current=await caseRow(client,caseId);return status(client,await load(client,caseId,id),current.revision);});
  }
  async claimPart(caseIdValue:string,idValue:string,value:unknown){
    const caseId=uuid.parse(caseIdValue),id=uuid.parse(idValue),input=LargeUploadPartSchema.parse(value);
    return transaction(async client=>{
      const current=await caseRow(client,caseId),upload=await load(client,caseId,id);receiving(upload);
      const count=Math.ceil(Number(upload.original_bytes)/limits.partBytes);
      if(input.partNumber>count)throw new AppError(422,'UPLOAD_PART','Choose a declared byte part of this original.');
      const bytes=Math.min(limits.partBytes,Number(upload.original_bytes)-(input.partNumber-1)*limits.partBytes);
      const prior=(await client.query('SELECT * FROM usp_source_upload_parts WHERE upload_id=$1 AND part_number=$2 FOR UPDATE',[id,input.partNumber])).rows[0];
      if(prior && (prior.request_key!==input.requestKey || prior.sha256!==input.sha256))conflict('This part has a different immutable request/hash binding; resume its saved request or abort the receipt.');
      if(prior?.state==='received'){
        if(input.expectedCaseRevision!==current.revision || upload.case_revision!==current.revision)conflict('The source case changed before replay.');
        await lockUnassignedSourceCase(client,caseId);return {uploadId:id,caseId,input,bytes,token:null,key:prior.object_key};
      }
      await guard(client,upload,input,current.revision);
      if(prior?.state==='writing' && new Date(prior.lease_expires_at).getTime()>Date.now())busy('This byte part is still being received; use status before resuming.');
      if((await client.query("SELECT 1 FROM usp_source_upload_parts WHERE upload_id=$1 AND state='writing' AND lease_expires_at>now() AND part_number<>$2",[id,input.partNumber])).rowCount)
        busy('Only one byte part may be received per upload at a time.');
      if(prior?.attempts>=limits.maxPartAttempts)throw new AppError(429,'PART_ATTEMPTS','This part reached its bounded attempt limit; safely abort the receipt.');
      const reused=(await client.query('SELECT part_number FROM usp_source_upload_parts WHERE upload_id=$1 AND request_key=$2',[id,input.requestKey])).rows[0];
      if(reused && reused.part_number!==input.partNumber)conflict('This request key already names another part.');
      const token=randomUUID(),key=`upload-parts/${id}/${input.partNumber}/${input.sha256}`,expires=lease();
      await client.query(`INSERT INTO usp_source_upload_parts(upload_id,part_number,request_key,sha256,bytes,object_key,state,attempts,lease_token,lease_expires_at)
        VALUES($1,$2,$3,$4,$5,$6,'writing',1,$7,$8) ON CONFLICT(upload_id,part_number) DO UPDATE SET state='writing',attempts=usp_source_upload_parts.attempts+1,lease_token=$7,lease_expires_at=$8`,
        [id,input.partNumber,input.requestKey,input.sha256,bytes,key,token,expires]);
      upload.revision++;await save(client,upload);return {uploadId:id,caseId,input,bytes,token,key};
    });
  }
  async receivePart(claim:Awaited<ReturnType<LargeOriginalService['claimPart']>>,bytes:Uint8Array){
    if(bytes.length!==claim.bytes || sha256(bytes)!==claim.input.sha256)throw new AppError(422,'PART_INTEGRITY','Actual received bytes/hash do not match this byte part.');
    if(claim.token){
      // A stale admitted producer must revalidate before I/O. The subsequent storage condition
      // also protects the check/write window: cleanup leaves an immutable zero-payload tombstone.
      await transaction(async client=>{
        const scope=await lockUnassignedSourceCase(client,claim.caseId),upload=await load(client,claim.caseId,claim.uploadId);receiving(upload);
        if(scope.revision!==upload.case_revision)conflict('The source case changed before byte-part storage.');
        if(!(await client.query("SELECT 1 FROM usp_source_upload_parts WHERE upload_id=$1 AND part_number=$2 AND state='writing' AND lease_token=$3 AND lease_expires_at>now()",[claim.uploadId,claim.input.partNumber,claim.token])).rowCount)
          conflict('The byte-part producer lease expired or was superseded before storage.');
      });
      await this.storage.putPartObject(claim.key,bytes,claim.input.sha256,limits.partBytes);
    }
    return transaction(async client=>{
      const current=await caseRow(client,claim.caseId),upload=await load(client,claim.caseId,claim.uploadId);receiving(upload);
      const scope=await lockUnassignedSourceCase(client,claim.caseId);
      if(scope.revision!==upload.case_revision)conflict('The source case changed while this byte part was stored.');
      if(claim.token){
        const accepted=await client.query("UPDATE usp_source_upload_parts SET state='received',lease_token=NULL,lease_expires_at=NULL WHERE upload_id=$1 AND part_number=$2 AND state='writing' AND lease_token=$3 AND lease_expires_at>now()",[claim.uploadId,claim.input.partNumber,claim.token]);
        if(!accepted.rowCount)conflict('This byte-part attempt expired or was superseded.');
        upload.revision++;upload.body.lastError=null;await save(client,upload);
      }
      return status(client,upload,current.revision);
    });
  }
  async failPart(claim:Awaited<ReturnType<LargeOriginalService['claimPart']>>){
    if(!claim.token)return;
    await transaction(async client=>{
      const upload=(await client.query('SELECT * FROM usp_source_uploads WHERE id=$1 FOR UPDATE',[claim.uploadId])).rows[0];
      const failed=await client.query("UPDATE usp_source_upload_parts SET state='failed',lease_token=NULL,lease_expires_at=NULL WHERE upload_id=$1 AND part_number=$2 AND state='writing' AND lease_token=$3",[claim.uploadId,claim.input.partNumber,claim.token]);
      if(failed.rowCount){upload.revision++;upload.body.lastError='PART_INTERRUPTED_OR_REJECTED';await save(client,upload);}
    });
  }
  async finalize(caseIdValue:string,idValue:string,value:unknown){
    const caseId=uuid.parse(caseIdValue),id=uuid.parse(idValue),input=LargeUploadFinalizeSchema.parse(value),inputHash=fingerprint(input);
    const claim=await transaction(async client=>{
      const current=await caseRow(client,caseId),upload=await load(client,caseId,id);
      if(upload.state==='retained' && upload.body.finalizeInputHash===inputHash)return {receipt:await status(client,upload,current.revision)};
      if(v2(upload)&&upload.state==='finalizing'&&upload.body.finalizeInputHash===inputHash)
        return {receipt:await status(client,upload,current.revision)};
      await guard(client,upload,input,current.revision);
      if(input.sha256!==upload.body.input.sha256)throw new AppError(422,'ORIGINAL_HASH','Finalization must name the admitted original hash.');
      if(upload.state==='finalizing'){
        if(new Date(upload.lease_expires_at).getTime()>Date.now())busy('Original finalization is still active; resume from status.');
        upload.state='receiving';
      }
      receiving(upload);
      const parts=(await client.query("SELECT * FROM usp_source_upload_parts WHERE upload_id=$1 ORDER BY part_number",[id])).rows;
      const count=Math.ceil(Number(upload.original_bytes)/limits.partBytes);
      if(parts.length!==count || parts.some((p,i)=>p.state!=='received'||p.part_number!==i+1)
        || parts.reduce((n,p)=>n+p.bytes,0)!==Number(upload.original_bytes))throw new AppError(409,'ORIGINAL_INCOMPLETE','All declared byte parts and their exact sizes must be received before finalization.');
      if(upload.finalize_attempts>=limits.maxFinalizationAttempts)throw new AppError(429,'FINALIZATION_ATTEMPTS','Finalization reached its bounded attempt limit; safely abort this receipt.');
      if(v2(upload)){
        upload.state='finalizing';upload.body.finalizeInputHash=inputHash;upload.body.finalizationPhase='queued';upload.body.completedParts=0;
        upload.revision++;await queueV2JobTx(client,upload);await save(client,upload);
        return {receipt:await status(client,upload,current.revision)};
      }
      const token=randomUUID();upload.state='finalizing';upload.lease_token=token;upload.lease_expires_at=lease();upload.finalize_attempts++;upload.revision++;
      upload.body.finalizeInputHash=inputHash;await save(client,upload);return {upload,parts,token};
    });
    if('receipt'in claim)return claim.receipt;
    const {upload,parts,token}=claim,key=objectKey(upload),signal=AbortSignal.timeout(limits.finalizationSeconds*1000);
    try{
      let verified;
      // A crash after object completion but before DB publication resumes by verifying the same immutable object.
      try{verified=await this.storage.verifyObjectStream(key,Number(upload.original_bytes),upload.body.input.sha256,limits.finalizationSeconds*1000,undefined,signal);}
      catch(error){if(!objectMissing(error))throw error;}
      if(!verified){
        await this.storage.assertLargeOriginalStorageProfile(signal);
        const hash=createHash('sha256');let total=0;
        for(const part of parts){
          signal.throwIfAborted();const bytes=await this.storage.readPartObject(part.object_key,part.bytes,part.sha256,limits.partBytes,signal);
          hash.update(bytes);total+=bytes.length;
        }
        if(total!==Number(upload.original_bytes) || hash.digest('hex')!==upload.body.input.sha256)
          throw new AppError(422,'ORIGINAL_INTEGRITY','Server-computed original hash/size does not match the admitted original. No source was published.');
        await transaction(async client=>{
          const scope=await lockUnassignedSourceCase(client,caseId),fresh=await load(client,caseId,id);
          if(fresh.state!=='finalizing'||fresh.lease_token!==token||new Date(fresh.lease_expires_at).getTime()<=Date.now()||scope.revision!==fresh.case_revision)
            conflict('The upload/case fence changed before original storage.');
        });
        const storage=this.storage;
        // Re-read bounded parts under backpressure; no complete original Buffer exists.
        const body=Readable.from((async function*(){
          const hash=createHash('sha256');let total=0;
          for(const part of parts){const bytes=await storage.readPartObject(part.object_key,part.bytes,part.sha256,limits.partBytes,signal);total+=bytes.length;hash.update(bytes);yield bytes;}
          if(total!==Number(upload.original_bytes)||hash.digest('hex')!==upload.body.input.sha256)
            throw new AppError(422,'ORIGINAL_INTEGRITY','The streaming original changed after preflight.');
        })(),{objectMode:false,highWaterMark:64*1024});
        await storage.putOriginalStream(key,body,Number(upload.original_bytes),upload.body.input.mediaType,upload.body.input.sha256,signal);
        verified=await storage.verifyObjectStream(key,Number(upload.original_bytes),upload.body.input.sha256,limits.finalizationSeconds*1000,undefined,signal);
      }
      const receipt=await transaction(async client=>{
        const scope=await lockUnassignedSourceCase(client,caseId),fresh=await load(client,caseId,id);
        if(fresh.state!=='finalizing'||fresh.lease_token!==token||new Date(fresh.lease_expires_at).getTime()<=Date.now()||scope.revision!==fresh.case_revision)
          conflict('The upload/case fence changed before original publication; retained bytes remain unreachable until reconciliation.');
        const inspection={profile:'large-original-v1',status:'needs_input',issues:[],summary:'Original bytes retained and hash-verified. Conversion is unsupported; no parsing, placement, approval or publication of semantic records occurred.',
          largeOriginal:LargeOriginalEvidenceSchema.parse({uploadId:id,operatorSubject:fresh.operator_subject,objectEtag:verified!.etag,verifiedSha256:verified!.sha256,verifiedBytes:verified!.bytes,
            provenance:{...fresh.body.input.provenance,state:'caller_declared'},conversion:'unsupported',bundleCompleteness:'single_original_only_archive_dependencies_not_assessed'})};
        await client.query("INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status,inspection) VALUES($1,$2,$1,1,$3,'large-original-v1',$4,$5,$6,$7,'needs_input',$8)",
          [fresh.source_id,caseId,fresh.body.input.filename,fresh.body.input.mediaType,fresh.original_bytes,verified!.sha256,key,inspection]);
        await client.query('UPDATE cases SET revision=revision+1,updated_at=now() WHERE id=$1',[caseId]);
        fresh.case_revision=scope.revision+1;fresh.state='retained';fresh.body.verified=verified;fresh.body.lastError=null;fresh.lease_token=null;fresh.lease_expires_at=null;fresh.revision++;
        await save(client,fresh);return status(client,fresh,fresh.case_revision);
      });
      // Temporary parts are never source originals. Failed reclamation remains explicitly pending.
      try{return await this.cleanup(caseId,id,{requestKey:randomUUID(),expectedRevision:receipt.revision,expectedCaseRevision:receipt.currentCaseRevision});}catch{return receipt;}
    }catch(error){
      await failure(id,token,error instanceof AppError?error.code:'FINALIZATION_INTERRUPTED');throw error;
    }
  }
  async abort(caseIdValue:string,idValue:string,value:unknown){
    const caseId=uuid.parse(caseIdValue),id=uuid.parse(idValue),input=LargeUploadGuardSchema.parse(value),digest=fingerprint(input);
    const receipt=await transaction(async client=>{
      const current=await caseRow(client,caseId),upload=await load(client,caseId,id);
      if(upload.state==='retained')throw new AppError(409,'ORIGINAL_RETAINED','A retained original cannot be aborted or deleted through this upload receipt.');
      if(upload.body.abortInputHash===digest && ['aborting','aborted'].includes(upload.state))return status(client,upload,current.revision);
      await guard(client,upload,input,current.revision,false);
      if(['aborting','aborted'].includes(upload.state))return status(client,upload,current.revision);
      upload.state='aborting';upload.body.abortInputHash=digest;upload.revision++;
      if(v2(upload))await queueV2JobTx(client,upload);
      await save(client,upload);return status(client,upload,current.revision);
    });
    if(receipt.state==='aborted'||receipt.version===v2Limits.version)return receipt;
    return this.cleanup(caseId,id,{requestKey:randomUUID(),expectedRevision:receipt.revision,expectedCaseRevision:receipt.currentCaseRevision});
  }
  async cleanup(caseIdValue:string,idValue:string,value:unknown){
    const caseId=uuid.parse(caseIdValue),id=uuid.parse(idValue),input=LargeUploadGuardSchema.parse(value),digest=fingerprint(input);
    const claim=await transaction(async client=>{
      const current=await caseRow(client,caseId),upload=await load(client,caseId,id);
      if(upload.body.cleanupRequestKey===input.requestKey && upload.body.cleanupInputHash!==digest)
        conflict('This cleanup request key already names a different immutable request.');
      const retry=upload.body.cleanupInputHash===digest;
      if(retry && !upload.body.cleanupPending)return {receipt:await status(client,upload,current.revision)};
      if(!retry)await guard(client,upload,input,current.revision,false);
      if(!['retained','aborting','aborted'].includes(upload.state))throw new AppError(409,'UPLOAD_CLEANUP','Abort an incomplete receipt before reclaiming its temporary objects.');
      if(!upload.body.cleanupPending)return {receipt:await status(client,upload,current.revision)};
      if(v2(upload)){
        if(upload.lease_expires_at && new Date(upload.lease_expires_at).getTime()>Date.now())
          return {receipt:await status(client,upload,current.revision)};
        upload.body.cleanupInputHash=digest;upload.body.cleanupRequestKey=input.requestKey;upload.revision++;
        await queueV2JobTx(client,upload);await save(client,upload);
        return {receipt:await status(client,upload,current.revision)};
      }
      const writing=(await client.query("SELECT 1 FROM usp_source_upload_parts WHERE upload_id=$1 AND state='writing' AND lease_expires_at>now()",[id])).rowCount;
      if(writing || upload.lease_expires_at && new Date(upload.lease_expires_at).getTime()>Date.now())return {receipt:await status(client,upload,current.revision)};
      const token=randomUUID();upload.lease_token=token;upload.lease_expires_at=lease();upload.body.cleanupInputHash=digest;upload.body.cleanupRequestKey=input.requestKey;upload.revision++;await save(client,upload);
      const parts=(await client.query('SELECT object_key FROM usp_source_upload_parts WHERE upload_id=$1',[id])).rows;
      return {upload,parts,token};
    });
    if('receipt'in claim)return claim.receipt;
    const {upload,parts,token}=claim;
    const signal=AbortSignal.timeout(limits.cleanupSeconds*1000);
    try{
      await this.storage.assertLargeOriginalStorageProfile(signal);
      if(parts.length && (await query('SELECT id FROM sources WHERE object_key=ANY($1::text[])',[parts.map(p=>p.object_key)])).rowCount)
        throw new AppError(409,'ORIGINAL_RETAINED','Cleanup cannot replace a canonical original with a tombstone.');
      for(const part of parts){
        if(!part.object_key.startsWith(`upload-parts/${id}/`))throw new AppError(503,'UPLOAD_CLEANUP','Temporary object ownership does not match this receipt.');
        await this.storage.sealUploadObject(part.object_key,id,AbortSignal.any([signal,AbortSignal.timeout(limits.storageRequestSeconds*1000)]));
      }
      if(upload.state!=='retained'){
        if((await query('SELECT id FROM sources WHERE id=$1 OR object_key=$2',[upload.source_id,objectKey(upload)])).rowCount)
          throw new AppError(409,'ORIGINAL_RETAINED','Cleanup cannot replace a canonical retained original.');
        await this.storage.sealUploadObject(objectKey(upload),id,AbortSignal.any([signal,AbortSignal.timeout(limits.storageRequestSeconds*1000)]));
      }
      // Old pinned implementations used MPU. Its exact key remains durably owned and fenced.
      await this.storage.abortOriginalAssemblies(objectKey(upload),signal);
      return transaction(async client=>{
        const current=await caseRow(client,caseId),fresh=await load(client,caseId,id);
        if(fresh.lease_token!==token)conflict('This cleanup attempt was superseded.');
        if(fresh.state==='aborting')fresh.state='aborted';
        fresh.body.cleanupPending=false;fresh.body.lastError=null;fresh.lease_token=null;fresh.lease_expires_at=null;fresh.revision++;await save(client,fresh);return status(client,fresh,current.revision);
      });
    }catch(error){
      await transaction(async client=>{const fresh=(await client.query('SELECT * FROM usp_source_uploads WHERE id=$1 FOR UPDATE',[id])).rows[0];if(fresh.lease_token===token){fresh.lease_token=null;fresh.lease_expires_at=null;fresh.body.lastError='CLEANUP_PENDING';fresh.revision++;await save(client,fresh);}});throw error;
    }
  }
  /** A dispatcher-owned attempt. The upload row is the cancellation/lease fence; jobs supplies scheduling. */
  async runV2Job(jobId:string){
    const pointer=(await query("SELECT case_id,payload FROM jobs WHERE id=$1 AND operation='large-original-storage'",[jobId])).rows[0];
    if(!pointer)return;
    const caseId=uuid.parse(pointer.case_id),id=uuid.parse(pointer.payload.uploadId);
    const claim=await transaction(async client=>{
      const current=await caseRow(client,caseId),upload=await load(client,caseId,id);
      const job=(await client.query("SELECT * FROM jobs WHERE id=$1 AND operation='large-original-storage' FOR UPDATE",[jobId])).rows[0];
      if(!job||!['queued','running'].includes(job.status)||upload.body.storageJobId!==jobId||!v2(upload))return null;
      if(!['finalizing','retained','aborting','aborted'].includes(upload.state)||!upload.body.cleanupPending){
        await client.query("UPDATE jobs SET status='failed',error='UPLOAD_STATE',completed_at=now() WHERE id=$1",[jobId]);return null;
      }
      if(upload.lease_expires_at && new Date(upload.lease_expires_at).getTime()>Date.now()){
        await client.query("UPDATE jobs SET next_attempt_at=$2 WHERE id=$1",[jobId,upload.lease_expires_at]);return null;
      }
      const cleaning=upload.state!=='finalizing';
      if(cleaning){
        const writing=(await client.query("SELECT min(lease_expires_at) expires FROM usp_source_upload_parts WHERE upload_id=$1 AND state='writing' AND lease_expires_at>now()",[id])).rows[0];
        if(writing.expires){await client.query('UPDATE jobs SET next_attempt_at=$2 WHERE id=$1',[jobId,writing.expires]);return null;}
      }else if(upload.finalize_attempts>=v2Limits.maxFinalizationAttempts){
        upload.state='receiving';upload.body.lastError='FINALIZATION_ATTEMPTS';upload.lease_token=null;upload.lease_expires_at=null;upload.revision++;
        await save(client,upload);await client.query("UPDATE jobs SET status='failed',error='FINALIZATION_ATTEMPTS',completed_at=now() WHERE id=$1",[jobId]);return null;
      }
      const token=randomUUID();upload.lease_token=token;upload.lease_expires_at=new Date(Date.now()+v2Limits.leaseSeconds*1000);
      if(!cleaning){
        if(current.revision!==upload.case_revision){upload.state='receiving';upload.body.lastError='SOURCE_CONTEXT_CHANGED';upload.lease_token=null;upload.lease_expires_at=null;
          upload.revision++;await save(client,upload);await client.query("UPDATE jobs SET status='failed',error='SOURCE_CONTEXT_CHANGED',completed_at=now() WHERE id=$1",[jobId]);return null;}
        upload.finalize_attempts++;upload.body.finalizationPhase='assembling';upload.body.completedParts=0;
      }else upload.body.finalizationPhase='cleaning';
      upload.revision++;await save(client,upload);
      await client.query("UPDATE jobs SET status='running',dispatched_at=COALESCE(dispatched_at,now()),next_attempt_at=now()+interval '180 seconds',error=NULL WHERE id=$1",[jobId]);
      const parts=(await client.query('SELECT * FROM usp_source_upload_parts WHERE upload_id=$1 ORDER BY part_number',[id])).rows;
      return {upload,parts,token,cleaning};
    });
    if(!claim)return;
    const {upload,parts,token,cleaning}=claim,signal=AbortSignal.timeout((cleaning?v2Limits.cleanupSeconds:v2Limits.finalizationSeconds)*1000);
    try{
      if(cleaning)await this.finishV2Cleanup(jobId,upload,parts,token,signal);
      else{
        await this.finishV2Assembly(jobId,upload,parts,token,signal);
        const current=(await query('SELECT * FROM usp_source_uploads WHERE id=$1',[id])).rows[0];
        if(current?.state==='retained'&&current.lease_token===token)
          await this.finishV2Cleanup(jobId,current,parts,token,signal);
      }
    }catch(error){await this.failV2Job(jobId,id,token,error);}
  }
  private async renewV2(id:string,token:string,state:string,phase:string,completedParts:number,cleanupCursor?:number){
    return transaction(async client=>{
      const upload=(await client.query('SELECT * FROM usp_source_uploads WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!upload||upload.state!==state||upload.lease_token!==token||!upload.lease_expires_at||new Date(upload.lease_expires_at).getTime()<=Date.now())
        conflict('The large-original worker lease or cancellation fence changed.');
      if(state==='finalizing'){
        const current=(await client.query('SELECT revision FROM cases WHERE id=$1',[upload.case_id])).rows[0];
        if(current?.revision!==upload.case_revision)conflict('The source case changed before original publication.');
      }
      upload.body.finalizationPhase=phase;upload.body.completedParts=completedParts;
      if(cleanupCursor!==undefined)upload.body.cleanupCursor=cleanupCursor;
      await client.query('UPDATE usp_source_uploads SET body=$2,lease_expires_at=$3 WHERE id=$1',
        [id,upload.body,new Date(Date.now()+v2Limits.leaseSeconds*1000)]);
    });
  }
  private async finishV2Assembly(jobId:string,upload:Upload,parts:Upload[],token:string,signal:AbortSignal){
    const id=upload.id,key=objectKey(upload),size=Number(upload.original_bytes),expected=upload.body.input.sha256;
    const count=Math.ceil(size/v2Limits.partBytes);
    if(parts.length!==count||parts.some((p,i)=>p.state!=='received'||p.part_number!==i+1
      ||p.bytes!==Math.min(v2Limits.partBytes,size-i*v2Limits.partBytes)))
      throw new AppError(409,'ORIGINAL_INCOMPLETE','All declared byte parts must still be received and exact before assembly.');
    let verified:Awaited<ReturnType<typeof verifyObjectStream>>|undefined;
    const progress=async()=>this.renewV2(id,token,'finalizing','verifying',parts.length);
    try{verified=await this.storage.verifyObjectStream(key,size,expected,v2Limits.finalizationSeconds*1000,undefined,signal,progress);}
    catch(error){if(!objectMissing(error))throw error;}
    if(!verified){
      await this.storage.assertLargeOriginalStorageProfile(signal);
      await this.storage.abortOriginalAssemblies(key,signal);
      const storage=this.storage;
      const sourceParts=(async function*(){for(const part of parts){signal.throwIfAborted();yield {number:part.part_number,
        bytes:await storage.readPartObject(part.object_key,part.bytes,part.sha256,v2Limits.partBytes,signal)};}})();
      await storage.putOriginalMultipart(key,sourceParts,size,upload.body.input.mediaType,expected,
        v2Limits.maxOriginalBytes,v2Limits.maxParts,v2Limits.storageRequestSeconds*1000,signal,
        number=>this.renewV2(id,token,'finalizing','assembling',number));
      await progress();
      verified=await storage.verifyObjectStream(key,size,expected,v2Limits.finalizationSeconds*1000,undefined,signal,progress);
    }
    await transaction(async client=>{
      const scope=await lockUnassignedSourceCase(client,upload.case_id),fresh=await load(client,upload.case_id,id);
      const job=(await client.query("SELECT status FROM jobs WHERE id=$1 AND operation='large-original-storage' FOR UPDATE",[jobId])).rows[0];
      if(fresh.state!=='finalizing'||fresh.lease_token!==token||new Date(fresh.lease_expires_at).getTime()<=Date.now()
        ||scope.revision!==fresh.case_revision||job?.status!=='running')conflict('The upload/case job fence changed before source publication.');
      const inspection={profile:'large-original-v1',status:'needs_input',issues:[],summary:'Original bytes retained and hash-verified. Conversion is unsupported; no parsing, placement, approval or publication of semantic records occurred.',
        largeOriginal:LargeOriginalEvidenceSchema.parse({uploadId:id,operatorSubject:fresh.operator_subject,objectEtag:verified!.etag,
          verifiedSha256:verified!.sha256,verifiedBytes:verified!.bytes,receiptVersion:v2Limits.version,
          provenance:{...fresh.body.input.provenance,state:'caller_declared'},conversion:'unsupported',bundleCompleteness:'single_original_only_archive_dependencies_not_assessed'})};
      await client.query("INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status,inspection) VALUES($1,$2,$1,1,$3,'large-original-v1',$4,$5,$6,$7,'needs_input',$8)",
        [fresh.source_id,upload.case_id,fresh.body.input.filename,fresh.body.input.mediaType,fresh.original_bytes,verified!.sha256,key,inspection]);
      await client.query('UPDATE cases SET revision=revision+1,updated_at=now() WHERE id=$1',[upload.case_id]);
      fresh.case_revision=scope.revision+1;fresh.state='retained';fresh.body.verified=verified;fresh.body.finalizationPhase='cleaning';
      fresh.body.cleanupCursor=0;fresh.body.lastError=null;fresh.lease_expires_at=new Date(Date.now()+v2Limits.leaseSeconds*1000);
      fresh.revision++;await save(client,fresh);
    });
  }
  private async finishV2Cleanup(jobId:string,upload:Upload,parts:Upload[],token:string,signal:AbortSignal){
    const id=upload.id,state=upload.state;
    if(!['retained','aborting','aborted'].includes(state))conflict('Cleanup requires a retained or fenced receipt.');
    await this.storage.assertLargeOriginalStorageProfile(signal);
    if(parts.length&&(await query('SELECT id FROM sources WHERE object_key=ANY($1::text[])',[parts.map(p=>p.object_key)])).rowCount)
      throw new AppError(409,'ORIGINAL_RETAINED','Cleanup cannot replace a canonical original with a tombstone.');
    for(let index=Number(upload.body.cleanupCursor||0);index<parts.length;index++){
      const part=parts[index];
      if(!part.object_key.startsWith(`upload-parts/${id}/`))throw new AppError(503,'UPLOAD_CLEANUP','Temporary object ownership does not match this receipt.');
      await this.storage.sealUploadObject(part.object_key,id,AbortSignal.any([signal,AbortSignal.timeout(v2Limits.storageRequestSeconds*1000)]));
      await this.renewV2(id,token,state,'cleaning',upload.body.completedParts||0,index+1);
    }
    if(state!=='retained'){
      if((await query('SELECT id FROM sources WHERE id=$1 OR object_key=$2',[upload.source_id,objectKey(upload)])).rowCount)
        throw new AppError(409,'ORIGINAL_RETAINED','Cleanup cannot replace a canonical retained original.');
      await this.storage.sealUploadObject(objectKey(upload),id,AbortSignal.any([signal,AbortSignal.timeout(v2Limits.storageRequestSeconds*1000)]));
    }
    await this.storage.abortOriginalAssemblies(objectKey(upload),signal);
    await transaction(async client=>{
      await caseRow(client,upload.case_id);const fresh=await load(client,upload.case_id,id);
      const job=(await client.query("SELECT * FROM jobs WHERE id=$1 AND operation='large-original-storage' FOR UPDATE",[jobId])).rows[0];
      if(fresh.lease_token!==token||fresh.state!==state||new Date(fresh.lease_expires_at).getTime()<=Date.now()||job?.status!=='running')
        conflict('This cleanup worker was superseded.');
      if(fresh.state==='aborting')fresh.state='aborted';
      fresh.body.cleanupPending=false;fresh.body.lastError=null;fresh.lease_token=null;fresh.lease_expires_at=null;fresh.revision++;
      await save(client,fresh);
      await client.query("UPDATE jobs SET status='succeeded',error=NULL,completed_at=now() WHERE id=$1",[jobId]);
    });
  }
  private async failV2Job(jobId:string,id:string,token:string,error:unknown){
    const code=error instanceof AppError?error.code:'FINALIZATION_INTERRUPTED';
    await transaction(async client=>{
      const row=(await client.query('SELECT case_id FROM usp_source_uploads WHERE id=$1',[id])).rows[0];if(!row)return;
      await caseRow(client,row.case_id);
      const upload=(await client.query('SELECT * FROM usp_source_uploads WHERE id=$1 FOR UPDATE',[id])).rows[0];
      const job=(await client.query("SELECT * FROM jobs WHERE id=$1 AND operation='large-original-storage' FOR UPDATE",[jobId])).rows[0];
      if(!job||upload.lease_token!==token)return;
      const cleaning=upload.state!=='finalizing';
      const terminal=!cleaning&&(['ORIGINAL_INTEGRITY','PART_INTEGRITY','SOURCE_INTEGRITY','ORIGINAL_INCOMPLETE'].includes(code)
        ||upload.finalize_attempts>=v2Limits.maxFinalizationAttempts);
      upload.lease_token=null;upload.lease_expires_at=null;upload.body.lastError=cleaning?'CLEANUP_PENDING':code;
      if(terminal)upload.state='receiving';upload.revision++;await save(client,upload);
      const attempts=Number(job.attempts)+1,stop=terminal||cleaning&&attempts>=v2Limits.maxFinalizationAttempts;
      await client.query("UPDATE jobs SET status=$2,attempts=$3,next_attempt_at=now()+interval '10 seconds',error=$4,completed_at=CASE WHEN $5 THEN now() ELSE NULL END WHERE id=$1",
        [jobId,stop?'failed':'queued',attempts,code,stop]);
    });
  }
}

export async function runLargeOriginalStorageJob(jobId:string){await new LargeOriginalService().runV2Job(jobId);}

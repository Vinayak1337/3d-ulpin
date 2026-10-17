import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {DocumentRetainSchema,DocumentRetrySchema,DocumentReceiptSchema,DocumentInputSchema,DocumentResultSchema,DocumentStatusSchema,
  DOCUMENT_VERSION,DOCUMENT_LIMITS,type DocumentInput,type DocumentResult} from '@ulpin/contracts/usp';
import {transaction} from '../../../infrastructure/db';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {putOriginal,readObject,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {originalAttempt} from '../../cases/original-attempt';
import {documentCaseTx,documentSourceTx,documentInput,assertDocumentInputTx} from './document-context';
import {documentFormat} from './document-native';
import {registerUspJobInputTx} from '../jobs';
import {appendCaseIngestionTx,assertIngestionBinding} from './events';

const uuid=z.uuid(),operationKind='source-document';
async function operation(client:PoolClient,caseId:string,key:string,digest:string){
  const prior=(await client.query('SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind=$3',[caseId,key,operationKind])).rows[0];
  if(prior && prior.payload_hash!==digest)conflict('This document request key already names different inputs.');return prior?.result;
}
async function remember(client:PoolClient,caseId:string,key:string,digest:string,result:unknown){
  await client.query('INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,$3,$4,$5)',[caseId,key,operationKind,digest,result]);
}
export const documentResultKey=(jobId:string,hash:string)=>`document-results/${jobId}/${hash}.json`;
/** Recheck the accepted attempt after result I/O, without rescoping its derivative. */
export async function assertDocumentAcceptedResultTx(client:PoolClient,input:DocumentInput,resultHash:string){
  const current=(await client.query(`SELECT j.status,j.payload,m.logical_state,m.input_sha256,m.result_ref,a.completion_sha256
    FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id
    JOIN usp_job_attempts a ON a.job_id=j.id AND a.fence=m.accepted_fence AND a.state='accepted'
    WHERE j.id=$1 AND j.case_id=$2 AND j.source_id=$3 AND j.operation='document-extraction'`,
    [input.jobId,input.caseId,input.sourceId])).rows[0];
  if(!current || current.status!=='succeeded' || current.logical_state!=='succeeded' ||
    current.result_ref?.sha256!==resultHash || current.completion_sha256!==resultHash ||
    current.input_sha256!==fingerprint(input) || fingerprint(current.payload)!==fingerprint(input))
    conflict('The accepted member inspection attempt changed while reading its result.');
}
async function enqueue(client:PoolClient,caseId:string,sourceId:string,mode:DocumentInput['mode'],ocrSelection?:DocumentInput['ocrSelection'],
  archiveSelection?:DocumentInput['archiveSelection']){
  const ctx=await documentSourceTx(client,caseId,sourceId,true);
  if(!ctx.latest)conflict('This source has a newer retained revision.');
  const rows=(await client.query("SELECT id,status,payload FROM jobs WHERE case_id=$1 AND source_id=$2 AND operation='document-extraction' ORDER BY created_at DESC LIMIT 33",[caseId,sourceId])).rows;
  if(rows.length>=DOCUMENT_LIMITS.jobs)throw new AppError(413,'DOCUMENT_JOB_HISTORY_LIMIT','This source has reached its bounded document job history. Original and earlier receipts remain retained.');
  const active=rows.find(j=>['queued','running'].includes(j.status));
  if(active){
    const input=DocumentInputSchema.parse(active.payload);await assertDocumentInputTx(client,input);
    if(input.mode!==mode || fingerprint(input.ocrSelection??null)!==fingerprint(ocrSelection??null) ||
      fingerprint(input.archiveSelection??null)!==fingerprint(archiveSelection??null))
      conflict('A current document job is already active with a different mode or selection.');return {ctx,jobId:active.id};
  }
  const jobId=randomUUID(),input=documentInput(ctx,jobId,mode,ocrSelection,archiveSelection),inputHash=fingerprint(input);
  await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload)
    VALUES($1,$2,$3,'document-extraction',$4,$5,$6)`,[jobId,caseId,sourceId,ctx.current.revision,inputHash,input]);
  await registerUspJobInputTx(client,jobId,{kind:'intake',workspaceId:caseId,version:ctx.current.revision+1},sourceId,inputHash);
  await appendCaseIngestionTx(client,caseId,{kind:'document.changed',sourceId,sourceRevision:ctx.source.revision,jobId,status:'queued'},ctx.binding.subject);
  return {ctx,jobId};
}
function receipt(ctx:Awaited<ReturnType<typeof documentSourceTx>>,jobId:string){
  return DocumentReceiptSchema.parse({version:DOCUMENT_VERSION,caseId:ctx.current.id,caseRevision:ctx.current.revision,
    sourceId:ctx.source.id,sourceRevision:ctx.source.revision,sourceSha256:ctx.source.sha256,bytes:Number(ctx.source.bytes),jobId});
}
export async function readDocumentResult(input:DocumentInput,resultHash:string,read:typeof readObject=readObject):Promise<DocumentResult>{
  const bytes=await read(documentResultKey(input.jobId,resultHash));
  if(bytes.length>DOCUMENT_LIMITS.resultBytes || sha256(bytes)!==resultHash)throw new AppError(422,'DOCUMENT_RESULT_INTEGRITY','The stored extraction result failed its exact hash/size check.');
  const result=DocumentResultSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  if(fingerprint(result.input)!==fingerprint(input))throw new AppError(422,'DOCUMENT_RESULT_SCOPE','The extraction result has different source/job pins.');
  if(result.native.parts.some(p=>sha256(p.text)!==p.sha256))throw new AppError(422,'DOCUMENT_PART_INTEGRITY','A native part differs from its exact text hash.');
  const units=new Map<string,typeof result.native.parts>();
  for(const part of result.native.parts)if(part.locator.unitId){
    const group=units.get(part.locator.unitId)??[];group.push(part);units.set(part.locator.unitId,group);
  }
  for(const parts of units.values()){
    const ordered=[...parts].sort((a,b)=>a.locator.segmentIndex!-b.locator.segmentIndex!);
    const first=ordered[0],count=first.locator.segmentCount,hash=first.locator.unitSha256;
    let next=0;
    for(const [index,part] of ordered.entries()){
      const locator=part.locator;
      if(locator.segmentIndex!==index||locator.segmentCount!==count||locator.unitSha256!==hash||locator.characterStart!==next)
        throw new AppError(422,'DOCUMENT_PART_INTEGRITY','A cited native continuation is incomplete or out of order.');
      next=locator.characterEnd;
    }
    if(ordered.length!==count||sha256(ordered.map(part=>part.text).join(''))!==hash)
      throw new AppError(422,'DOCUMENT_PART_INTEGRITY','A cited native unit differs from its complete text hash.');
  }
  return result;
}
export class DocumentIngestionService{
  async retain(caseValue:string,raw:unknown,file:{name:string;bytes:Uint8Array}){
    const caseId=uuid.parse(caseValue),input=DocumentRetainSchema.parse(raw),hash=sha256(file.bytes);
    if(!file.bytes.length || file.bytes.length>DOCUMENT_LIMITS.originalBytes)throw new AppError(413,'DOCUMENT_SIZE','Retain a nonempty original of at most 16 MiB. No bytes were truncated.');
    if(Boolean(input.familyId)!==Boolean(input.expectedSourceRevision))throw new AppError(422,'DOCUMENT_FAMILY_PIN','Pin both the existing family and expected revision.');
    const sourceId=randomUUID(),objectKey=`sources/${sourceId}/${hash}`,format=documentFormat(file.bytes),key=`document-retain:${input.requestKey}`;
    // No parsing/provider work occurs before this durable receipt transaction.
    return originalAttempt('sources',sourceId,async rememberOriginal=>transaction(async client=>{
      const scope=await documentCaseTx(client,caseId,true),digest=fingerprint({input,name:file.name,hash,subject:scope.binding.subject});
      const prior=await operation(client,caseId,key,digest);
      if(prior){
        const ctx=await documentSourceTx(client,caseId,prior.sourceId),job=(await client.query('SELECT payload FROM jobs WHERE id=$1 AND case_id=$2',[prior.jobId,caseId])).rows[0];
        if(!ctx.latest||!job)conflict('The original receipt no longer names the current source/job.');
        await assertDocumentInputTx(client,DocumentInputSchema.parse(job.payload));return DocumentReceiptSchema.parse(prior);
      }
      if(input.expectedCaseRevision!==undefined && input.expectedCaseRevision!==scope.current.revision)conflict('The source case changed before document receipt.');
      let familyId:string=sourceId,revision=1;
      if(input.familyId){
        const priorSource=(await client.query('SELECT id,revision FROM sources WHERE case_id=$1 AND family_id=$2 ORDER BY revision DESC LIMIT 1',[caseId,input.familyId])).rows[0];
        if(!priorSource || priorSource.revision!==input.expectedSourceRevision)conflict('The source family changed.');
        await documentSourceTx(client,caseId,priorSource.id);familyId=input.familyId;revision=priorSource.revision+1;
      }
      const duplicate=(await client.query(`SELECT id FROM sources WHERE case_id=$1 AND sha256=$2
        AND inspection#>>'{documentOriginal,subject}'=$3 AND ($4::uuid IS NULL OR family_id=$4)
        ORDER BY created_at DESC LIMIT 1`,[caseId,hash,scope.binding.subject,input.familyId??null])).rows[0];
      if(duplicate){
        const existing=(await client.query("SELECT id,payload FROM jobs WHERE case_id=$1 AND source_id=$2 AND operation='document-extraction' ORDER BY created_at DESC LIMIT 1",[caseId,duplicate.id])).rows[0];
        const ctx=await documentSourceTx(client,caseId,duplicate.id);
        if(!ctx.latest || !existing)conflict('The duplicate original has a newer source context.');
        const jobId=fingerprint(existing.payload)===fingerprint(documentInput(ctx,existing.id,input.mode))
          ?existing.id:(await enqueue(client,caseId,duplicate.id,input.mode)).jobId;
        const result=receipt(ctx,jobId);await remember(client,caseId,key,digest,result);return result;
      }
      const original={version:DOCUMENT_VERSION,subject:scope.binding.subject,format,sha256:hash,bytes:file.bytes.length,receivedAt:new Date().toISOString()};
      const mime=({pdf:'application/pdf',png:'image/png',jpeg:'image/jpeg',text:'text/plain',csv:'text/csv'} as Record<string,string>)[format]??'application/octet-stream';
      rememberOriginal(objectKey);await putOriginal(objectKey,file.bytes,mime);
      const profile=['pdf','text','csv','docx','png','jpeg'].includes(format)?`${format}-reference-v2`:'document-original-v1';
      await client.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status,inspection)
        VALUES($1,$2,$3,$4,$5,$6,$11,$7,$8,$9,'received',$10)`,[sourceId,caseId,familyId,revision,file.name,profile,file.bytes.length,hash,objectKey,
        {profile,status:'needs_input',issues:[],summary:'Unchanged original retained. Source-bound native extraction is queued.',documentOriginal:original},mime]);
      await client.query('UPDATE cases SET revision=revision+1,updated_at=now() WHERE id=$1',[caseId]);
      const queued=await enqueue(client,caseId,sourceId,input.mode),result=receipt(queued.ctx,queued.jobId);
      await remember(client,caseId,key,digest,result);assertIngestionBinding(scope.binding);return result;
    }));
  }
  async retry(caseValue:string,sourceValue:string,raw:unknown){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),input=DocumentRetrySchema.parse(raw);
    return transaction(async client=>{
      const ctx=await documentSourceTx(client,caseId,sourceId,true),key=`document-retry:${input.requestKey}`,
        digest=fingerprint({input,sourceId,subject:ctx.binding.subject});
      if(!ctx.latest || ctx.current.revision!==input.expectedCaseRevision || ctx.source.revision!==input.expectedSourceRevision || ctx.source.sha256!==input.sourceSha256)
        conflict('Retry must pin the current source and case.');
      const prior=await operation(client,caseId,key,digest);if(prior){
        const job=(await client.query('SELECT payload FROM jobs WHERE id=$1 AND case_id=$2',[prior.jobId,caseId])).rows[0]??notFound('Document job not found.');
        await assertDocumentInputTx(client,DocumentInputSchema.parse(job.payload));return DocumentReceiptSchema.parse(prior);
      }
      const queued=await enqueue(client,caseId,sourceId,input.mode,input.ocrSelection,input.archiveSelection),result=receipt(queued.ctx,queued.jobId);
      await remember(client,caseId,key,digest,result);return result;
    });
  }
  async status(caseValue:string,sourceValue:string,jobValue:string,pageValue=0,ocrPageValue=0){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),jobId=uuid.parse(jobValue),page=z.number().int().min(0).max(399).parse(pageValue),
      ocrPage=z.number().int().min(0).max(2).parse(ocrPageValue);
    const scope=await transaction(async client=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const ctx=await documentSourceTx(client,caseId,sourceId);
      const job=(await client.query(`SELECT j.*,m.result_ref FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id
        WHERE j.id=$1 AND j.case_id=$2 AND j.source_id=$3 AND j.operation='document-extraction'`,[jobId,caseId,sourceId])).rows[0]??notFound('Document job not found.');
      let stale=false;try{await assertDocumentInputTx(client,DocumentInputSchema.parse(job.payload));}catch(e){if(e instanceof AppError && e.status===409)stale=true;else throw e;}
      return {ctx,job,stale};
    });
    const {ctx,job,stale}=scope;let result:DocumentResult|null=null;
    if(!stale && job.status==='succeeded' && job.result_ref)result=await readDocumentResult(DocumentInputSchema.parse(job.payload),job.result_ref.sha256);
    // Reauthorize after object I/O; read-time checks never rescope or approve stored evidence.
    await transaction(async client=>{
      if(!stale){
        const input=DocumentInputSchema.parse(job.payload);await assertDocumentInputTx(client,input);
        if(result?.archiveInspection)await assertDocumentAcceptedResultTx(client,input,job.result_ref.sha256);
      }else await documentSourceTx(client,caseId,sourceId);
    });
    const start=page*DOCUMENT_LIMITS.page,ocrStart=ocrPage*DOCUMENT_LIMITS.page;
    return DocumentStatusSchema.parse({version:DOCUMENT_VERSION,caseId,sourceId,jobId,status:stale?'stale':job.status==='succeeded'?'completed':job.status,
      currentCaseRevision:ctx.current.revision,sourceRevision:ctx.source.revision,sourceSha256:ctx.source.sha256,resultSha256:stale?null:job.result_ref?.sha256??null,
      native:result?(({parts,...native})=>native)(result.native):null,model:result?.model??null,
      parts:result?.native.parts.slice(start,start+DOCUMENT_LIMITS.page)??[],page,hasMore:Boolean(result && start+DOCUMENT_LIMITS.page<result.native.parts.length),
      ocr:result?.ocr?(({items,...metadata})=>metadata)(result.ocr):null,
      ocrItems:result?.ocr?.items.slice(ocrStart,ocrStart+DOCUMENT_LIMITS.page)??[],ocrPage,
      ocrHasMore:Boolean(result?.ocr && ocrStart+DOCUMENT_LIMITS.page<result.ocr.items.length),
      archiveInspection:result?.archiveInspection??null,code:stale?'DOCUMENT_INPUT_STALE':job.error??null});
  }
  async original(caseValue:string,sourceValue:string){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),ctx=await transaction(client=>documentSourceTx(client,caseId,sourceId));
    const bytes=await readObject(ctx.source.object_key);
    if(bytes.length!==Number(ctx.source.bytes)||sha256(bytes)!==ctx.source.sha256)throw new AppError(422,'SOURCE_INTEGRITY','The original differs from its retained receipt.');
    await transaction(client=>documentSourceTx(client,caseId,sourceId));return {bytes,name:ctx.source.name,mimeType:ctx.source.mime_type};
  }
}

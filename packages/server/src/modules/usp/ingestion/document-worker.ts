import {randomUUID} from 'node:crypto';
import {DocumentInputSchema,DocumentResultSchema,DOCUMENT_LIMITS,type DocumentResult} from '@ulpin/contracts/usp';
import type {PoolClient} from 'pg';
import {query,transaction} from '../../../infrastructure/db';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {readRetainedOriginal,putOriginal,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {claimUspJobAttempt,acceptUspJobAttempt,assertUspJobAttemptTx} from '../jobs';
import {assertDocumentInputTx} from './document-context';
import {documentFormat,extractSourceDocument} from './document-native';
import {proposeDocument} from './document-model';
import {runSourceOcr} from './document-ocr';
import {inspectDocumentArchive} from './document-archive';
import {documentResultKey,readDocumentResult,requeueBatchDocumentTx} from './documents';
import {appendCaseIngestionTx} from './events';
import {rereadBatchPdfTx,settleBatchPdfTx,stopBatchPdfTx} from './intake-draft';

type Dependencies={read?:typeof readRetainedOriginal;extract?:typeof extractSourceDocument;
  propose?:typeof proposeDocument;ocr?:typeof runSourceOcr;archive?:typeof inspectDocumentArchive};
export async function runDocumentJob(jobId:string,dependencies:Dependencies={}){
  const job=(await query("SELECT * FROM jobs WHERE id=$1 AND operation='document-extraction'",[jobId])).rows[0]??notFound('Document job not found.');
  if(!['queued','running'].includes(job.status))return;
  const input=DocumentInputSchema.parse(job.payload),deadline=Date.now()+120000;
  const beforeLocks=async(client:Parameters<typeof assertDocumentInputTx>[0])=>{await assertDocumentInputTx(client,input,true);};
  let attempt:Awaited<ReturnType<typeof claimUspJobAttempt>>;
  try{
    attempt=await claimUspJobAttempt(jobId,`document:${randomUUID()}`,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`document-workers:${input.subject}`]);
      await beforeLocks(client);
      const active=Number((await client.query(`SELECT count(*)::int n FROM usp_job_attempts a JOIN jobs j ON j.id=a.job_id
        WHERE j.operation='document-extraction' AND j.payload->>'subject'=$1 AND a.state='active' AND a.lease_until>now()`,[input.subject])).rows[0].n);
      if(active>=2)throw new AppError(409,'DOCUMENT_WORKER_BUSY','The bounded document workers are occupied.');
      if(input.ocrSelection){
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['document-ocr-global']);
        const ocrActive=Number((await client.query(`SELECT count(*)::int n FROM usp_job_attempts a JOIN jobs j ON j.id=a.job_id
          WHERE j.operation='document-extraction' AND j.payload ? 'ocrSelection' AND a.state='active' AND a.lease_until>now()`)).rows[0].n);
        if(ocrActive>=1)throw new AppError(409,'DOCUMENT_WORKER_BUSY','The bounded OCR worker is occupied.');
      }
    });
  }catch(error){
    if(error instanceof AppError && error.code==='DOCUMENT_WORKER_BUSY')return;
    const active=(await query("SELECT 1 FROM usp_job_attempts WHERE job_id=$1 AND state='active' AND lease_until>now() LIMIT 1",[jobId])).rowCount;
    if(active)return;
    await failDocumentJob(jobId,error instanceof AppError && error.status===409?'DOCUMENT_INPUT_STALE':'DOCUMENT_CONTEXT_UNAVAILABLE');return;
  }
  const authorize=async()=>{
    if(Date.now()>deadline)throw new AppError(503,'DOCUMENT_DEADLINE','The bounded document execution expired.');
    return transaction(async client=>{
      const context=await assertDocumentInputTx(client,input,true);await assertUspJobAttemptTx(client,attempt);
      return context;
    });
  };
  try{
    const context=await authorize();
    const original=input.sourceBytes<=DOCUMENT_LIMITS.nativeBytes
      ?await (dependencies.read??readRetainedOriginal)(input.objectKey,input.sourceBytes,input.sourceSha256,
        DOCUMENT_LIMITS.nativeBytes,Math.max(1,deadline-Date.now())):undefined;
    let native:DocumentResult['native'];
    if(!original)native={format:context.source.inspection.documentOriginal.format,status:'tool_error',
      readerSha256:input.readerSha256,code:'NATIVE_READER_BYTE_LIMIT',warnings:[],parts:[]};
    else if(input.ocrSelection?.singlePage)native={format:documentFormat(original),status:'needs_ocr',
      readerSha256:input.readerSha256,code:'NATIVE_TEXT_NOT_REQUESTED',warnings:[],parts:[]};
    else native=await (dependencies.extract??extractSourceDocument)(input,original);
    await authorize();
    const ocr=input.ocrSelection?await (dependencies.ocr??runSourceOcr)(input,original,deadline):undefined;
    await authorize();
    if(input.archiveSelection&&!original)
      throw new AppError(422,'ARCHIVE_SOURCE_INTEGRITY','Select a member of the bounded unchanged source ZIP.');
    const archiveInspection=input.archiveSelection
      ?await (dependencies.archive??inspectDocumentArchive)(input,original!):undefined;
    await authorize();
    const model=await (dependencies.propose??proposeDocument)(input,native,async()=>{await authorize();});
    const result=DocumentResultSchema.parse({version:'source-document/1',input,native,model,
      ...(ocr?{ocr}:{}),...(archiveInspection?{archiveInspection}:{}),createdAt:new Date().toISOString()});
    const bytes=Buffer.from(JSON.stringify(result));
    if(bytes.length>DOCUMENT_LIMITS.resultBytes)throw new AppError(413,'DOCUMENT_RESULT_LIMIT','The extraction derivative exceeds its bounded result size.');
    const hash=sha256(bytes),asset={assetId:`document:${jobId}`,version:1,sha256:hash};
    await authorize();await putOriginal(documentResultKey(jobId,hash),bytes,'application/json');
    await readDocumentResult(input,hash);
    await acceptUspJobAttempt(attempt,asset,async(client,current,accepted)=>{
      await authorizePins(client);
      if(current.operation!=='document-extraction'||fingerprint(current.payload)!==fingerprint(input)||current.input_fingerprint!==attempt.inputSha256)
        conflict('Document job input changed before publication.');
      if(accepted.assetId!==asset.assetId||accepted.sha256!==hash)
        conflict('Completion differs from the staged document receipt.');
    },beforeLocks,async client=>{
      // Staged native text lives only in the fenced result object. Copying it to
      // generic inspection/package views would bypass current job/access pins.
      await client.query(`UPDATE sources SET status=$2,inspection=inspection || $3::jsonb WHERE id=$1`,[input.sourceId,
        native.status==='extracted'?'needs_input':native.status==='tool_error'?'failed':'needs_input',
        {status:'needs_input',summary:'Source-bound extraction receipt retained. Native results and model proposals are separate; no facts are approved.',
          documentAccepted:{jobId,sha256:hash,nativeStatus:native.status,modelStatus:model.status}}]);
      await appendCaseIngestionTx(client,input.caseId,{kind:'document.changed',sourceId:input.sourceId,sourceRevision:input.sourceRevision,jobId,status:'completed'},input.subject);
      if(!input.ocrSelection?.singlePage)await settleBatchPdfTx(client,input.caseId,input.sourceId,native,input.sourceBytes);
    });
    async function authorizePins(client:Parameters<typeof assertDocumentInputTx>[0]){
      if(Date.now()>deadline)throw new AppError(503,'DOCUMENT_DEADLINE','The bounded document execution expired.');
      await assertDocumentInputTx(client,input);
    }
  }catch(error){
    await failDocumentJob(jobId,error instanceof AppError && error.status===409?'DOCUMENT_INPUT_STALE':error instanceof AppError?error.code:'DOCUMENT_WORKER_FAILED',attempt);
  }
}
export async function failDocumentJob(jobId:string,code:string,attempt?:Awaited<ReturnType<typeof claimUspJobAttempt>>){
  await transaction(async client=>{
    const stale=code==='DOCUMENT_INPUT_STALE';
    // S9.6r. The stale re-queue locks the case FOR UPDATE: take it before the job row and the case stream, as the
    // claim, the acceptance and every case writer do, or a writer holding the case waits on this stream (40P01).
    if(stale)await client.query(`SELECT c.id FROM cases c JOIN jobs j ON j.case_id=c.id
      WHERE j.id=$1 FOR UPDATE OF c`,[jobId]);
    const job=(await client.query("SELECT * FROM jobs WHERE id=$1 AND operation='document-extraction' FOR UPDATE",[jobId])).rows[0];if(!job || !['queued','running'].includes(job.status))return;
    if(attempt){try{await assertUspJobAttemptTx(client,attempt);}catch{return;}}
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'",[jobId]);
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",[jobId]);
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[jobId,stale?'stale':'failed',code]);
    await stopBatchPdfTx(client,job.case_id,job.source_id,stale);
    if(job.payload.subject===process.env.ULPIN_LOCAL_OPERATOR_SUBJECT)
      await appendCaseIngestionTx(client,job.case_id,{kind:'document.changed',sourceId:job.source_id,sourceRevision:job.payload.sourceRevision,
        jobId,status:stale?'stale':'failed'},job.payload.subject);
    if(stale)await requeueStaleDocumentTx(client,job.payload);
  });
}
/**
 * S9.6g. A batch read that ends stale (another file of its batch moved the case context) is queued once more under
 * current pins. Any refusal or error rolls back to the savepoint, so the stale end and its words stay recorded.
 */
async function requeueStaleDocumentTx(client:PoolClient,payload:unknown){
  await client.query('SAVEPOINT document_requeue');
  try{
    const input=DocumentInputSchema.parse(payload);
    const jobId=await requeueBatchDocumentTx(client,input);
    if(!jobId||!await rereadBatchPdfTx(client,input.caseId,input.sourceId,input.sourceBytes))
      await client.query('ROLLBACK TO SAVEPOINT document_requeue');
  }catch{
    await client.query('ROLLBACK TO SAVEPOINT document_requeue');
  }finally{
    await client.query('RELEASE SAVEPOINT document_requeue');
  }
}

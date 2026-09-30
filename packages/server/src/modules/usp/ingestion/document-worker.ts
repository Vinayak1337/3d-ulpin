import {randomUUID} from 'node:crypto';
import {DocumentInputSchema,DocumentResultSchema,DOCUMENT_LIMITS,type DocumentResult} from '@ulpin/contracts/usp';
import {query,transaction} from '../../../infrastructure/db';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {readObject,putOriginal,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {claimUspJobAttempt,acceptUspJobAttempt,assertUspJobAttemptTx} from '../jobs';
import {assertDocumentInputTx} from './document-context';
import {extractSourceDocument} from './document-native';
import {proposeDocument} from './document-model';
import {runSourceOcr} from './document-ocr';
import {documentResultKey,readDocumentResult} from './documents';
import {appendCaseIngestionTx} from './events';

type Dependencies={extract?:typeof extractSourceDocument;propose?:typeof proposeDocument;ocr?:typeof runSourceOcr};
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
    await transaction(async client=>{await beforeLocks(client);await assertUspJobAttemptTx(client,attempt);});
  };
  try{
    await authorize();
    const original=await readObject(input.objectKey);
    if(original.length!==input.sourceBytes || sha256(original)!==input.sourceSha256)throw new AppError(422,'SOURCE_INTEGRITY','The retained original differs from its receipt.');
    const native=await (dependencies.extract??extractSourceDocument)(input,original);
    await authorize();
    const ocr=input.ocrSelection?await (dependencies.ocr??runSourceOcr)(input,original,deadline):undefined;
    await authorize();
    const model=await (dependencies.propose??proposeDocument)(input,native,authorize);
    const result=DocumentResultSchema.parse({version:'source-document/1',input,native,model,
      ...(ocr?{ocr}:{}),createdAt:new Date().toISOString()});
    const bytes=Buffer.from(JSON.stringify(result));
    if(bytes.length>DOCUMENT_LIMITS.resultBytes)throw new AppError(413,'DOCUMENT_RESULT_LIMIT','The extraction derivative exceeds its bounded result size.');
    const hash=sha256(bytes),asset={assetId:`document:${jobId}`,version:1,sha256:hash};
    await authorize();await putOriginal(documentResultKey(jobId,hash),bytes,'application/json');
    await acceptUspJobAttempt(attempt,asset,async(client,current,accepted)=>{
      await authorizePins(client);
      if(current.operation!=='document-extraction'||fingerprint(current.payload)!==fingerprint(input)||current.input_fingerprint!==attempt.inputSha256)
        conflict('Document job input changed before publication.');
      await readDocumentResult(input,accepted.sha256);
    },beforeLocks,async client=>{
      // Staged native text lives only in the fenced result object. Copying it to
      // generic inspection/package views would bypass current job/access pins.
      await client.query(`UPDATE sources SET status=$2,inspection=inspection || $3::jsonb WHERE id=$1`,[input.sourceId,
        native.status==='extracted'?'needs_input':native.status==='tool_error'?'failed':'needs_input',
        {status:'needs_input',summary:'Source-bound extraction receipt retained. Native results and model proposals are separate; no facts are approved.',
          documentAccepted:{jobId,sha256:hash,nativeStatus:native.status,modelStatus:model.status}}]);
      await appendCaseIngestionTx(client,input.caseId,{kind:'document.changed',sourceId:input.sourceId,sourceRevision:input.sourceRevision,jobId,status:'completed'},input.subject);
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
    const job=(await client.query("SELECT * FROM jobs WHERE id=$1 AND operation='document-extraction' FOR UPDATE",[jobId])).rows[0];if(!job || !['queued','running'].includes(job.status))return;
    if(attempt){try{await assertUspJobAttemptTx(client,attempt);}catch{return;}}
    const stale=code==='DOCUMENT_INPUT_STALE';
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'",[jobId]);
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",[jobId]);
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[jobId,stale?'stale':'failed',code]);
    if(job.payload.subject===process.env.ULPIN_LOCAL_OPERATOR_SUBJECT)
      await appendCaseIngestionTx(client,job.case_id,{kind:'document.changed',sourceId:job.source_id,sourceRevision:job.payload.sourceRevision,
        jobId,status:stale?'stale':'failed'},job.payload.subject);
  });
}

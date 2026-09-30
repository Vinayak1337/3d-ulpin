/** Read-only state controls against the actual retained OCR job in the isolated runtime. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertUspIsolation} from './local-isolation.mjs';
import {pool,closePool,transaction} from '../../packages/server/src/infrastructure/db';
import {DocumentInputSchema} from '../../packages/contracts/src/usp/document-ingestion';
import {DocumentIngestionService} from '../../packages/server/src/modules/usp/ingestion/documents';
import {assertDocumentInputTx} from '../../packages/server/src/modules/usp/ingestion/document-context';
import {acceptUspJobAttempt} from '../../packages/server/src/modules/usp/jobs';
import {runSourceOcr} from '../../packages/server/src/modules/usp/ingestion/document-ocr';
import {sha256} from '../../packages/server/src/infrastructure/storage';

assert.equal(process.env.ULPIN_ISOLATION_PROFILE,'local-nest');assertUspIsolation(process.env);
const [caseId,sourceId,jobId]=process.argv.slice(2);
const service=new DocumentIngestionService();
try{
  const row=(await pool().query(`SELECT j.payload,m.result_ref,a.* FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id
    JOIN usp_job_attempts a ON a.job_id=j.id AND a.state='accepted' WHERE j.id=$1 AND j.case_id=$2 AND j.source_id=$3`,
    [jobId,caseId,sourceId])).rows[0];
  assert(row);const input=DocumentInputSchema.parse(row.payload);
  const subject=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT!;
  try{
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='document-access-denial-control';
    await assert.rejects(()=>service.status(caseId,sourceId,jobId),(error:any)=>error.status===403&&error.code==='DOCUMENT_DENIED');
  }finally{process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;}
  const scratch=process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
  try{
    process.env.ULPIN_DOCUMENT_OCR_SCRATCH=scratch+'-configuration-drift-control';
    await assert.rejects(()=>transaction(client=>assertDocumentInputTx(client,input)),(error:any)=>error.status===409);
    const stale=await service.status(caseId,sourceId,jobId);assert.equal(stale.status,'stale');
    assert.equal(stale.resultSha256,null);assert.deepEqual(stale.ocrItems,[]);assert.equal(stale.ocr,null);
  }finally{if(scratch===undefined)delete process.env.ULPIN_DOCUMENT_OCR_SCRATCH;else process.env.ULPIN_DOCUMENT_OCR_SCRATCH=scratch;}
  const models=process.env.ULPIN_DOCUMENT_OCR_MODELS;
  try{
    const original=readFileSync('E:/BhuAayam-data/task-data/ulpin-official-runtime-pdf-v1/usgs-central-city-co-1910-topographic-map.pdf');
    assert.equal(sha256(original),input.sourceSha256);
    process.env.ULPIN_DOCUMENT_OCR_MODELS=models+'-missing-asset-control';
    const missing=await runSourceOcr(input,original,Date.now()+120000);
    assert.equal(missing.toolStatus,'unavailable');assert.deepEqual(missing.issues,['OCR_RUNTIME_UNAVAILABLE']);
  }finally{if(models===undefined)delete process.env.ULPIN_DOCUMENT_OCR_MODELS;else process.env.ULPIN_DOCUMENT_OCR_MODELS=models;}
  let validatorCalled=false;
  await assert.rejects(()=>acceptUspJobAttempt({jobId,number:row.number,fence:Number(row.fence)+1,owner:row.owner,
    leaseUntil:new Date(row.lease_until).toISOString(),inputSha256:row.input_sha256},row.result_ref,
    async()=>{validatorCalled=true;}),(error:any)=>error.status===409);
  assert.equal(validatorCalled,false);
  const current=await service.status(caseId,sourceId,jobId);assert.equal(current.status,'completed');assert.equal(current.ocrItems?.length,5);
  console.log(JSON.stringify({status:'passed',checks:['source subject denial','operator configuration drift fences status without items',
    'missing configured local asset returns unavailable without a worker','superseded attempt fence denied before result validation'],jobId}));
}finally{await closePool();}

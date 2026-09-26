/** Scoped, source-backed protocol checks in a verified isolated document runtime. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {assertUspIsolation} from './local-isolation.mjs';
import {pool,closePool,transaction} from '../../packages/server/src/infrastructure/db';
import {DocumentInputSchema} from '../../packages/contracts/src/usp/document-ingestion';
import {DocumentIngestionService,readDocumentResult} from '../../packages/server/src/modules/usp/ingestion/documents';
import {extractSourceDocument} from '../../packages/server/src/modules/usp/ingestion/document-native';
import {validateDocumentProposals,reserveDocumentLayout} from '../../packages/server/src/modules/usp/ingestion/document-model';
import {documentInput,documentSourceTx} from '../../packages/server/src/modules/usp/ingestion/document-context';
import {ControlAdapter} from '../../packages/server/src/modules/model-gateway/adapter';
import {sha256} from '../../packages/server/src/infrastructure/storage';
import {sourceFrom} from '../../packages/server/src/modules/cases/domain';
import {sourceWorkspaceParts} from '../../packages/server/src/modules/cases/source-workspaces';

assert.equal(process.env.ULPIN_ISOLATION_PROFILE,'local-nest');assertUspIsolation(process.env);
const [caseId,sourceId,jobId,originalPath,secondCase,secondSource,secondJob,thirdSource,thirdJob]=process.argv.slice(2);
try{
  const job=(await pool().query('SELECT j.payload,m.result_ref FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id WHERE j.id=$1 AND j.case_id=$2 AND j.source_id=$3',[jobId,caseId,sourceId])).rows[0];
  const input=DocumentInputSchema.parse(job.payload),result=await readDocumentResult(input,job.result_ref.sha256);
  assert.equal(result.native.status,'extracted');assert(result.native.parts.length>0);
  const nativeFailure=await extractSourceDocument(input,readFileSync(originalPath),async()=>{throw new Error('controlled reader transport failure');});
  assert.equal(nativeFailure.status,'tool_error');assert.equal(nativeFailure.parts.length,0);
  const part=result.native.parts.find(p=>p.text.trim().length>0)!,word=part.text.match(/[A-Za-z]{3,}/)![0];
  const grounded={field:word,value:word,partId:part.id,quote:word};
  const adapter=new ControlAdapter(async()=>({output:{candidates:[grounded]},responseHash:sha256(JSON.stringify({candidates:[grounded]})),httpStatus:200}));
  const control=await adapter.propose({model:'sarvam-105b',messages:[{role:'user',content:JSON.stringify({quote:word})}],outputSchema:{type:'object'},maxOutputTokens:32,
    inputHash:sha256(JSON.stringify({quote:word})),sourceHashes:[input.sourceSha256],signal:AbortSignal.timeout(1000),authorize:async()=>{}});
  assert.equal(validateDocumentProposals(control.output,result.native.parts).candidates.length,1);
  assert.equal(validateDocumentProposals({candidates:[{...grounded,value:'unquoted controlled output'}]},result.native.parts).candidates.length,0);
  assert.equal(validateDocumentProposals({candidates:[{...grounded,partId:randomUUID()}]},result.native.parts).candidates.length,0);
  assert.equal(validateDocumentProposals({candidates:[{...grounded,tool:'execute'}]},result.native.parts).candidates.length,0);
  const source=(await pool().query('SELECT * FROM sources WHERE id=$1 AND case_id=$2',[sourceId,caseId])).rows[0];
  const staged={...source.inspection,referenceParts:[{id:part.id,sourceRevisionId:sourceId,locator:part.locator.label,text:part.text,entityIds:[]}]};
  const view=sourceFrom({...source,inspection:staged}).inspection!;
  assert(!('referenceParts' in view));assert(!('documentOriginal' in view));assert(!('documentAccepted' in view));
  assert.deepEqual(sourceWorkspaceParts([{id:sourceId,profile:source.profile,inspection:staged}]),[]);
  const {documentOriginal:_original,documentAccepted:_accepted,...historical}=staged;
  assert.deepEqual(sourceWorkspaceParts([{id:sourceId,profile:source.profile,inspection:historical}]),historical.referenceParts);
  const service=new DocumentIngestionService(),subject=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT!;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='document-access-denial-control';
  await assert.rejects(()=>service.status(caseId,sourceId,jobId),(e:any)=>e.status===403&&e.code==='DOCUMENT_DENIED');
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
  await pool().query('UPDATE cases SET archived=true WHERE id=$1',[caseId]);
  await assert.rejects(()=>service.status(caseId,sourceId,jobId),(e:any)=>e.status===403);
  await assert.rejects(()=>service.original(caseId,sourceId),(e:any)=>e.status===403);
  await pool().query('UPDATE cases SET archived=false WHERE id=$1',[caseId]);
  // Only this child process sets a cap control. No provider config/key is enabled;
  // no model call or invented source/financial record is made.
  process.env.ULPIN_DOCUMENT_MODEL_LAYOUT_CAP='1';
  const capInput=await transaction(async client=>documentInput(await documentSourceTx(client,secondCase,secondSource),secondJob,'propose'));
  const concurrent=await Promise.all(Array.from({length:6},()=>reserveDocumentLayout(capInput)));
  assert(concurrent.every(Boolean));
  const reservations=Number((await pool().query("SELECT count(*)::int n FROM operations WHERE case_id=$1 AND kind='document-layout'",[secondCase])).rows[0].n);
  assert.equal(reservations,1);
  const different=await transaction(async client=>documentInput(await documentSourceTx(client,secondCase,thirdSource),thirdJob,'propose'));
  assert.notEqual(different.sourceSha256,capInput.sourceSha256);
  assert.equal(await reserveDocumentLayout(different),false);
  delete process.env.ULPIN_DOCUMENT_MODEL_LAYOUT_CAP;
  const invariants=(await pool().query(`SELECT (SELECT count(*)::int FROM usp_model_calls) model_calls,
    (SELECT count(*)::int FROM registry_records) registry_records,
    (SELECT count(*)::int FROM physical_features) physical_features`)).rows[0];
  assert.equal(invariants.model_calls,0);assert.equal(invariants.registry_records,0);assert.equal(invariants.physical_features,0);
  console.log(JSON.stringify({status:'passed',checks:['actual-source native failure control','ControlAdapter grounded/unquoted/foreign-part/tool rejection',
    'source ownership and archive denial','generic source/package projections hide staged text; historical parts stay compatible',
    'six concurrent same-layout reservations yield one record; a distinct retained original is denied at cap one'],invariants,
    limits:['Model control is quotation validation only, not extraction accuracy or live gateway proof','Cap is an isolated protocol control on actual retained originals, not live model-policy qualification']}));
}finally{await closePool();}

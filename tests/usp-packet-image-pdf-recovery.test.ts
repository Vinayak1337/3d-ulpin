import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Pool,PoolClient} from 'pg';
import {RegistryImageRegionCitationSchema} from '../packages/contracts/src/registry-document-evidence';
import {PacketImageRegionProvenanceSchema} from '../packages/contracts/src/packet-image-region';
import {PACKET_IMAGE_PDF_RECIPE,UspImagePdfPacketPlanInputSchema,UspPacketImagePdfReceiptSchema}
  from '../packages/contracts/src/usp/packet-image-pdf';
import {UspSnapshotManifestSchema,type RequestContext} from '../packages/contracts/src/usp';
import {createPacketPlan,confirmPacketPlan,executePacketPlan,readPacketPlan} from '../packages/server/src/modules/usp/packets/plan-service';
import {readPacketPdf,type PdfPacketIo} from '../packages/server/src/modules/usp/packets/pdf-service';
import {enqueuePacketPdfJob,readPacketPdfJob,readPacketPdfJobResult,controlPacketPdfJob} from '../packages/server/src/modules/usp/packets/pdf-jobs';
import {assemblePacketImagePdf} from '../packages/server/src/modules/usp/packets/image-pdf-render';
import {registryImageRegionSourceTx,imageRegionCitationId} from '../packages/server/src/modules/registry/registry-image-region-evidence';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {fingerprint,canonical} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {runPacketPdfJob} from '../packages/server/src/modules/usp/packets/pdf-worker';
import {inspectImageCheckpointRuntime,packetImageCheckpointRuntime} from '../packages/server/src/modules/usp/packets/image-checkpoint-runtime';

// Exact retained crop and committed citation are reused. Source/SQL/target/storage
// remain technical controls, not an authentic property association or live persistence.
const crops='E:/BhuAayam-data/task-data/desktop-packet-image-region-20261003';
const citations='E:/BhuAayam-data/task-data/desktop-reviewed-image-regions-20261003';
const subject='registry-image-region-technical-control',digest='a'.repeat(64);
const code=(value:string)=>(error:any)=>error.code===value;
class ImageDb{
  journey=JSON.parse(readFileSync(citations+'/png-journey.json','utf8'));
  citation=RegistryImageRegionCitationSchema.parse(this.journey.privateHistoricalEvidence.citations[0].pin);
  proof=PacketImageRegionProvenanceSchema.parse(JSON.parse(readFileSync(crops+'/png-provenance.json','utf8')));
  png=readFileSync(crops+'/png-region.png');
  siteId=this.journey.publicCommit.records[0].siteId;
  manifestId=randomUUID();ctx!:RequestContext;active=0;opens=0;releases=0;extracts=0;puts=0;reads=0;
  source:any;sourceCase:any;record:any;captured:any;history=new Map<number,any>();latest=1;
  checkpointAvailable=true;runtimeReads=0;runtimeChanged=false;recipeChanged=false;cropPuts=0;failPdfPut=false;commitLost=false;afterCropPut?:()=>void;afterPut?:()=>void;afterRead?:()=>void;failEvent=false;
  objects=new Map<string,Uint8Array>();queries:string[]=[];
  state={jobs:[] as any[],jobMeta:[] as any[],attempts:[] as any[],checkpoints:[] as any[],plans:[] as any[],confirmations:[] as any[],executions:[] as any[],receipts:[] as any[],packets:[] as any[],streams:[] as any[],events:[] as any[]};
  scope={kind:'snapshot' as const,scopeId:this.siteId,world:{namespace:'world',id:`registry-site/${this.siteId}`},
    manifestId:this.manifestId,snapshotDigest:digest,stage:'recorded' as const};
  target={ref:{namespace:'registry_record' as const,id:this.citation.target.recordId},revision:2};
  constructor(){
    const p=this.citation.document,binding=ingestionBinding(p.caseId);
    // Reconstruct the previously saved control envelope, then verify its exact
    // authority digest against the unchanged committed citation in init().
    this.source={id:p.sourceId,case_id:p.caseId,family_id:p.sourceId,revision:1,sha256:p.sourceSha256,bytes:p.sourceBytes,
      object_key:'technical-retained-image',name:'Technical image envelope',mime_type:'image/png',profile:'image-reference-v2',
      status:'needs_input',created_at:'2026-10-03T00:00:00Z',inspection:{status:'needs_input',
        documentOriginal:{version:'source-document/1',subject:binding.subject,format:'png',sha256:p.sourceSha256,
          bytes:p.sourceBytes,receivedAt:'2026-10-03T00:00:00Z'}}};
    this.sourceCase={id:p.caseId,site_id:this.siteId,revision:1,archived:false,context:null,frame:null};
    const body=structuredClone(this.journey.storedHistory),{documentCitations:_,...old}=body;
    assert.equal(fingerprint(old),this.citation.target.bodySha256);
    this.history.set(1,old);this.history.set(2,body);
    this.record={id:this.target.ref.id,site_id:this.siteId,kind:'building',revision:2,identifier:'technical-reference',body};this.capture();
  }
  capture(){this.captured={...structuredClone(this.record),project_code:null,project_status:null,project_location:null,
    projectIdentity:null,historicalAliases:[]};}
  async init(){const current=await registryImageRegionSourceTx({query:this.query.bind(this)} as any,this.siteId,this.citation.document);
    assert.equal(current.authority.authoritySha256,this.citation.authoritySha256);
    assert.equal(imageRegionCitationId(this.citation),this.citation.id);
    assert.equal(sha256(this.png),this.citation.validation.output.sha256);this.queries=[];}
  manifest(){return UspSnapshotManifestSchema.parse({schemaVersion:'usp/1',id:this.manifestId,digest,scope:this.scope,
    capturedAt:'2026-10-03T00:00:00Z',selection:{kind:'targets',pins:[this.target]},
    members:[{pin:this.target,bodySha256:fingerprint(this.captured),
      bodyRef:fingerprint([this.target.ref.namespace,this.target.ref.id,this.target.revision,this.captured]),authority:'registry'}],
    frame:{horizontal:null,vertical:null,unit:null,transform:null},accessViewId:this.ctx.accessViewId,policyVersion:this.ctx.policyVersion,
    validAt:null,asOf:null,coverage:{state:'complete',reasonCodes:[]}});}
  pool={query:(q:string,v:any[])=>this.query(q,v),connect:async()=>{this.opens++;let baseline:typeof this.state;
    return {release:()=>{this.releases++;},query:async(q:string,v:any[]=[])=>{
      if(q==='BEGIN'){baseline=structuredClone(this.state);this.active++;}
      if(q==='ROLLBACK')this.state=baseline!;
      const result=await this.query(q,v);if(q==='COMMIT'||q==='ROLLBACK')this.active--;if(q==='COMMIT'&&this.commitLost){this.commitLost=false;throw new Error('CONTROL lost COMMIT acknowledgement');}return result;
    }} as unknown as PoolClient;}} as unknown as Pool;
  async query(sql:string,v:any[]=[]){const q=sql.replace(/\s+/g,' ').trim();this.queries.push(q);
    const rows=(value:any[]=[])=>({rows:value,rowCount:value.length});
    if(['BEGIN','COMMIT','ROLLBACK'].includes(q)||q.includes('pg_advisory_xact_lock'))return rows();
    if(q.startsWith('SELECT set_config'))return rows([{deadline_live:true}]);
    if(q.startsWith("SELECT to_regclass('usp_packet_pdf_entry_checkpoints')"))return rows([{available:this.checkpointAvailable}]);
    if(q.includes('FROM usp_packet_pdf_entry_checkpoints')){
      const found=this.state.checkpoints.filter(c=>c.job_id===v[0]&&(!q.includes('entry_index=$2')||c.entry_index===v[1]));
      return rows(found.map(c=>structuredClone(c)));}
    if(q.startsWith('INSERT INTO usp_packet_pdf_entry_checkpoints')){
      assert(!this.state.checkpoints.some(c=>c.job_id===v[1]&&c.entry_index===v[4]));
      this.state.checkpoints.push({id:v[0],job_id:v[1],plan_id:v[2],plan_version:v[3],entry_index:v[4],identity_sha256:v[5],
        artifact_sha256:v[6],artifact_bytes:v[7],object_key:v[8],accepted_attempt:v[9],accepted_fence:v[10],body:structuredClone(v[11]),body_sha256:v[12]});return rows();}
    if(q.startsWith('INSERT INTO jobs')){this.state.jobs.push({id:v[0],case_id:v[1],source_id:v[2],operation:'packet-pdf',case_revision:v[3],
      input_fingerprint:v[4],payload:structuredClone(v[5]),status:'queued',attempts:0,error:null,created_at:new Date().toISOString()});return rows();}
    if(q.startsWith('SELECT id FROM jobs WHERE operation='))return rows(this.state.jobs.filter(j=>j.payload.command.planId===v[0]&&String(j.payload.command.version)===v[1]));
    if(q.startsWith('SELECT j.*')&&q.includes('FROM jobs')){
      const job=this.state.jobs.find(j=>j.id===v[0]),meta=this.state.jobMeta.find(j=>j.job_id===v[0]);return rows(job&&meta?[{...structuredClone(job),...structuredClone(meta),id:job.id}]:[]);}
    if(q.includes('FROM jobs'))return rows(this.state.jobs.filter(j=>j.id===v[0]).map(j=>structuredClone(j)));
    if(q.startsWith('INSERT INTO usp_job_metadata')){this.state.jobMeta.push({job_id:v[0],input_manifest_id:v[1],input_sha256:v[2],scope:structuredClone(v[3]),
      version:1,logical_state:'queued',result_ref:null,accepted_fence:null});return rows();}
    if(q.includes('FROM usp_job_metadata'))return rows(this.state.jobMeta.filter(m=>m.job_id===v[0]).map(m=>structuredClone(m)));
    if(q.startsWith('INSERT INTO usp_job_attempts')){const lease_until=new Date(Date.now()+180000).toISOString();
      this.state.attempts.push({job_id:v[0],number:v[1],fence:v[2],owner:v[3],input_sha256:v[4],lease_until,state:'active',completion_sha256:null});return rows([{lease_until}]);}
    if(q.includes('FROM usp_job_attempts')){let found=this.state.attempts.filter(a=>a.job_id===v[0]);
      if(q.includes('AND number=$2'))found=found.filter(a=>a.number===v[1]);
      if(q.includes('AND fence=$2'))found=found.filter(a=>a.fence===Number(v[1])&&a.state==='accepted');
      if(q.includes('LIMIT 1'))found=found.sort((a,b)=>b.number-a.number).slice(0,1);return rows(found.map(a=>structuredClone(a)));}
    if(q.startsWith('UPDATE usp_job_attempts')){for(const a of this.state.attempts.filter(a=>a.job_id===v[0])){
      if(q.includes("state='accepted'")&&a.number===v[2]){a.state='accepted';a.completion_sha256=v[1];}
      if(q.includes("state='fenced'")&&a.state==='active')a.state='fenced';}return rows();}
    if(q.startsWith('UPDATE usp_job_metadata')){const meta=this.state.jobMeta.find(m=>m.job_id===v[0]);
      meta.logical_state=q.match(/logical_state='([^']+)'/)![1];meta.version++;
      if(q.includes('result_ref=$2')){meta.result_ref=structuredClone(v[1]);meta.accepted_fence=v[2];}return rows();}
    if(q.startsWith('UPDATE jobs')){const job=this.state.jobs.find(j=>j.id===v[0]);
      job.status=q.includes('status=$2')?v[1]:q.match(/status='([^']+)'/)![1];if(q.includes('attempts=$2'))job.attempts=v[1];
      job.error=q.includes('error=$3')?v[2]:q.includes("error='PACKET_PDF_CANCELLED'")?'PACKET_PDF_CANCELLED':null;return rows();}
    if(q.includes('FROM cases'))return rows(v[0]===this.sourceCase.id?[structuredClone(this.sourceCase)]:[]);
    if(q.includes('SELECT max(revision)'))return rows([{revision:this.latest}]);
    if(q.includes('FROM sources'))return rows(v[q.includes('WHERE case_id=')?1:0]===this.source.id?[structuredClone(this.source)]:[]);
    if(q.includes('FROM registry_sites'))return rows([{id:this.siteId}]);
    if(q.includes('FROM registry_records'))return rows(v[0]===this.record.id&&v[1]===this.siteId?
      [{...structuredClone(this.record),...q.includes('project_code')?{project_code:null,project_status:null,project_location:null}:{project_status:null}}]:[]);
    if(q.includes('FROM registry_revisions'))return rows(this.history.has(v[1])?[{body:structuredClone(this.history.get(v[1]))}]:[]);
    if(q.includes('FROM registry_aliases')||q.includes('FROM usp_project_lineage'))return rows();
    if(q.startsWith('SELECT body FROM usp_snapshots'))return rows([{body:this.manifest()}]);
    if(q.includes('FROM usp_snapshot_bodies'))return rows([{body:structuredClone(this.captured),body_sha256:fingerprint(this.captured)}]);
    if(q.startsWith('SELECT clock_timestamp()'))return rows([{live:Date.parse(v[0])>Date.now()}]);
    if(q.startsWith('SELECT max(version)'))return rows([{version:Math.max(...this.state.plans.filter(p=>p.id===v[0]).map(p=>p.version))}]);
    if(q.includes('FROM usp_packet_plans'))return rows(this.state.plans.filter(p=>p.id===v[0]&&p.version===v[1]));
    if(q.includes('FROM usp_packet_plan_confirmations'))return rows(this.state.confirmations.filter(p=>p.plan_id===v[0]&&p.version===v[1]));
    if(q.includes('FROM usp_packet_plan_executions'))return rows(this.state.executions.filter(p=>q.includes('packet_id=')?p.packet_id===v[0]:p.plan_id===v[0]&&p.version===v[1]));
    if(q.includes('FROM usp_command_receipts'))return rows(this.state.receipts.filter(p=>p.subject===v[0]&&p.scope_key===v[1]&&p.operation===v[2]&&p.request_key===v[3]));
    if(q.includes('FROM usp_packets'))return rows(this.state.packets.filter(p=>p.id===v[0]));
    if(q.startsWith('INSERT INTO usp_packet_plans')){this.state.plans.push({id:v[0],version:v[1],body:structuredClone(v[5])});return rows();}
    if(q.startsWith('INSERT INTO usp_packet_plan_confirmations')){this.state.confirmations.push({plan_id:v[1],version:v[2],body:structuredClone(v[4])});return rows();}
    if(q.startsWith('INSERT INTO usp_packet_plan_executions')){this.state.executions.push({plan_id:v[0],version:v[1],packet_id:v[3],body:structuredClone(v[4])});return rows();}
    if(q.startsWith('INSERT INTO usp_packets')){this.state.packets.push({id:v[0],artifact_hash:v[4],object_key:v[5],body:structuredClone(v[6])});return rows();}
    if(q.startsWith('INSERT INTO usp_command_receipts')){this.state.receipts.push({subject:v[1],scope_key:v[2],operation:v[3],request_key:v[4],command_sha256:v[5],body:structuredClone(v[6])});return rows();}
    if(q.startsWith('INSERT INTO usp_outbox_streams')){if(!this.state.streams.some(s=>s.id===v[0]))this.state.streams.push({id:v[0],sequence:0});return rows();}
    if(q.startsWith('UPDATE usp_outbox_streams'))return rows([{sequence:String(++this.state.streams.find(s=>s.id===v[0]).sequence)}]);
    if(q.startsWith('INSERT INTO usp_outbox(')){if(this.failEvent)throw new Error('CONTROL atomic publication failed');this.state.events.push(v[2]);return rows();}
    throw new Error('Unmodelled image packet SQL: '+q);
  }
  pdf:PdfPacketIo={extract:async()=>{throw new Error('Original image must not use PDF page extraction');},
    imageExtract:async(source,raw:any)=>{assert.equal(this.active,0);this.extracts++;
      assert.equal(source,this.source.id);assert.deepEqual(raw.selection,this.citation.region);
      return {bytes:this.png,provenance:{...this.proof,...this.citation.document}} as any;},
    put:async(key,bytes,type)=>{assert.equal(this.active,0);assert(['image/png','application/pdf'].includes(type));if(type==='application/pdf'){this.puts++;if(this.failPdfPut)throw new Error('CONTROL post-checkpoint publication failure');}else this.cropPuts++;
      this.objects.set(key,Buffer.from(bytes));if(type==='image/png')this.afterCropPut?.();else this.afterPut?.();},
    read:async(key,bytes,hash)=>{assert.equal(this.active,0);this.reads++;const value=this.objects.get(key);assert(value);
      assert.equal(value.length,bytes);assert.equal(sha256(value),hash);this.afterRead?.();return value;},
    recipe:async()=>{throw new Error('Image recovery must not read a PDF renderer recipe');},
    imageRuntime:async deadline=>{assert.equal(this.active,0);assert(deadline>Date.now()&&deadline<=Date.now()+60_000);this.runtimeReads++;
      const {pythonSha256,launcherSha256,pillowImageSha256,imagingSha256}=this.citation.validation.runtime;
      return {recipe:{...this.citation.validation.recipe,...this.recipeChanged?{workerSha256:'0'.repeat(64)}:{}},runtime:{pythonSha256,launcherSha256,pillowImageSha256,
        imagingSha256:this.runtimeChanged?'0'.repeat(64):imagingSha256}};}};
  io={pdf:this.pdf,read:async()=>{throw new Error('No original read');},put:async()=>{throw new Error('No PACK0 write');}};
  input(bindingId=this.citation.id){return UspImagePdfPacketPlanInputSchema.parse({target:this.target,scope:this.scope,
    purpose:'record_evidence',format:'pdf',recipe:PACKET_IMAGE_PDF_RECIPE,expiresAt:new Date(Date.now()+3600000).toISOString(),
    entries:[{bindingId,required:true,inclusionReason:'Reuse exact previously committed technical image inclusion'}]});}
  async confirmed(){const plan=await createPacketPlan(this.ctx,{input:this.input(),guard:{mode:'create',requestKey:randomUUID()}},this.io);
    const confirmation=await confirmPacketPlan(this.ctx,confirmationCommand(this,plan),this.io);
    return {plan,confirmation,command:{planId:plan.planId,version:plan.version,confirmationId:confirmation.confirmationId,
      guard:{mode:'create' as const,requestKey:randomUUID()}}};}
}
const confirmationCommand=(db:ImageDb,plan:any)=>({planId:plan.planId,version:plan.version,planSha256:plan.planSha256,reviewed:true,
  guard:{mode:'update',requestKey:randomUUID(),expectedVersion:plan.version,expectedManifestId:db.manifestId}});
async function control(work:(db:ImageDb)=>Promise<void>){const global=globalThis as unknown as {ulpinPool?:Pool},oldPool=global.ulpinPool,
  oldSubject=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
  const db=new ImageDb();global.ulpinPool=db.pool;db.ctx=localRequestContext(randomUUID());
  try{await db.init();await work(db);assert.equal(db.opens,db.releases);assert.equal(db.active,0);}
  finally{global.ulpinPool=oldPool;if(oldSubject===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=oldSubject;}}

async function queued(db:ImageDb){const confirmed=await db.confirmed();return {...confirmed,queued:await enqueuePacketPdfJob(db.ctx,confirmed.command)};}
async function status(db:ImageDb,id:string){const before=[db.reads,db.extracts,db.puts,db.cropPuts,db.runtimeReads];
  const value=await readPacketPdfJob(db.ctx,id);assert.deepEqual([db.reads,db.extracts,db.puts,db.cropPuts,db.runtimeReads],before);
  assert.equal(value.entryProgress.currentReuseEligibility,'not_assessed');return value;}
async function retry(db:ImageDb,id:string){const failed=await status(db,id);return controlPacketPdfJob(db.ctx,
  {jobId:id,action:'retry',expectedVersion:failed.version,requestKey:randomUUID()});}
const save=(file:string,value:unknown)=>{const root=process.env.ULPIN_PACKET_IMAGE_RECOVERY_EVIDENCE;if(root){mkdirSync(root,{recursive:true});
  writeFileSync(join(root,file),typeof value==='string'?value:JSON.stringify(value,null,2),{flag:'wx'});}};

test('image queue: accepted crop survives post-checkpoint failure, retry reuses it and returns the unchanged private PDF',()=>control(async db=>{
  const {plan,confirmation,command,queued:q}=await queued(db),id=q.jobId;
  assert.equal(q.status,'queued');assert.equal(q.entryProgress.acceptedCount,0);assert.equal(db.extracts,0);
  assert.equal((await enqueuePacketPdfJob(db.ctx,command)).jobId,id);
  await assert.rejects(()=>readPacketPdfJobResult(db.ctx,id,db.pdf),code('PACKET_PDF_NOT_READY'));
  db.failPdfPut=true;await runPacketPdfJob(id,db.pdf);const failed=await status(db,id);
  assert.equal(failed.status,'failed');assert.equal(failed.result,null);assert.equal(failed.entryProgress.acceptedCount,1);
  assert.equal(db.state.checkpoints.length,1);assert.equal(db.state.packets.length,0);assert.equal(db.extracts,1);assert.equal(db.cropPuts,1);
  const checkpoint=structuredClone(db.state.checkpoints[0]);
  assert.equal(checkpoint.body.version,'packet-image-pdf-entry-checkpoint/1');
  assert.equal(checkpoint.body.identity.version,'packet-image-pdf-entry/1');
  assert.deepEqual(checkpoint.body.identity.validation,db.citation.validation);
  await assert.rejects(()=>readPacketPdfJobResult(db.ctx,id,db.pdf),code('PACKET_PDF_NOT_READY'));
  const requeued=await retry(db,id);assert.equal(requeued.status,'queued');assert.equal(requeued.entryProgress.acceptedCount,1);
  db.failPdfPut=false;await runPacketPdfJob(id,db.pdf);const accepted=await status(db,id),download=await readPacketPdfJobResult(db.ctx,id,db.pdf);
  assert.equal(accepted.status,'succeeded');assert.equal(accepted.attempt.number,2);assert.equal(accepted.attempt.fence,2);
  assert.equal(accepted.entryProgress.acceptedCount,1);assert.equal(db.extracts,1);assert.equal(db.cropPuts,1);assert.equal(db.runtimeReads,5);
  assert.deepEqual(db.state.checkpoints[0],checkpoint);assert.equal(db.state.packets.length,1);assert.equal(db.state.executions.length,1);
  const prior=readFileSync('E:/BhuAayam-data/task-data/desktop-packet-image-pdf-20261003/packet.pdf');
  assert.deepEqual(download.bytes,prior);assert.equal(prior.length,60397);
  assert.equal(sha256(download.bytes),'1893b7bb2bf26b3ebe54b99fbdfd432dd5d1878901bb8a9744043a1ad4f2eb39');
  assert.equal(UspPacketImagePdfReceiptSchema.parse(download.receipt).artifact.sha256,accepted.result?.artifact.sha256);
  const counts=[db.extracts,db.reads,db.runtimeReads];await runPacketPdfJob(id,db.pdf);assert.deepEqual([db.extracts,db.reads,db.runtimeReads],counts);
  const encoded=JSON.stringify([q,failed,requeued,accepted]);
  for(const privateValue of [db.source.id,db.source.name,checkpoint.object_key,db.citation.validation.runtime.imagingSha256])assert(!encoded.includes(privateValue));
  save('journey.json',{classification:'retained_crop_citation_and_actual_PDF; controlled_source_target_SQL_storage_extractor_current_runtime',
    priorImagePdfJourneySha256:sha256(readFileSync('E:/BhuAayam-data/task-data/desktop-packet-image-pdf-20261003/journey.json')),
    plan,confirmation,queued:q,failed,requeued,accepted,checkpoint,attempts:db.state.attempts,execution:db.state.executions[0].body,
    download:{bytes:download.bytes.length,sha256:sha256(download.bytes)},extracts:db.extracts,cropPuts:db.cropPuts,runtimeReads:db.runtimeReads});
  const root=process.env.ULPIN_PACKET_IMAGE_RECOVERY_EVIDENCE;if(root)writeFileSync(join(root,'packet.pdf'),download.bytes,{flag:'wx'});
}));

test('image recovery: current decoder drift and revoked source deny reuse; receipt-only status does not qualify runtime',()=>control(async db=>{
  const {queued:q}=await queued(db),id=q.jobId;db.failPdfPut=true;await runPacketPdfJob(id,db.pdf);
  const first=structuredClone(db.state.checkpoints[0]),reads=db.reads;
  await retry(db,id);db.runtimeChanged=true;await runPacketPdfJob(id,db.pdf);
  const drifted=await status(db,id);assert.equal(drifted.status,'failed');assert.equal(drifted.errorCode,'PACKET_PDF_INPUT_STALE');
  assert.equal(drifted.entryProgress.acceptedCount,1);assert.equal(db.reads,reads);assert.equal(db.extracts,1);
  db.runtimeChanged=false;await retry(db,id);db.sourceCase.archived=true;const runtimeReads=db.runtimeReads;
  await runPacketPdfJob(id,db.pdf);assert.equal(db.state.jobs[0].error,'PACKET_PDF_ACCESS_REVOKED');
  await assert.rejects(()=>readPacketPdfJob(db.ctx,id),code('DOCUMENT_DENIED'));
  assert.equal(db.runtimeReads,runtimeReads);assert.equal(db.reads,reads);assert.equal(db.extracts,1);
  assert.deepEqual(db.state.checkpoints[0],first);assert.equal(db.state.packets.length,0);
  save('denials.json',{decoderDriftStatus:drifted,sourceRevokedJobError:db.state.jobs[0].error,extracts:db.extracts,
    readsBefore:reads,readsAfter:db.reads,acceptedCheckpointUnchanged:true,resultPublished:false});
}));

test('image recovery: changed physical recipe bytes deny before extraction without normalizing hashes',()=>control(async db=>{
  const {queued:q}=await queued(db);db.recipeChanged=true;
  await runPacketPdfJob(q.jobId,db.pdf);
  assert.equal((await status(db,q.jobId)).errorCode,'PACKET_PDF_INPUT_STALE');
  assert.equal(db.extracts,0);assert.equal(db.reads,0);assert.equal(db.state.checkpoints.length,0);
}));

test('image recovery: missing schema refuses before crop I/O; synchronous execution and uncertain checkpoint commit remain useful',async()=>{
  await control(async db=>{const {command,queued:q}=await queued(db);db.checkpointAvailable=false;
    await runPacketPdfJob(q.jobId,db.pdf);const failed=await status(db,q.jobId);
    assert.equal(failed.errorCode,'PACKET_PDF_CHECKPOINT_UNAVAILABLE');assert.equal(failed.entryProgress.checkpointCapability,'unavailable');
    assert.equal(failed.entryProgress.acceptedCount,null);assert.equal(db.extracts,0);assert.equal(db.reads,0);assert.equal(db.runtimeReads,0);
    const output=await executePacketPlan(db.ctx,command,db.io);assert.equal(output.packet.status,'complete');assert.equal(db.extracts,1);
    save('missing-schema.json',{status:failed,cropIOBeforeRefusal:0,synchronousArtifact:output.packet.artifact});});
  await control(async db=>{const {queued:q}=await queued(db);db.afterCropPut=()=>{db.afterCropPut=undefined;db.commitLost=true;};
    await runPacketPdfJob(q.jobId,db.pdf);assert.equal(db.state.jobs[0].status,'running');assert.equal(db.state.checkpoints.length,1);
    assert.equal(db.state.packets.length,0);const first=structuredClone(db.state.checkpoints[0]);
    db.state.attempts[0].lease_until=new Date(Date.now()-1).toISOString();await runPacketPdfJob(q.jobId,db.pdf);
    assert.equal((await status(db,q.jobId)).status,'succeeded');assert.equal(db.extracts,1);assert.deepEqual(db.state.checkpoints[0],first);
    save('uncertain-commit.json',{checkpoint:first,attempts:db.state.attempts,status:await status(db,q.jobId),extracts:db.extracts});});
});

test('file-only image runtime resolution checks the base-first actual binary and refuses executable import hooks',async()=>{
  const root=mkdtempSync(join(tmpdir(),'ulpin-image-pins-'));
  try{
    const base=join(root,'base'),venv=join(root,'venv'),basePil=join(base,'Lib/site-packages/PIL'),venvPil=join(venv,'Lib/site-packages/PIL');
    for(const dir of [basePil,venvPil,join(venv,'Scripts')])mkdirSync(dir,{recursive:true});
    const fixtures={base:Buffer.from('NON-EXECUTABLE base Python control'),launcher:Buffer.from('NON-EXECUTABLE launcher control'),
      image:Buffer.from('NON-EXECUTABLE Image.py control'),imaging:Buffer.from('NON-EXECUTABLE native imaging control')};
    const selected=join(venv,'Scripts/python.exe'),native=join(basePil,'_imaging.cp312-win_amd64.pyd');
    writeFileSync(join(base,'python.exe'),fixtures.base);writeFileSync(selected,fixtures.launcher);
    writeFileSync(join(venv,'pyvenv.cfg'),'home = '+base+'\n');writeFileSync(join(basePil,'Image.py'),fixtures.image);writeFileSync(native,fixtures.imaging);
    writeFileSync(join(venvPil,'Image.py'),'unselected venv copy');writeFileSync(join(venvPil,'_imaging.cp312-win_amd64.pyd'),'unselected venv binary');
    const first=await inspectImageCheckpointRuntime(selected,Date.now()+3000);
    assert.deepEqual(first,{pythonSha256:sha256(fixtures.base),launcherSha256:sha256(fixtures.launcher),
      pillowImageSha256:sha256(fixtures.image),imagingSha256:sha256(fixtures.imaging)});
    writeFileSync(native,'changed actual base binary');assert.notEqual((await inspectImageCheckpointRuntime(selected,Date.now()+3000)).imagingSha256,first.imagingSha256);
    writeFileSync(join(base,'Lib/site-packages/unknown.pth'),'import redirect_decoder\n');
    await assert.rejects(()=>inspectImageCheckpointRuntime(selected,Date.now()+3000),code('PACKET_IMAGE_CHECKPOINT_RUNTIME_UNAVAILABLE'));
    save('file-runtime-control.json',{classification:'NON-EXECUTABLE filesystem controls; no interpreter/decoder launched',
      baseFirstPins:first,actualBinaryDriftObserved:true,executableStartupHookRefused:true});
  }finally{assert(root.startsWith(join(tmpdir(),'ulpin-image-pins-')));rmSync(root,{recursive:true,force:true});}
});

const configuredImagePython = process.env.ULPIN_DOCUMENT_IMAGES_PYTHON;
const imageInterpreterMissing = configuredImagePython ? '' : ' — no image interpreter configured';
const imageRuntimeTestOptions = { skip: configuredImagePython ? false : 'no image interpreter configured' };

test('configured image interpreter resolves accepted stable pins without execution' + imageInterpreterMissing,
  imageRuntimeTestOptions, async () => {
    const pins = await inspectImageCheckpointRuntime(configuredImagePython!, Date.now() + 10_000);
    const second = await inspectImageCheckpointRuntime(configuredImagePython!, Date.now() + 10_000);
    assert.deepEqual(second, pins);
    const current = await packetImageCheckpointRuntime(Date.now() + 10_000);
    assert.deepEqual(current.runtime, pins);
    // Recipe pins still describe this checkout's physical bytes, never historical normalized hashes.
    const script = 'scripts/usp/document-models/';
    assert.equal(current.recipe.workerSha256, sha256(readFileSync(script + 'run_image_region.py')));
    assert.equal(current.recipe.decoderSha256, sha256(readFileSync(script + 'run_image_inspection.py')));
    assert.equal(current.recipe.supervisorSha256, sha256(readFileSync(script + 'run_trial.py')));
    save('configured-runtime-files.json', {
      classification: 'file-only resolution; no interpreter/import/decoder execution or runtime readiness claim',
      configured: configuredImagePython, pins, recipe: current.recipe, stableAcrossTwoInspections: true,
    });
  });

async function assertHistoricalBindingRefused(current: Awaited<ReturnType<typeof packetImageCheckpointRuntime>>) {
  await control(async db => {
    const { queued: job } = await queued(db);
    db.failPdfPut = true;
    await runPacketPdfJob(job.jobId, db.pdf);
    assert.equal((await status(db, job.jobId)).status, 'failed');
    assert.equal(db.state.checkpoints.length, 1);
    const checkpoint = structuredClone(db.state.checkpoints[0]);
    const before = [db.reads, db.extracts, db.cropPuts];
    await retry(db, job.jobId);
    db.failPdfPut = false;
    // Hold the controlled recipe constant: real current runtime pins alone must deny the old crop.
    db.pdf.imageRuntime = async () => ({ recipe: db.citation.validation.recipe, runtime: current.runtime });
    await runPacketPdfJob(job.jobId, db.pdf);
    const refused = await status(db, job.jobId);
    assert.equal(refused.status, 'failed');
    assert.equal(refused.errorCode, 'PACKET_PDF_INPUT_STALE');
    assert.deepEqual([db.reads, db.extracts, db.cropPuts], before);
    assert.deepEqual(db.state.checkpoints[0], checkpoint);
    assert.equal(db.state.packets.length, 0);
    save('historical-runtime-refusal.json', {
      scope: 'existing checkpoint guard; historical recipe held constant to isolate actual runtime-pin drift',
      historicalRuntime: db.citation.validation.runtime, currentPins: current.runtime,
      historicalRecipeMatches: canonical(current.recipe) === canonical(db.citation.validation.recipe),
      status: refused.status, errorCode: refused.errorCode, cropReadsAfterRefusal: 0,
      retainedCheckpointUnchanged: true,
    });
  });
}

test('historical image binding with different current pins is refused before accepted crop reuse'
  + imageInterpreterMissing, imageRuntimeTestOptions, async () => {
    const current = await packetImageCheckpointRuntime(Date.now() + 10_000);
    const provenance = PacketImageRegionProvenanceSchema.parse(
      JSON.parse(readFileSync(crops + '/png-provenance.json', 'utf8')));
    const expected = provenance.runtime;
    const historicalPins = {
      pythonSha256: expected.pythonSha256, launcherSha256: expected.launcherSha256,
      pillowImageSha256: expected.pillowImageSha256, imagingSha256: expected.imagingSha256,
    };
    assert.notDeepEqual(current.runtime, historicalPins, 'this historical binding needs a newly reviewed runtime');
    await assertHistoricalBindingRefused(current);
  });

import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import type {Pool,PoolClient} from 'pg';
import {RegistryImageRegionCitationSchema} from '../packages/contracts/src/registry-document-evidence';
import {PacketImageRegionProvenanceSchema} from '../packages/contracts/src/packet-image-region';
import {UspSnapshotManifestSchema,type RequestContext} from '../packages/contracts/src/usp';
import {createPacketPlan,confirmPacketPlan,executePacketPlan,readPacketPlan} from '../packages/server/src/modules/usp/packets/plan-service';
import {readPacketPdf,capturePacketPdfTx,type PdfPacketIo} from '../packages/server/src/modules/usp/packets/pdf-service';
import {enqueuePacketPdfJob,readPacketPdfJob,readPacketPdfJobResult,controlPacketPdfJob} from '../packages/server/src/modules/usp/packets/pdf-jobs';
import {registryImageRegionSourceTx,imageRegionCitationId} from '../packages/server/src/modules/registry/registry-image-region-evidence';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {unzipSync} from 'fflate';
import {PacketRegionWorkerSchema} from '../packages/contracts/src/packet-region';
import {RegistryRegionCitationSchema} from '../packages/contracts/src/registry-document-evidence';
import {PACKET_MIXED_PDF_RECIPE,UspMixedPdfPacketPlanInputSchema,UspPacketMixedPdfReceiptSchema} from '../packages/contracts/src/usp/packet-mixed-pdf';
import {PacketMixedPdfBundleManifestSchema} from '../packages/contracts/src/usp/packet-pdf-bundle';
import {readPacketPdfBundle} from '../packages/server/src/modules/usp/packets/pdf-bundle';
import {assemblePacketMixedPdf} from '../packages/server/src/modules/usp/packets/mixed-pdf-render';
import {registryRegionSourceTx,regionCitationId} from '../packages/server/src/modules/registry/registry-region-evidence';
import {generatePropertyCard,readPropertyCard,resolvePropertyCard,type PropertyCardIo} from '../packages/server/src/modules/usp/packets/card-service';
import {transaction} from '../packages/server/src/infrastructure/db';
import {runPacketPdfJob} from '../packages/server/src/modules/usp/packets/pdf-worker';

// Exact retained crop and committed citation are reused. Source/SQL/target/storage
// remain technical controls, not an authentic property association or live persistence.
const crops='E:/BhuAayam-data/task-data/desktop-packet-image-region-20261003';
const citations='E:/BhuAayam-data/task-data/desktop-reviewed-image-regions-20261003';
const subject='registry-image-region-technical-control',digest='a'.repeat(64);
const code=(value:string)=>(error:any)=>error.code===value;
class MixedDb{
  journey=JSON.parse(readFileSync(citations+'/png-journey.json','utf8'));
  citation=RegistryImageRegionCitationSchema.parse(this.journey.privateHistoricalEvidence.citations[0].pin);
  proof=PacketImageRegionProvenanceSchema.parse(JSON.parse(readFileSync(crops+'/png-provenance.json','utf8')));
  png=readFileSync(crops+'/png-region.png');
  pdfRoot='E:/BhuAayam-data/task-data/desktop-packet-region-extract-20261002/real-crop-02';
  pdfRegion=PacketRegionWorkerSchema.parse(JSON.parse(readFileSync(this.pdfRoot+'/result.json','utf8')));
  pdfCrop=readFileSync(this.pdfRoot+'/region.png');pdfCitation:any;
  pdfSourceId=randomUUID();pdfCaseId=randomUUID();pdfSource:any;pdfCase:any;
  siteId=this.journey.publicCommit.records[0].siteId;
  manifestId=randomUUID();ctx!:RequestContext;active=0;opens=0;releases=0;extracts=0;puts=0;reads=0;pdfExtracts=0;imageExtracts=0;failImageOnce=false;
  source:any;sourceCase:any;record:any;captured:any;history=new Map<number,any>();latest=1;
  checkpointAvailable=true;runtimeReads=0;runtimeChanged=false;recipeChanged=false;cropPuts=0;failPdfPut=false;commitLost=false;afterCropPut?:()=>void;afterPut?:()=>void;afterRead?:()=>void;failEvent=false;
  objects=new Map<string,Uint8Array>();queries:string[]=[];
  state={cards:[] as any[],jobs:[] as any[],jobMeta:[] as any[],attempts:[] as any[],checkpoints:[] as any[],plans:[] as any[],confirmations:[] as any[],executions:[] as any[],receipts:[] as any[],packets:[] as any[],streams:[] as any[],events:[] as any[]};
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
    const pdfBinding=ingestionBinding(this.pdfCaseId);
    this.pdfSource={id:this.pdfSourceId,case_id:this.pdfCaseId,family_id:this.pdfSourceId,revision:1,name:'Technical retained PDF original',
      sha256:this.pdfRegion.sourceSha256,bytes:this.pdfRegion.sourceBytes,object_key:'technical-only-no-original-io',profile:'pdf-reference-v2',status:'needs_input',
      inspection:{documentOriginal:{version:'source-document/1',subject:pdfBinding.subject,format:'pdf',sha256:this.pdfRegion.sourceSha256,
        bytes:this.pdfRegion.sourceBytes,receivedAt:'2026-10-02T00:00:00Z'}}};
    this.pdfCase={id:this.pdfCaseId,site_id:this.siteId,revision:1,archived:false,context:null,frame:null};
  }
  capture(){this.captured={...structuredClone(this.record),project_code:null,project_status:null,project_location:null,
    projectIdentity:null,historicalAliases:[]};}
  async init(){const current=await registryImageRegionSourceTx({query:this.query.bind(this)} as any,this.siteId,this.citation.document);
    assert.equal(current.authority.authoritySha256,this.citation.authoritySha256);
    assert.equal(imageRegionCitationId(this.citation),this.citation.id);
    assert.equal(sha256(this.png),this.citation.validation.output.sha256);
    const original={caseId:this.pdfCaseId,caseRevision:1,sourceId:this.pdfSourceId,sourceRevision:1,
      sourceSha256:this.pdfRegion.sourceSha256,sourceBytes:this.pdfRegion.sourceBytes};
    const pdfAuthority=await registryRegionSourceTx({query:this.query.bind(this)} as any,this.siteId,original);
    this.pdfCitation=RegistryRegionCitationSchema.parse({version:'registry-document-region-citation/1',id:digest,document:original,page:this.pdfRegion.page,
      region:this.pdfRegion.selection,purpose:'record_evidence',validation:this.pdfRegion,authoritySha256:pdfAuthority.authority.authoritySha256,
      target:{recordId:this.record.id,revision:2,bodySha256:fingerprint(this.record.body)},selection:{subject,accessSha256:ingestionBinding(this.pdfCaseId).access,
        selectedAt:'2026-10-03T00:00:00Z'},applicability:'explicit_officer_inclusion; effective_after_canonical_commit',associationState:'operator_selected',qualification:'not_assessed'});
    this.pdfCitation.id=regionCitationId(this.pdfCitation);
    // Separate current control revision adds the PDF association. The previous
    // committed image citation and its revision-1/2 history stay unchanged.
    this.record.revision=3;this.target.revision=3;this.record.body={...structuredClone(this.record.body),documentCitations:[this.citation,this.pdfCitation]};
    this.history.set(3,structuredClone(this.record.body));this.capture();this.queries=[];}
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
    if(q.includes('FROM cases'))return rows(v[0]===this.sourceCase.id?[structuredClone(this.sourceCase)]:v[0]===this.pdfCaseId?[structuredClone(this.pdfCase)]:[]);
    if(q.startsWith('SELECT max(revision) AS revision FROM usp_property_cards'))return rows([{revision:Math.max(0,...this.state.cards.filter(c=>c.id===v[0]).map(c=>c.revision))}]);
    if(q.includes('SELECT max(revision)'))return rows([{revision:this.latest}]);
    if(q.includes('FROM sources')){const selected=v[q.includes('WHERE case_id=')?1:0];return rows(selected===this.source.id?[structuredClone(this.source)]:selected===this.pdfSourceId?[structuredClone(this.pdfSource)]:[]);}
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
    if(q.includes('FROM usp_property_cards'))return rows(this.state.cards.filter(c=>c.id===v[0]&&c.revision===v[1]));
    if(q.startsWith('INSERT INTO usp_property_cards')){this.state.cards.push({id:v[0],revision:v[1],artifact_hash:v[8],object_key:v[9],body:structuredClone(v[10])});return rows();}
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
  pdf:PdfPacketIo={extract:async(source,page,raw:any,deadline)=>{assert.equal(this.active,0);assert(deadline&&deadline<=Date.now()+35_000);this.extracts++;this.pdfExtracts++;
      assert.equal(source,this.pdfSourceId);assert.equal(page,this.pdfRegion.page);assert.deepEqual(raw.selection,this.pdfRegion.selection);
      return {bytes:this.pdfCrop,provenance:{...this.pdfRegion,version:'packet-region/1',...this.pdfCitation.document,purpose:'private_source_preview'}};},
    imageExtract:async(source,raw:any)=>{assert.equal(this.active,0);this.extracts++;this.imageExtracts++;
      if(this.failImageOnce){this.failImageOnce=false;throw new Error('CONTROL later image extraction failed');}
      assert.equal(source,this.source.id);assert.deepEqual(raw.selection,this.citation.region);
      return {bytes:this.png,provenance:{...this.proof,...this.citation.document}} as any;},
    put:async(key,bytes,type)=>{assert.equal(this.active,0);assert(['image/png','application/pdf'].includes(type));if(type==='application/pdf'){this.puts++;if(this.failPdfPut)throw new Error('CONTROL post-checkpoint publication failure');}else this.cropPuts++;
      this.objects.set(key,Buffer.from(bytes));if(type==='image/png')this.afterCropPut?.();else this.afterPut?.();},
    read:async(key,bytes,hash)=>{assert.equal(this.active,0);this.reads++;const value=this.objects.get(key);assert(value);
      assert.equal(value.length,bytes);assert.equal(sha256(value),hash);this.afterRead?.();return value;},
    recipe:async source=>{assert.equal(this.active,0);assert.equal(source,this.pdfSourceId);return this.pdfRegion.recipeSha256;},
    imageRuntime:async deadline=>{assert.equal(this.active,0);assert(deadline>Date.now()&&deadline<=Date.now()+35_000);this.runtimeReads++;
      const {pythonSha256,launcherSha256,pillowImageSha256,imagingSha256}=this.citation.validation.runtime;
      return {recipe:{...this.citation.validation.recipe,...this.recipeChanged?{workerSha256:'0'.repeat(64)}:{}},runtime:{pythonSha256,launcherSha256,pillowImageSha256,
        imagingSha256:this.runtimeChanged?'0'.repeat(64):imagingSha256}};}};
  io={pdf:this.pdf,read:async()=>{throw new Error('No original read');},put:async()=>{throw new Error('No PACK0 write');}};
  cardIo:PropertyCardIo={pdf:this.pdf,readPacket:async()=>{throw new Error('No original/text packet read');},put:this.pdf.put,readCard:this.pdf.read};
  input(reverse=false){const entries=[{kind:'pdf_page_region',bindingId:this.pdfCitation.id,required:true,inclusionReason:'Controlled exact PDF-region inclusion'},
    {kind:'original_image_region',bindingId:this.citation.id,required:true,inclusionReason:'Controlled exact original-image inclusion'}];
    return UspMixedPdfPacketPlanInputSchema.parse({target:this.target,scope:this.scope,purpose:'record_evidence',format:'pdf',recipe:PACKET_MIXED_PDF_RECIPE,
      expiresAt:new Date(Date.now()+3600000).toISOString(),entries:reverse?entries.reverse():entries});}
  async confirmed(reverse=false){const plan=await createPacketPlan(this.ctx,{input:this.input(reverse),guard:{mode:'create',requestKey:randomUUID()}},this.io);
    const confirmation=await confirmPacketPlan(this.ctx,confirmationCommand(this,plan),this.io);
    return {plan,confirmation,command:{planId:plan.planId,version:plan.version,confirmationId:confirmation.confirmationId,
      guard:{mode:'create' as const,requestKey:randomUUID()}}};}
}
const confirmationCommand=(db:MixedDb,plan:any)=>({planId:plan.planId,version:plan.version,planSha256:plan.planSha256,reviewed:true,
  guard:{mode:'update',requestKey:randomUUID(),expectedVersion:plan.version,expectedManifestId:db.manifestId}});
async function control(work:(db:MixedDb)=>Promise<void>){const global=globalThis as unknown as {ulpinPool?:Pool},oldPool=global.ulpinPool,
  oldSubject=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
  const db=new MixedDb();global.ulpinPool=db.pool;db.ctx=localRequestContext(randomUUID());
  try{await db.init();await work(db);assert.equal(db.opens,db.releases);assert.equal(db.active,0);}
  finally{global.ulpinPool=oldPool;if(oldSubject===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=oldSubject;}}

const proofRoot=process.env.ULPIN_PACKET_MIXED_EVIDENCE;
function save(name:string,value:Uint8Array|object){if(proofRoot){mkdirSync(proofRoot,{recursive:true});
  writeFileSync(join(proofRoot,name),value instanceof Uint8Array?value:JSON.stringify(value,null,2),{flag:'wx'});}}
async function status(db:MixedDb,id:string){const before=[db.reads,db.extracts,db.runtimeReads];const result=await readPacketPdfJob(db.ctx,id);
  assert.deepEqual([db.reads,db.extracts,db.runtimeReads],before);assert.equal(result.entryProgress.currentReuseEligibility,'not_assessed');return result;}

test('mixed PDF/image: queued failure/retry reuses the accepted PDF crop; exact two-page private packet, ZIP and linked card',()=>control(async db=>{
  const {plan,confirmation,command}=await db.confirmed(),queued=await enqueuePacketPdfJob(db.ctx,command),id=queued.jobId;
  assert.equal(queued.entryProgress.requiredCount,2);assert.equal(queued.entryProgress.acceptedCount,0);assert.equal(db.extracts,0);
  db.failImageOnce=true;await runPacketPdfJob(id,db.pdf);const failed=await status(db,id);
  assert.equal(failed.status,'failed');assert.equal(failed.entryProgress.acceptedCount,1);assert.equal(failed.result,null);
  assert.equal(db.state.packets.length,0);assert.equal(db.state.checkpoints.length,1);const first=structuredClone(db.state.checkpoints[0]);
  assert.equal(first.body.version,'packet-pdf-entry-checkpoint/1');assert.equal(first.entry_index,0);
  const retry=await controlPacketPdfJob(db.ctx,{jobId:id,action:'retry',expectedVersion:failed.version,requestKey:randomUUID()});
  assert.equal(retry.entryProgress.acceptedCount,1);await runPacketPdfJob(id,db.pdf);
  const accepted=await status(db,id),download=await readPacketPdfJobResult(db.ctx,id,db.pdf),receipt=UspPacketMixedPdfReceiptSchema.parse(download.receipt);
  assert.equal(accepted.status,'succeeded');assert.equal(accepted.entryProgress.acceptedCount,2);assert.equal(accepted.attempt.number,2);
  assert.equal(db.pdfExtracts,1);assert.equal(db.imageExtracts,2);assert.equal(db.cropPuts,2);assert.deepEqual(db.state.checkpoints[0],first);
  assert.equal(db.state.checkpoints[1].body.version,'packet-image-pdf-entry-checkpoint/1');assert.equal(db.state.checkpoints[1].entry_index,1);
  assert.equal(receipt.assembly.output.pages,2);assert.deepEqual(receipt.entries.map(e=>e.kind),['pdf_page_region','original_image_region']);
  assert.deepEqual(receipt.assembly.entries.map(e=>e.derivative),[db.pdfRegion,db.citation.validation]);
  const expected=await assemblePacketMixedPdf(receipt.assembly.entries,async i=>i?db.png:db.pdfCrop);assert.deepEqual(download.bytes,expected.bytes);
  assert.deepEqual((await readPacketPlan(db.ctx,{planId:plan.planId,version:plan.version})).execution,db.state.executions[0].body);
  const bundle=await readPacketPdfBundle(db.ctx,receipt.packetId,{read:db.pdf.read,capture:(ctx,packetId,deadline)=>
    transaction(client=>capturePacketPdfTx(client,ctx,packetId),{deadlineAt:deadline})});
  const files=unzipSync(bundle.bytes);assert.deepEqual(Object.keys(files),['packet.pdf','manifest.json']);assert.deepEqual(Buffer.from(files['packet.pdf']),Buffer.from(download.bytes));
  const manifest=PacketMixedPdfBundleManifestSchema.parse(JSON.parse(Buffer.from(files['manifest.json']).toString('utf8')));
  assert.deepEqual(manifest.entries.map(e=>e.kind),['pdf_page_region','original_image_region']);
  const image=manifest.entries[1];assert.equal(image.kind,'original_image_region');if(image.kind==='original_image_region'){
    assert.deepEqual(image.locator,{kind:'original_image',frame:0});assert.equal(image.calibration,null);}
  const cardRequest={planId:plan.planId,planVersion:plan.version,cardId:null,expiresAt:new Date(Date.now()+3600000).toISOString(),
    guard:{mode:'create',requestKey:randomUUID()}},card=await generatePropertyCard(db.ctx,cardRequest,db.cardIo),exact={cardId:card.cardId,revision:card.revision};
  assert.equal(card.packetId,receipt.packetId);assert.equal(card.packetSha256,sha256(download.bytes));
  assert.deepEqual(card.evidenceEntrySha256,plan.entries.map(e=>e.entrySha256));
  assert(card.facts.filter(f=>['geometry','measurements','parcel_assertions','declared_share'].includes(f.key)).every(f=>f.state!=='available'));
  assert.deepEqual(await generatePropertyCard(db.ctx,cardRequest,db.cardIo),card);
  assert.deepEqual((await readPropertyCard(db.ctx,exact,db.cardIo)).card,card);const resolved=await resolvePropertyCard(db.ctx,exact,db.cardIo);
  assert.equal(sha256(resolved.bytes),card.artifact.sha256);
  save('packet.pdf',download.bytes);save('packet.zip',bundle.bytes);save('property-card.pdf',resolved.bytes);
  save('journey.json',{classification:'actual retained crops; controlled same-target citations/source envelopes/current recipe/SQL/storage/snapshot authority; no authentic crosswalk',
    originalImageCitationPreserved:db.citation,controlledPdfCitation:db.pdfCitation,plan,confirmation,queued,failed,retry,accepted,
    checkpoints:db.state.checkpoints,attempts:db.state.attempts,execution:db.state.executions[0].body,
    packet:{bytes:download.bytes.length,sha256:sha256(download.bytes)},bundle:{bytes:bundle.bytes.length,sha256:bundle.sha256,manifest},
    card,cardArtifact:{bytes:resolved.bytes.length,sha256:sha256(resolved.bytes)},pdfExtracts:db.pdfExtracts,imageExtracts:db.imageExtracts,
    cropPuts:db.cropPuts,currentRuntimeAuthority:'controlled pins; historical script byte drift remains production-ineligible'});
}));

test('mixed PDF/image: reversed synchronous order and full-set late revocation; incomplete/mismatched kinds cannot confirm',()=>control(async db=>{
  const invalid=db.input();assert.throws(()=>UspMixedPdfPacketPlanInputSchema.parse({...invalid,entries:[invalid.entries[0],invalid.entries[0]]}));
  const absent={...db.input(),entries:db.input().entries.map((e,i)=>i?e:{...e,bindingId:digest})};
  const blocked=await createPacketPlan(db.ctx,{input:absent,guard:{mode:'create',requestKey:randomUUID()}},db.io);
  assert.equal(blocked.requiredContext,'blocked');await assert.rejects(()=>confirmPacketPlan(db.ctx,confirmationCommand(db,blocked),db.io),code('PACKET_PLAN_BLOCKED'));
  assert.equal(db.extracts,0);const {plan,command}=await db.confirmed(true),execution=await executePacketPlan(db.ctx,command,db.io);
  const receipt=UspPacketMixedPdfReceiptSchema.parse(execution.packet);
  assert.deepEqual(receipt.entries.map(e=>e.kind),['original_image_region','pdf_page_region']);
  assert.deepEqual(receipt.assembly.entries.map(e=>e.derivative),[db.citation.validation,db.pdfRegion]);
  const download=await readPacketPdf(db.ctx,receipt.packetId,db.pdf);save('reversed.pdf',download.bytes);
  db.afterRead=()=>{db.pdfCase.archived=true;};await assert.rejects(()=>readPacketPdf(db.ctx,receipt.packetId,db.pdf),code('DOCUMENT_DENIED'));
  const reads=db.reads;await assert.rejects(()=>readPacketPdf(db.ctx,receipt.packetId,db.pdf),code('DOCUMENT_DENIED'));assert.equal(db.reads,reads);
  save('denial.json',{planId:plan.planId,reversedKinds:receipt.entries.map(e=>e.kind),unavailableRequiredContext:blocked.requiredContext,
    latePdfSourceRevocationRefused:true,noFurtherArtifactReads:true});
}));

test('mixed PDF/image: absent checkpoint schema and stale image runtime remain actionable without exposing partial results',async()=>{
  await control(async db=>{const {command}=await db.confirmed(),queued=await enqueuePacketPdfJob(db.ctx,command);db.checkpointAvailable=false;
    await runPacketPdfJob(queued.jobId,db.pdf);const failed=await status(db,queued.jobId);
    assert.equal(failed.errorCode,'PACKET_PDF_CHECKPOINT_UNAVAILABLE');assert.equal(failed.entryProgress.acceptedCount,null);
    assert.equal(db.extracts,0);assert.equal(db.runtimeReads,0);assert.equal(db.state.packets.length,0);
    save('missing-schema.json',{status:failed,extracts:db.extracts,runtimeReads:db.runtimeReads});});
  await control(async db=>{const {command}=await db.confirmed(),queued=await enqueuePacketPdfJob(db.ctx,command);db.runtimeChanged=true;
    await runPacketPdfJob(queued.jobId,db.pdf);const failed=await status(db,queued.jobId);
    assert.equal(failed.errorCode,'PACKET_PDF_INPUT_STALE');assert.equal(failed.entryProgress.acceptedCount,1);
    assert.equal(db.pdfExtracts,1);assert.equal(db.imageExtracts,0);assert.equal(db.state.packets.length,0);assert.equal(failed.result,null);
    save('runtime-denial.json',{status:failed,pdfExtracts:db.pdfExtracts,imageExtracts:db.imageExtracts,readyPackets:db.state.packets.length});});
});

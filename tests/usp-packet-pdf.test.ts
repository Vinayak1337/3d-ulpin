import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import type {Pool,PoolClient} from 'pg';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {RegistryRegionCitationSchema} from '../packages/contracts/src';
import {UspSnapshotManifestSchema,type RequestContext} from '../packages/contracts/src/usp';
import {UspPdfPacketPlanInputSchema,UspPacketPdfReceiptSchema,UspPdfMultiPacketPlanInputSchema,UspPacketPdfMultiReceiptSchema} from '../packages/contracts/src/usp/packet-pdf';
import {UspPdfOriginalsPacketPlanInputSchema,UspPacketPdfOriginalsReceiptSchema,PacketPdfOriginalSetSchema,PACKET_PDF_ORIGINALS_RECIPE} from '../packages/contracts/src/usp/packet-pdf';
import {PacketRegionWorkerSchema} from '../packages/contracts/src/packet-region';
import {enqueuePacketPdfJob,readPacketPdfJob,readPacketPdfJobResult,controlPacketPdfJob} from '../packages/server/src/modules/usp/packets/pdf-jobs';
import {runPacketPdfJob} from '../packages/server/src/modules/usp/packets/pdf-worker';
import {claimUspJobAttempt,acceptUspJobAttempt,readUspJob,cancelUspJob} from '../packages/server/src/modules/usp/jobs';
import {retryJob} from '../packages/server/src/modules/cases/domain';
import {dispatchTick} from '../packages/server/src/modules/cases/processing';
import {capturePacketPdfJobTx} from '../packages/server/src/modules/usp/packets/pdf-job-authority';
import {createPacketPlan,revisePacketPlan,confirmPacketPlan,executePacketPlan,readPacketPlan} from '../packages/server/src/modules/usp/packets/plan-service';
import {readPacketPdf,type PdfPacketIo} from '../packages/server/src/modules/usp/packets/pdf-service';
import {readPacket0} from '../packages/server/src/modules/usp/packet0';
import {generatePropertyCard,readPropertyCard,resolvePropertyCard,type PropertyCardIo} from '../packages/server/src/modules/usp/packets/card-service';
import {projectCodeForPayload} from '../packages/contracts/src/usp/project-identity';
import {regionCitationId} from '../packages/server/src/modules/registry/registry-region-evidence';
import {registryRegionSourceTx} from '../packages/server/src/modules/registry/registry-region-evidence';
import {fingerprint,canonical} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {packetRegionTransform} from '../packages/server/src/modules/usp/packets/region-extract';

// Adapted from existing packet-plan memory SQL/transport control. All identities,
// committed target/history and snapshot rows are technical doubles. Unchanged
// retained crop bytes/proof are reused; no native execution or original I/O.
const root='E:/BhuAayam-data/task-data/desktop-packet-region-extract-20261002/real-crop-02';
const present=existsSync(root+'/result.json')&&existsSync(root+'/region.png'),subject='packet-pdf-protocol-control';
const secondRoot=process.env.ULPIN_PACKET_MULTI_SECOND_ROOT??'E:/BhuAayam-data/task-data/desktop-packet-pdf-multiregion-20261003/second-region';
const actualSecond=existsSync(secondRoot+'/result.json')&&existsSync(secondRoot+'/region.png');
const originalsRoot=process.env.ULPIN_PACKET_ORIGINALS_SECOND_ROOT??'E:/BhuAayam-data/task-data/desktop-packet-pdf-multiple-originals-20261003/second-original';
const actualOtherOriginal=existsSync(originalsRoot+'/result.json')&&existsSync(originalsRoot+'/region.png');
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const siteId=id(1),sourceId=id(2),caseId=id(3),targetId=id(4),manifestId=id(5),digest='a'.repeat(64);
type State={plans:any[];confirmations:any[];executions:any[];receipts:any[];packets:any[];cards:any[];streams:any[];events:any[];jobs:any[];jobMeta:any[];attempts:any[];checkpoints:any[]};
class ControlDb{
  state:State={plans:[],confirmations:[],executions:[],receipts:[],packets:[],cards:[],streams:[],events:[],jobs:[],jobMeta:[],attempts:[],checkpoints:[]};
  queries:{q:string;v:any[]}[]=[];active=0;connects=0;releases=0;transactionActive=0;heldCases=new Set<string>();
  expired=false;archived=false;latest=1;failEvent=false;extractFail=false;afterExtract?:()=>void;afterPut?:()=>void|Promise<void>;afterRead?:()=>void;commitLost=false;
  ctx!:RequestContext;objects=new Map<string,Uint8Array>();extracts=0;puts=0;reads=0;identity:any=null;afterCardRead?:()=>void;
  region=PacketRegionWorkerSchema.parse(JSON.parse(readFileSync(root+'/result.json','utf8')));png=readFileSync(root+'/region.png');
  oldBody={kind:'building',name:'Technical committed target',alias:'Technical target',footprint:[],links:[],rights:[],evidence:[],synthetic:true};
  source:any={id:sourceId,case_id:caseId,family_id:sourceId,revision:1,name:'Technical retained original',
    sha256:this.region.sourceSha256,bytes:this.region.sourceBytes,object_key:'technical-only-no-original-io',profile:'pdf-reference-v2',status:'needs_input',
    inspection:{documentOriginal:{version:'source-document/1',subject,format:'pdf',sha256:this.region.sourceSha256,
      bytes:this.region.sourceBytes,receivedAt:'2026-10-02T00:00:00Z'}}};
  sourceCase:any={id:caseId,site_id:siteId,revision:1,archived:false,context:null,frame:null};
  citation:any;record:any;captured:any;history=new Map<number,any>();
  secondRegion:any;secondPng?:Buffer;secondCitation:any;extractOrder:string[]=[];
  secondSource:any;secondSourceCase:any;secondArchived=false;secondLatest=1;
  checkpointAvailable=true;extractFailAt=0;cropPuts=0;recipeChanged=false;afterCropPut?:()=>void|Promise<void>;
  extractAttempts:string[]=[];
  scope={kind:'snapshot' as const,scopeId:siteId,world:{namespace:'world',id:`registry-site/${siteId}`},manifestId,
    snapshotDigest:digest,stage:'recorded' as const};
  target={ref:{namespace:'registry_record' as const,id:targetId},revision:2};
  async init(){
    const current=await registryRegionSourceTx({query:(q:string,v:any[])=>this.query(q,v)} as any,siteId,
      {caseId,caseRevision:1,sourceId,sourceRevision:1,sourceSha256:this.region.sourceSha256,sourceBytes:this.region.sourceBytes});
    this.citation=RegistryRegionCitationSchema.parse({version:'registry-document-region-citation/1',id:digest,
      document:{caseId,caseRevision:1,sourceId,sourceRevision:1,sourceSha256:this.region.sourceSha256,sourceBytes:this.region.sourceBytes},
      page:1,region:this.region.selection,purpose:'record_evidence',validation:this.region,authoritySha256:current.authority.authoritySha256,
      target:{recordId:targetId,revision:1,bodySha256:fingerprint(this.oldBody)},
      selection:{subject,accessSha256:ingestionBinding(caseId).access,selectedAt:'2026-10-02T00:00:00Z'},
      applicability:'explicit_officer_inclusion; effective_after_canonical_commit',associationState:'operator_selected',qualification:'not_assessed'});
    this.citation.id=regionCitationId(this.citation);
    this.record={id:targetId,site_id:siteId,kind:'building',revision:2,identifier:'technical-pdf-target',
      body:{...this.oldBody,documentCitations:[this.citation]}};
    this.capture();this.history.set(1,structuredClone(this.oldBody));this.history.set(2,structuredClone(this.record.body));this.queries=[];
  }
  enableMulti(){
    if(actualSecond){
      this.secondRegion=PacketRegionWorkerSchema.parse(JSON.parse(readFileSync(secondRoot+'/result.json','utf8')));
      this.secondPng=readFileSync(secondRoot+'/region.png');
    }else{
      // Native retry is held after unresolved cleanup. This second locator/proof
      // is an explicit extractor control reusing the FIRST crop's pixels. It is
      // never saved or represented as a genuine second source extraction.
      const selection={...this.region.selection,region:[2265/2586,1400/1695,2530/2586,1535/1695]};
      this.secondRegion=PacketRegionWorkerSchema.parse({...this.region,selection,transform:packetRegionTransform(selection as any)});
      this.secondPng=this.png;
    }
    assert.equal(sha256(this.secondPng!),this.secondRegion.output.sha256);
    assert.equal(this.secondRegion.sourceSha256,this.region.sourceSha256);assert.equal(this.secondRegion.sourceBytes,this.region.sourceBytes);
    this.secondCitation=RegistryRegionCitationSchema.parse({...this.citation,page:this.secondRegion.page,
      region:this.secondRegion.selection,validation:this.secondRegion});
    this.secondCitation.id=regionCitationId(this.secondCitation);
    assert.notEqual(this.secondCitation.id,this.citation.id);
    this.record.body.documentCitations=[this.citation,this.secondCitation];this.capture();this.history.set(2,structuredClone(this.record.body));
  }
  async enableMultipleOriginals(){
    assert(actualOtherOriginal,'A genuine retained second-original crop is required; no first-source pixel fallback');
    this.secondRegion=PacketRegionWorkerSchema.parse(JSON.parse(readFileSync(originalsRoot+'/result.json','utf8')));
    this.secondPng=readFileSync(originalsRoot+'/region.png');assert.equal(sha256(this.secondPng),this.secondRegion.output.sha256);
    assert.notEqual(this.secondRegion.sourceSha256,this.region.sourceSha256);
    this.secondSource={...structuredClone(this.source),id:id(12),case_id:id(13),family_id:id(12),
      sha256:this.secondRegion.sourceSha256,bytes:this.secondRegion.sourceBytes,
      inspection:{documentOriginal:{...this.source.inspection.documentOriginal,sha256:this.secondRegion.sourceSha256,bytes:this.secondRegion.sourceBytes}}};
    this.secondSourceCase={...this.sourceCase,id:id(13)};
    const original={caseId:id(13),caseRevision:1,sourceId:id(12),sourceRevision:1,
      sourceSha256:this.secondRegion.sourceSha256,sourceBytes:this.secondRegion.sourceBytes};
    const current=await registryRegionSourceTx({query:(q:string,v:any[])=>this.query(q,v)} as any,siteId,original);
    this.secondCitation=RegistryRegionCitationSchema.parse({...this.citation,document:original,page:this.secondRegion.page,
      region:this.secondRegion.selection,validation:this.secondRegion,authoritySha256:current.authority.authoritySha256,
      selection:{...this.citation.selection,accessSha256:ingestionBinding(id(13)).access}});
    this.secondCitation.id=regionCitationId(this.secondCitation);
    this.record.body.documentCitations=[this.citation,this.secondCitation];this.capture();this.history.set(2,structuredClone(this.record.body));
  }
  capture(){this.captured={...structuredClone(this.record),project_code:this.identity?.code??null,project_status:this.identity?.status??null,
    project_location:this.identity?.location??null,projectIdentity:this.identity,historicalAliases:[]};}
  manifest(){return UspSnapshotManifestSchema.parse({schemaVersion:'usp/1',id:manifestId,digest,scope:this.scope,
    capturedAt:'2026-10-02T00:00:00Z',selection:{kind:'targets',pins:[this.target]},
    members:[{pin:this.target,bodySha256:fingerprint(this.captured),bodyRef:fingerprint([this.target.ref.namespace,this.target.ref.id,this.target.revision,this.captured]),authority:'registry'}],
    frame:{horizontal:null,vertical:null,unit:null,transform:null},accessViewId:this.ctx.accessViewId,policyVersion:this.ctx.policyVersion,
    validAt:null,asOf:null,coverage:{state:'complete',reasonCodes:[]}});}
  pool={query:(q:string,v:any[])=>this.query(q,v),connect:async()=>{
    this.connects++;this.active++;let baseline:State;
    return {release:()=>{this.releases++;this.active--;},query:async(q:string,v:any[]=[])=>{
      if(q==='BEGIN'){baseline=structuredClone(this.state);this.transactionActive++;}
      if(q==='ROLLBACK')this.state=baseline!;
      const result=await this.query(q,v);
      if(q==='COMMIT'||q==='ROLLBACK'){this.transactionActive--;this.heldCases.clear();}
      if(q==='COMMIT'&&this.commitLost){this.commitLost=false;throw new Error('CONTROL lost COMMIT acknowledgement');}return result;
    }} as unknown as PoolClient;
  }} as unknown as Pool;
  async query(sql:string,v:any[]=[]){
    const q=sql.replace(/\s+/g,' ').trim();this.queries.push({q,v});const result=(rows:any[]=[])=>({rows,rowCount:rows.length});
    if(q==='BEGIN'||q==='COMMIT'||q==='ROLLBACK'||q.includes('pg_advisory_xact_lock'))return result();
    if(q.startsWith('SELECT set_config'))return result([{deadline_live:true}]);
    if(q.startsWith("SELECT to_regclass('usp_packet_pdf_entry_checkpoints')"))return result([{available:this.checkpointAvailable}]);
    if(q.startsWith('SELECT * FROM usp_packet_pdf_entry_checkpoints'))return result(this.state.checkpoints.filter(c=>c.job_id===v[0]&&c.entry_index===v[1]).map(c=>structuredClone(c)));
    if(q.startsWith('INSERT INTO usp_packet_pdf_entry_checkpoints')){
      assert(!this.state.checkpoints.some(c=>c.job_id===v[1]&&c.entry_index===v[4]));
      this.state.checkpoints.push({id:v[0],job_id:v[1],plan_id:v[2],plan_version:v[3],entry_index:v[4],identity_sha256:v[5],
        artifact_sha256:v[6],artifact_bytes:v[7],object_key:v[8],accepted_attempt:v[9],accepted_fence:v[10],
        body:structuredClone(v[11]),body_sha256:v[12]});return result();}
    if(q.startsWith('INSERT INTO jobs')){this.state.jobs.push({id:v[0],case_id:v[1],source_id:v[2],operation:'packet-pdf',case_revision:v[3],
      input_fingerprint:v[4],payload:structuredClone(v[5]),status:'queued',attempts:0,error:null,created_at:new Date().toISOString()});return result();}
    if(q.startsWith('SELECT id FROM jobs WHERE operation='))return result(this.state.jobs.filter(j=>j.payload.command.planId===v[0]&&String(j.payload.command.version)===v[1]));
    if(q.startsWith('SELECT j.*')&&q.includes('FROM jobs')){const job=this.state.jobs.find(j=>j.id===v[0]),meta=this.state.jobMeta.find(j=>j.job_id===v[0]);return result(job&&meta?[{...structuredClone(job),...structuredClone(meta),id:job.id}]:[]);}
    if(q.startsWith('SELECT * FROM jobs WHERE status'))return result(this.state.jobs.filter(j=>['queued','running'].includes(j.status)));
    if(q.includes('FROM jobs')){const jobs=this.state.jobs.filter(j=>j.id===v[0]);return result(jobs.map(j=>structuredClone(j)));}
    if(q.startsWith('INSERT INTO usp_job_metadata')){this.state.jobMeta.push({job_id:v[0],input_manifest_id:v[1],input_sha256:v[2],scope:structuredClone(v[3]),version:1,logical_state:'queued',result_ref:null,accepted_fence:null});return result();}
    if(q.includes('FROM usp_job_metadata'))return result(this.state.jobMeta.filter(m=>m.job_id===v[0]).map(m=>structuredClone(m)));
    if(q.startsWith('INSERT INTO usp_job_attempts')){const lease_until=new Date(Date.now()+180000).toISOString();
      this.state.attempts.push({job_id:v[0],number:v[1],fence:v[2],owner:v[3],input_sha256:v[4],lease_until,state:'active',completion_sha256:null});return result([{lease_until}]);}
    if(q.includes('FROM usp_job_attempts')){let rows=this.state.attempts.filter(a=>a.job_id===v[0]);
      if(q.includes('AND number=$2'))rows=rows.filter(a=>a.number===v[1]);
      if(q.includes('AND fence=$2'))rows=rows.filter(a=>a.fence===Number(v[1])&&a.state==='accepted');
      if(q.includes('LIMIT 1'))rows=rows.sort((a,b)=>b.number-a.number).slice(0,1);return result(rows.map(a=>structuredClone(a)));}
    if(q.startsWith('UPDATE usp_job_attempts')){for(const a of this.state.attempts.filter(a=>a.job_id===v[0])){
      if(q.includes("state='accepted'")&&a.number===v[2]){a.state='accepted';a.completion_sha256=v[1];}
      if(q.includes("state='fenced'")&&a.state==='active')a.state='fenced';}return result();}
    if(q.startsWith('UPDATE usp_job_metadata')){const meta=this.state.jobMeta.find(m=>m.job_id===v[0]);
      meta.logical_state=q.match(/logical_state='([^']+)'/)![1];meta.version++;
      if(q.includes('result_ref=$2')){meta.result_ref=structuredClone(v[1]);meta.accepted_fence=v[2];}return result();}
    if(q.startsWith('UPDATE jobs')){const job=this.state.jobs.find(j=>j.id===v[0]);
      job.status=q.includes('status=$2')?v[1]:q.match(/status='([^']+)'/)![1];
      if(q.includes('attempts=$2'))job.attempts=v[1];
      job.error=q.includes('error=$3')?v[2]:q.includes("error='PACKET_PDF_CANCELLED'")?'PACKET_PDF_CANCELLED':null;return result();}
    if(q.startsWith('SELECT id FROM cases')&&q.includes('FOR SHARE')){this.heldCases.add(v[0]);return result([{id:v[0]}]);}
    if(q.includes('FROM cases'))return result(v[0]===caseId?[{...this.sourceCase,archived:this.archived}]:
      this.secondSourceCase&&v[0]===this.secondSourceCase.id?[{...this.secondSourceCase,archived:this.secondArchived}]:[]);
    if(q.startsWith('SELECT max(revision) AS revision FROM usp_property_cards'))return result([{revision:Math.max(...this.state.cards.filter(c=>c.id===v[0]).map(c=>c.revision))}]);
    if(q.includes('SELECT max(revision)'))return result([{revision:this.secondSourceCase&&v[0]===this.secondSourceCase.id?this.secondLatest:this.latest}]);
    if(q.includes('FROM sources')){const selected=v[q.includes('WHERE case_id=')?1:0];return result(selected===sourceId?[structuredClone(this.source)]:
      this.secondSource&&selected===this.secondSource.id?[structuredClone(this.secondSource)]:[]);}
    if(q.startsWith('SELECT body FROM usp_snapshots'))return result([{body:this.manifest()}]);
    if(q.startsWith('SELECT body,body_sha256 FROM usp_snapshot_bodies'))return result(v[2]===targetId&&v[3]===2?
      [{body:structuredClone(this.captured),body_sha256:fingerprint(this.captured)}]:[]);
    if(q.includes('FROM registry_revisions'))return result(this.history.has(v[1])?[{body:structuredClone(this.history.get(v[1]))}]:[]);
    if(q.includes('FROM registry_records'))return result(v[0]===targetId&&v[1]===siteId?
      [{...structuredClone(this.record),...q.includes('project_code')?{project_code:this.identity?.code??null,project_status:this.identity?.status??null,
        project_location:this.identity?.location??null}:{project_status:this.identity?.status??null}}]:[]);
    if(q.includes('FROM registry_aliases')||q.includes('FROM usp_project_lineage'))return result();
    if(q.includes('FROM registry_sites'))return result([{id:siteId}]);
    if(q.startsWith('SELECT clock_timestamp()'))return result([{live:!this.expired&&Date.parse(v[0])>Date.now()}]);
    if(q.startsWith('SELECT max(version)'))return result([{version:Math.max(...this.state.plans.filter(p=>p.id===v[0]).map(p=>p.version))}]);
    if(q.startsWith('SELECT body FROM usp_packet_plans'))return result(this.state.plans.filter(p=>p.id===v[0]&&p.version===v[1]));
    if(q.startsWith('SELECT body FROM usp_packet_plan_confirmations'))return result(this.state.confirmations.filter(p=>p.plan_id===v[0]&&p.version===v[1]));
    if(q.startsWith('SELECT body FROM usp_packet_plan_executions'))return result(this.state.executions.filter(p=>q.includes('packet_id=')?p.packet_id===v[0]:p.plan_id===v[0]&&p.version===v[1]));
    if(q.startsWith('SELECT command_sha256,body FROM usp_command_receipts'))return result(this.state.receipts.filter(p=>
      p.subject===v[0]&&p.scope_key===v[1]&&p.operation===v[2]&&p.request_key===v[3]));
    if(q.startsWith('SELECT body,object_key,artifact_hash FROM usp_packets'))return result(this.state.packets.filter(p=>p.id===v[0]));
    if(q.startsWith('SELECT body,object_key,artifact_hash FROM usp_property_cards'))return result(this.state.cards.filter(c=>c.id===v[0]&&c.revision===v[1]));
    if(q.startsWith('INSERT INTO usp_property_cards')){this.state.cards.push({id:v[0],revision:v[1],artifact_hash:v[8],object_key:v[9],body:structuredClone(v[10])});return result();}
    if(q.startsWith('INSERT INTO usp_packet_plans')){this.state.plans.push({id:v[0],version:v[1],body:structuredClone(v[5])});return result();}
    if(q.startsWith('INSERT INTO usp_packet_plan_confirmations')){this.state.confirmations.push({plan_id:v[1],version:v[2],body:structuredClone(v[4])});return result();}
    if(q.startsWith('INSERT INTO usp_packets')){this.state.packets.push({id:v[0],artifact_hash:v[4],object_key:v[5],body:structuredClone(v[6])});return result();}
    if(q.startsWith('INSERT INTO usp_packet_plan_executions')){this.state.executions.push({plan_id:v[0],version:v[1],packet_id:v[3],body:structuredClone(v[4])});return result();}
    if(q.startsWith('INSERT INTO usp_command_receipts')){this.state.receipts.push({subject:v[1],scope_key:v[2],operation:v[3],request_key:v[4],command_sha256:v[5],body:structuredClone(v[6])});return result();}
    if(q.startsWith('INSERT INTO usp_outbox_streams')){if(!this.state.streams.some(s=>s.id===v[0]))this.state.streams.push({id:v[0],sequence:0});return result();}
    if(q.startsWith('UPDATE usp_outbox_streams'))return result([{sequence:String(++this.state.streams.find(s=>s.id===v[0]).sequence)}]);
    if(q.startsWith('INSERT INTO usp_outbox(')){if(this.failEvent)throw new Error('CONTROL atomic publication failed');this.state.events.push(v[2]);return result();}
    throw new Error('Unmodelled PDF control SQL: '+q);
  }
  pdf:PdfPacketIo={extract:async(source,page,raw:any)=>{
    assert.equal(this.active,0);assert.equal(this.transactionActive,0);assert.equal(this.heldCases.size,0);
    this.extracts++;this.extractAttempts.push(source);
    if(this.extractFail||this.extracts===this.extractFailAt)throw new Error('CONTROL renderer failed');
    const second=this.secondCitation&&canonical(raw.selection)===canonical(this.secondCitation.region);
    const original=second?this.secondCitation.document:this.citation.document;
    assert.equal(source,original.sourceId);assert.equal(page,1);assert.equal(raw.sha256,original.sourceSha256);
    assert.equal(canonical(raw.selection),canonical(second?this.secondCitation.region:this.citation.region));
    this.extractOrder.push(second?this.secondCitation.id:this.citation.id);this.afterExtract?.();
    return {bytes:second?this.secondPng!:this.png,provenance:{...(second?this.secondRegion:this.region),
      version:'packet-region/1',caseId:original.caseId,caseRevision:original.caseRevision,sourceId:original.sourceId,sourceRevision:original.sourceRevision,purpose:'private_source_preview'}};
  },put:async(key,bytes,type)=>{assert.equal(this.active,0);assert(['application/pdf','image/png'].includes(type));assert(!this.objects.has(key));
    this.objects.set(key,Buffer.from(bytes));if(type==='image/png'){this.cropPuts++;await this.afterCropPut?.();}
    else{this.puts++;await this.afterPut?.();}},
    read:async(key,bytes,hash)=>{assert.equal(this.active,0);this.reads++;const value=this.objects.get(key);assert(value);
      assert.equal(bytes,value.length);this.afterRead?.();return Buffer.from(value);},
    recipe:async source=>this.recipeChanged?'0'.repeat(64):source===this.secondSource?.id?this.secondRegion.recipeSha256:this.region.recipeSha256};
  io={read:async()=>{throw new Error('PDF must not use PACK0 original I/O');},put:async()=>{throw new Error('PDF must not use PACK0 writer');},pdf:this.pdf};
  cardIo:PropertyCardIo={readPacket:async()=>{throw new Error('PDF card must use the dedicated PDF reader');},pdf:this.pdf,put:this.pdf.put,
    readCard:async(key,bytes,hash)=>{assert.equal(this.active,0);this.reads++;const value=this.objects.get(key);assert(value);
      assert.equal(value.length,bytes);assert.equal(sha256(value),hash);this.afterCardRead?.();return Buffer.from(value);}};
  input(bindingId=this.citation.id){return UspPdfPacketPlanInputSchema.parse({target:this.target,scope:this.scope,purpose:'record_evidence',
    format:'pdf',recipe:'pack1-single-region-image/1',expiresAt:new Date(Date.now()+3600000).toISOString(),
    entries:[{bindingId,required:true,inclusionReason:'Explicit technical exact committed region selection'}]});}
  multiInput(bindingIds=[this.secondCitation.id,this.citation.id]){return UspPdfMultiPacketPlanInputSchema.parse({...this.input(),
    recipe:'pack1-multi-region-image/1',entries:bindingIds.map(bindingId=>({bindingId,required:true,
      inclusionReason:'Explicit controlled committed inclusion; actual retained source pixels, applicability unqualified'}))});}
  originalsInput(bindingIds=[this.secondCitation.id,this.citation.id]){return UspPdfOriginalsPacketPlanInputSchema.parse({...this.multiInput(bindingIds),recipe:PACKET_PDF_ORIGINALS_RECIPE});}
}
async function withDb(action:(db:ControlDb,ctx:RequestContext)=>Promise<void>){
  const globals=globalThis as unknown as {ulpinPool?:Pool},prior=globals.ulpinPool,oldSubject=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;const db=new ControlDb();globals.ulpinPool=db.pool;
  try{const ctx=localRequestContext(randomUUID());db.ctx=ctx;await db.init();await action(db,ctx);
    assert.equal(db.connects,db.releases);assert.equal(db.active,0);assert.equal(db.transactionActive,0);
  }finally{globals.ulpinPool=prior;if(oldSubject===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=oldSubject;}
}
const confirm=(plan:any)=>({planId:plan.planId,version:plan.version,planSha256:plan.planSha256,reviewed:true,
  guard:{mode:'update',requestKey:randomUUID(),expectedVersion:plan.version,expectedManifestId:manifestId}});
async function confirmed(db:ControlDb,ctx:RequestContext){
  const plan=await createPacketPlan(ctx,{input:db.input(),guard:{mode:'create',requestKey:randomUUID()}},db.io);
  const confirmation=await confirmPacketPlan(ctx,confirm(plan),db.io);
  return {plan,command:{planId:plan.planId,version:plan.version,confirmationId:confirmation.confirmationId,guard:{mode:'create',requestKey:randomUUID()}}};
}
const cardCommand=(plan:any)=>({planId:plan.planId,planVersion:plan.version,cardId:null,
  expiresAt:new Date(Date.now()+3600000).toISOString(),guard:{mode:'create',requestKey:randomUUID()}});

test('executed PDF → private card → exact read → decoded local QR; crop cannot qualify recorded parcel/share facts',
  {skip:!present},()=>withDb(async(db,ctx)=>{
    // This is deliberately a controlled assertion, not a qualified parcel fact.
    db.identity={code:projectCodeForPayload('0123456789ABCDEFGHJK'),status:'assigned',successors:[],location:{anchorState:'reviewed_complete',
      locator:{structureKind:'S',structureNumber:1,levels:['G'],spaceKind:'R',spaceNumber:1},
      parcels:[{literalValue:'CONTROL-PARCEL',role:'primary',source:{sourceId,revision:1,locator:'PDF page 1'},
        issuer:{state:'unknown'},validity:{state:'unknown'},reviewState:'reviewed'}]}};db.capture();
    const {plan,command}=await confirmed(db,ctx),execution=await executePacketPlan(ctx,command,db.io),request=cardCommand(plan);
    const card=await generatePropertyCard(ctx,request,db.cardIo),exact={cardId:card.cardId,revision:card.revision};
    assert.equal(card.packetId,execution.packet.packetId);assert.equal(card.packetSha256,execution.packet.artifact.sha256);
    assert.equal(card.planSha256,plan.planSha256);assert.equal(card.confirmationId,execution.confirmationId);
    assert.deepEqual(card.evidenceEntrySha256,plan.entries.map(e=>e.entrySha256));assert.equal(card.artifact.pages,1);
    assert.equal(card.facts.find(f=>f.key==='project_identity')?.state,'available');
    for(const key of ['parcel_assertions','declared_share','geometry','measurements','render'])
      assert.equal(card.facts.find(f=>f.key===key)?.state,'unavailable');
    assert(!card.facts.some(f=>f.value?.includes('CONTROL-PARCEL')));assert.equal(card.facts.find(f=>f.key==='rights')?.state,'not_assessed');
    const puts=db.puts,reads=db.reads;assert.deepEqual(await generatePropertyCard(ctx,request,db.cardIo),card);
    assert.equal(db.puts,puts);assert.equal(db.reads,reads);assert.equal(db.state.cards.length,1);
    db.record.revision=3;db.record.body={...db.record.body,name:'Later technical revision'};db.sourceCase.revision=2;db.latest=2;
    const view=await readPropertyCard(ctx,exact,db.cardIo);assert.deepEqual(view.card,card);assert.equal(view.snapshotState,'changed_revision');
    const resolved=await resolvePropertyCard(ctx,exact,db.cardIo);assert.equal(sha256(resolved.bytes),card.artifact.sha256);
    await assert.rejects(()=>resolvePropertyCard(ctx,{...exact,revision:9},db.cardIo),/exact property card revision/);
    const evidenceRoot=process.env.ULPIN_CARD_PDF_FLOW_ROOT;
    if(evidenceRoot){
      assert(process.env.CARD_PDFTOPPM,'Saved card journey requires a Poppler renderer for QR decoding');mkdirSync(evidenceRoot,{recursive:true});
      const pdf=evidenceRoot+'/property-card.pdf',png=evidenceRoot+'/property-card';writeFileSync(pdf,resolved.bytes,{flag:'wx'});
      const rendered=spawnSync(process.env.CARD_PDFTOPPM,['-r','144','-singlefile','-png',pdf,png],{encoding:'utf8'});
      assert.equal(rendered.status,0,rendered.stderr);
      const require=createRequire(new URL('../packages/server/package.json',import.meta.url)),{PNG}=require('pngjs'),jsQR=require('jsqr');
      const pixels=PNG.sync.read(readFileSync(png+'.png')),qr=jsQR(new Uint8ClampedArray(pixels.data),pixels.width,pixels.height);
      assert(qr,'Actual rendered card QR must decode');assert.equal(qr.data,card.resolverUrl);
      const url=new URL(qr.data),match=/\/property-cards\/([^/]+)\/revisions\/([1-9]\d*)$/.exec(url.pathname)!;
      assert.equal(url.hostname,'127.0.0.1');assert.equal(url.search,'');assert.equal(url.hash,'');
      const decoded=await resolvePropertyCard(ctx,{cardId:match[1],revision:Number(match[2])},db.cardIo);
      assert.equal(decoded.card.packetId,execution.packet.packetId);assert.equal(sha256(decoded.bytes),card.artifact.sha256);
      writeFileSync(evidenceRoot+'/decoded-qr.txt',qr.data+'\n',{flag:'wx'});
      writeFileSync(evidenceRoot+'/flow.json',JSON.stringify({scope:'Production PDF/card methods with retained crop proof and memory-only target/SQL/storage',
        plan,execution,view,card,decoded:{url:qr.data,cardId:decoded.card.cardId,revision:decoded.card.revision,packetId:decoded.card.packetId,
          bytes:decoded.bytes.length,sha256:sha256(decoded.bytes)},originals:'not read or modified; retained crop proof reused'},null,2),{flag:'wx'});
    }
  }));

test('PDF card rejects post-I/O source revocation and changed saved packet linkage before disclosure or publication',
  {skip:!present},()=>withDb(async(db,ctx)=>{
    const {plan,command}=await confirmed(db,ctx);await executePacketPlan(ctx,command,db.io);const request=cardCommand(plan);
    db.afterRead=()=>{db.archived=true;};
    await assert.rejects(()=>generatePropertyCard(ctx,request,db.cardIo),(e:any)=>e.status===403);assert.equal(db.state.cards.length,0);
    db.afterRead=undefined;db.archived=false;
    const card=await generatePropertyCard(ctx,request,db.cardIo),exact={cardId:card.cardId,revision:card.revision},saved=structuredClone(db.state.packets[0]);
    db.afterCardRead=()=>{db.state.packets[0].object_key='changed-link';};
    await assert.rejects(()=>resolvePropertyCard(ctx,exact,db.cardIo),/saved PDF linkage changed|linked PDF packet/);
    db.afterCardRead=undefined;db.state.packets[0]=saved;
    db.afterCardRead=()=>{db.archived=true;};
    await assert.rejects(()=>resolvePropertyCard(ctx,exact,db.cardIo),(e:any)=>e.status===403);
    const reads=db.reads;await assert.rejects(()=>generatePropertyCard(ctx,request,db.cardIo),(e:any)=>e.status===403);assert.equal(db.reads,reads);
    db.archived=false;db.afterCardRead=undefined;
    db.afterPut=()=>{db.state.packets[0].object_key='changed-during-card-publication';};
    await assert.rejects(()=>generatePropertyCard(ctx,{...request,guard:{mode:'create',requestKey:randomUUID()}},db.cardIo),/linked PDF packet/);
    assert.equal(db.state.cards.length,1);assert.equal(db.state.receipts.filter(r=>r.operation==='property_card_generate').length,1);
    assert.equal(db.state.events.filter(e=>e.type==='property.card.created').length,1);
  }));

test('blocked selection → immutable revise → exact confirmation → clean PDF/read/replay; historical versions and PACK0 refusal',
  {skip:!present},()=>withDb(async(db,ctx)=>{
    const first=await createPacketPlan(ctx,{input:db.input(digest),guard:{mode:'create',requestKey:randomUUID()}},db.io);
    assert.equal(first.requiredContext,'blocked');assert.equal(first.entries[0].reasonCode,'committed_region_binding_unavailable');
    await assert.rejects(()=>confirmPacketPlan(ctx,confirm(first),db.io),(e:any)=>e.code==='PACKET_PLAN_BLOCKED');
    const plan=await revisePacketPlan(ctx,{planId:first.planId,input:db.input(),guard:{mode:'update',requestKey:randomUUID(),expectedVersion:1,expectedManifestId:manifestId}},db.io);
    assert.equal(plan.version,2);assert.equal(plan.entries[0].state,'included');
    const confirmation=await confirmPacketPlan(ctx,confirm(plan),db.io),command={planId:plan.planId,version:plan.version,
      confirmationId:confirmation.confirmationId,guard:{mode:'create',requestKey:randomUUID()}};
    await assert.rejects(()=>executePacketPlan(ctx,{...command,confirmationId:randomUUID()},db.io));assert.equal(db.extracts,0);
    db.queries=[];const result=await executePacketPlan(ctx,command,db.io);assert.equal(result.packet.format,'pdf');
    const receipt=UspPacketPdfReceiptSchema.parse(result.packet),output=await readPacketPdf(ctx,receipt.packetId,db.pdf);
    assert.equal(sha256(output.bytes),'452c606114d5d8b7f24694695cfaedb6859225ca7855a57c0a0f2f5462ccc273');
    assert.equal(output.bytes.length,132479);assert.deepEqual(output.receipt,receipt);assert.equal(db.extracts,1);
    const gate=db.queries.findIndex(e=>e.v[0]===`registry-import:${caseId}`),caseLock=db.queries.findIndex(e=>e.q==='SELECT id FROM cases WHERE id=$1 FOR SHARE');
    const recording=db.queries.findIndex(e=>e.q.includes('physical-area-recording'));assert(gate<caseLock&&caseLock<recording);
    assert.deepEqual(await executePacketPlan(ctx,command,db.io),result);assert.equal(db.extracts,1);assert.equal(db.puts,1);
    const priorReads=db.reads;
    await assert.rejects(()=>readPacket0(ctx,receipt.packetId,async()=>{throw new Error('No PACK0 byte read');}),
      (e:any)=>e.code==='USP_PACKET_PDF_READER_REQUIRED');assert.equal(db.reads,priorReads);
    db.record.revision=3;db.record.body={...db.record.body,name:'Later technical target revision'};db.sourceCase.revision=2;db.latest=2;db.expired=true;
    assert.deepEqual((await readPacketPdf(ctx,receipt.packetId,db.pdf)).bytes,output.bytes);
    assert.equal((await readPacketPlan(ctx,{planId:first.planId,version:1})).plan.planSha256,first.planSha256);
    assert.deepEqual(await executePacketPlan(ctx,command,db.io),result);
    db.archived=true;const reads=db.reads;
    await assert.rejects(()=>readPacketPdf(ctx,receipt.packetId,db.pdf),(e:any)=>e.status===403);assert.equal(db.reads,reads);
    const evidenceRoot=process.env.ULPIN_PACKET_PDF_FLOW_ROOT;
    if(evidenceRoot){mkdirSync(evidenceRoot,{recursive:true});writeFileSync(evidenceRoot+'/packet.pdf',output.bytes,{flag:'wx'});
      writeFileSync(evidenceRoot+'/flow.json',JSON.stringify({scope:'Retained-crop assembly with controlled committed target/SQL/transport',
        plan,confirmation,execution:result,output:{bytes:output.bytes.length,sha256:sha256(output.bytes)},extracts:db.extracts,puts:db.puts,
        originals:'not read or altered; historical source proof reused'},null,2),{flag:'wx'});}
  }));

test('renderer failure, post-I/O source drift and failed atomic publication keep ready rows absent; exact retry and after-read denial',
  {skip:!present},()=>withDb(async(db,ctx)=>{
    const {plan,command}=await confirmed(db,ctx);db.extractFail=true;
    await assert.rejects(()=>executePacketPlan(ctx,command,db.io),/renderer failed/);assert.equal(db.state.packets.length,0);assert.equal(db.puts,0);
    db.extractFail=false;db.afterPut=()=>{db.source.inspection.documentOriginal.subject='revoked-after-staging';};
    await assert.rejects(()=>executePacketPlan(ctx,command,db.io),(e:any)=>e.status===403);
    assert.equal(db.state.packets.length,0);assert.equal(db.state.executions.length,0);assert.equal(db.objects.size,1);
    db.afterPut=undefined;db.source.inspection.documentOriginal.subject=subject;db.failEvent=true;
    await assert.rejects(()=>executePacketPlan(ctx,command,db.io),/atomic publication failed/);
    assert.equal(db.state.packets.length,0);assert.equal(db.state.executions.length,0);
    assert(!db.state.receipts.some(r=>r.operation==='packet_plan_execute'));assert.equal(db.objects.size,2);
    db.failEvent=false;const result=await executePacketPlan(ctx,command,db.io),packet=result.packet;assert.equal(db.state.packets.length,1);
    db.afterRead=()=>{db.archived=true;};
    await assert.rejects(()=>readPacketPdf(ctx,packet.packetId,db.pdf),(e:any)=>e.status===403);
    db.afterRead=undefined;db.archived=false;const row=db.state.packets[0],clean=db.objects.get(row.object_key)!;
    const corrupt=Buffer.from(clean);corrupt[100]^=1;db.objects.set(row.object_key,corrupt);
    await assert.rejects(()=>readPacketPdf(ctx,packet.packetId,db.pdf),(e:any)=>e.code==='PACKET_PDF_ARTIFACT_INTEGRITY');
    db.objects.set(row.object_key,clean);assert.equal((await readPacketPdf(ctx,packet.packetId,db.pdf)).receipt.planSha256,plan.planSha256);
    assert.equal(db.state.packets.length,1);assert.equal(db.source.sha256,db.region.sourceSha256);
  }));

test('draft-only, wrong target/purpose, unconfirmed/stale plans and changed bound crop remain unusable',
  {skip:!present},()=>withDb(async(db,ctx)=>{
    const raw=db.input();for(const bad of [{...raw,reviewed:true},{...raw,purpose:'declared_share'},
      {...raw,entries:[{...raw.entries[0],review:{reviewed:true}}]},{...raw,entries:[...raw.entries,...raw.entries]}])
      assert(!UspPdfPacketPlanInputSchema.safeParse(bad).success);
    const original=structuredClone(db.citation);db.record.body.documentCitations[0].target.revision=2;db.capture();
    await assert.rejects(()=>createPacketPlan(ctx,{input:raw,guard:{mode:'create',requestKey:randomUUID()}},db.io),/canonical commit/);
    db.record.body.documentCitations=[original];db.citation=original;db.capture();
    const unconfirmed=await createPacketPlan(ctx,{input:db.input(),guard:{mode:'create',requestKey:randomUUID()}},db.io);
    await assert.rejects(()=>executePacketPlan(ctx,{planId:unconfirmed.planId,version:1,confirmationId:randomUUID(),
      guard:{mode:'create',requestKey:randomUUID()}},db.io),/Confirm this exact/);assert.equal(db.extracts,0);
    const {plan,command}=await confirmed(db,ctx);db.record.body.name='Drift without revision';
    await assert.rejects(()=>executePacketPlan(ctx,command,db.io));assert.equal(db.extracts,0);
    db.record.body.name=db.oldBody.name;db.region={...db.region,recipeSha256:'b'.repeat(64)};
    await assert.rejects(()=>executePacketPlan(ctx,command,db.io),/bound crop or renderer recipe changed/);
    assert.equal(db.puts,0);assert.equal(db.state.executions.length,0);
    await assert.rejects(()=>readPacketPlan({...ctx,policyVersion:'wrong-policy'},{planId:plan.planId,version:plan.version}),(e:any)=>e.status===403);
  }));

test('two required region controls preserve operator order through revision/confirmation/PDF/read/replay and exact card linkage',
  {skip:!present},()=>withDb(async(db,ctx)=>{
    db.enableMulti();
    const blocked=await createPacketPlan(ctx,{input:db.multiInput([db.secondCitation.id,digest]),guard:{mode:'create',requestKey:randomUUID()}},db.io);
    assert.equal(blocked.requiredContext,'blocked');assert.equal(blocked.entries[1].state,'blocked_required_context');
    await assert.rejects(()=>confirmPacketPlan(ctx,confirm(blocked),db.io),(e:any)=>e.code==='PACKET_PLAN_BLOCKED');
    const plan=await revisePacketPlan(ctx,{planId:blocked.planId,input:db.multiInput(),
      guard:{mode:'update',requestKey:randomUUID(),expectedVersion:1,expectedManifestId:manifestId}},db.io);
    assert.equal(plan.version,2);assert.equal(plan.requiredContext,'available');
    const confirmation=await confirmPacketPlan(ctx,confirm(plan),db.io),command={planId:plan.planId,version:plan.version,
      confirmationId:confirmation.confirmationId,guard:{mode:'create',requestKey:randomUUID()}};
    const execution=await executePacketPlan(ctx,command,db.io),receipt=UspPacketPdfMultiReceiptSchema.parse(execution.packet);
    assert.deepEqual(db.extractOrder,[db.secondCitation.id,db.citation.id]);assert.equal(db.extracts,2);assert.equal(db.puts,1);
    assert.equal(receipt.assembly.output.pages,2);assert.deepEqual(receipt.assembly.regions,[db.secondRegion,db.region]);
    assert.deepEqual(receipt.entries,plan.entries.map((entry,index)=>({bindingId:entry.selection.bindingId,
      entrySha256:entry.entrySha256,outputPage:index+1})));
    assert.deepEqual(execution.omissions,[]);assert.equal(db.state.packets.length,1);assert.equal(db.state.executions.length,1);
    const output=await readPacketPdf(ctx,receipt.packetId,db.pdf);assert.deepEqual(output.receipt,receipt);
    assert.equal(sha256(output.bytes),receipt.artifact.sha256);
    assert.deepEqual(await executePacketPlan(ctx,command,db.io),execution);assert.equal(db.extracts,2);assert.equal(db.puts,1);
    const card=await generatePropertyCard(ctx,cardCommand(plan),db.cardIo);
    assert.deepEqual(card.evidenceEntrySha256,plan.entries.map(entry=>entry.entrySha256));assert.equal(card.packetId,receipt.packetId);
    assert.equal((await resolvePropertyCard(ctx,{cardId:card.cardId,revision:1},db.cardIo)).card.packetSha256,receipt.artifact.sha256);
    const saved=process.env.ULPIN_PACKET_MULTI_FLOW_ROOT;
    if(saved){mkdirSync(saved,{recursive:true});writeFileSync(saved+'/packet.pdf',output.bytes,{flag:'wx'});
      writeFileSync(saved+'/flow.json',JSON.stringify({scope:actualSecond?'Actual two region byte inputs; controlled applicability/target/snapshot/SQL/storage/extraction':
        'Retained FIRST crop pixels reused at two controlled region locators; controlled applicability/target/snapshot/SQL/storage/extractor; genuine second source extraction unavailable',
        plan,confirmation,execution,card,output:{bytes:output.bytes.length,sha256:sha256(output.bytes)},
        extracts:db.extracts,extractOrder:db.extractOrder,packetPuts:1},null,2)+'\n',{flag:'wx'});}
  }));

test('multi-region duplicate/optional selections refuse; required second crop drift or deadline prevents every ready row',
  {skip:!present},()=>withDb(async(db,ctx)=>{
    db.enableMulti();const input=db.multiInput();
    assert(!UspPdfMultiPacketPlanInputSchema.safeParse({...input,entries:[input.entries[0],input.entries[0]]}).success);
    assert(!UspPdfMultiPacketPlanInputSchema.safeParse({...input,entries:[{...input.entries[0],required:false},input.entries[1]]}).success);
    const plan=await createPacketPlan(ctx,{input,guard:{mode:'create',requestKey:randomUUID()}},db.io);
    const confirmation=await confirmPacketPlan(ctx,confirm(plan),db.io);
    // Put the second actual crop last for this required-entry drift control.
    const revised=await revisePacketPlan(ctx,{planId:plan.planId,input:db.multiInput([db.citation.id,db.secondCitation.id]),
      guard:{mode:'update',requestKey:randomUUID(),expectedVersion:plan.version,expectedManifestId:manifestId}},db.io);
    const accepted=await confirmPacketPlan(ctx,confirm(revised),db.io);
    const prior=db.secondRegion;db.afterExtract=()=>{if(db.extracts===2)db.secondRegion={...prior,recipeSha256:'b'.repeat(64)};};
    await assert.rejects(()=>executePacketPlan(ctx,{planId:revised.planId,version:revised.version,confirmationId:accepted.confirmationId,
      guard:{mode:'create',requestKey:randomUUID()}},db.io),/bound crop or renderer recipe changed/);
    assert.equal(db.extracts,2);assert.equal(db.puts,0);assert.equal(db.state.packets.length,0);assert.equal(db.state.executions.length,0);
    assert(!db.state.receipts.some(receipt=>receipt.operation==='packet_plan_execute'));
    assert(!db.state.events.some(event=>event.type==='packet.plan.executed'));assert(confirmation);
    db.secondRegion=prior;const now=Date.now;
    db.afterExtract=()=>{if(db.extracts===4)Date.now=()=>now()+35001;};
    try{await assert.rejects(()=>executePacketPlan(ctx,{planId:revised.planId,version:revised.version,confirmationId:accepted.confirmationId,
      guard:{mode:'create',requestKey:randomUUID()}},db.io),(e:any)=>e.code==='PACKET_PDF_DEADLINE');}finally{Date.now=now;}
    assert.equal(db.puts,0);assert.equal(db.state.packets.length,0);assert.equal(db.state.executions.length,0);
  }));

test('two actual PDF originals retain ordered crops through blocked/revise/confirm/execute/private read/replay/card',
  {skip:!present||!actualOtherOriginal},()=>withDb(async(db,ctx)=>{
    await db.enableMultipleOriginals();
    // The old recipe must keep its one-original boundary.
    await assert.rejects(()=>createPacketPlan(ctx,{input:db.multiInput(),guard:{mode:'create',requestKey:randomUUID()}},db.io),
      (e:any)=>e.code==='PACKET_PDF_ORIGINAL_SCOPE');
    const blocked=await createPacketPlan(ctx,{input:db.originalsInput([db.secondCitation.id,digest]),guard:{mode:'create',requestKey:randomUUID()}},db.io);
    assert.equal(blocked.requiredContext,'blocked');
    await assert.rejects(()=>confirmPacketPlan(ctx,confirm(blocked),db.io),(e:any)=>e.code==='PACKET_PLAN_BLOCKED');
    const plan=await revisePacketPlan(ctx,{planId:blocked.planId,input:db.originalsInput(),
      guard:{mode:'update',requestKey:randomUUID(),expectedVersion:1,expectedManifestId:manifestId}},db.io);
    const confirmation=await confirmPacketPlan(ctx,confirm(plan),db.io),command={planId:plan.planId,version:plan.version,
      confirmationId:confirmation.confirmationId,guard:{mode:'create',requestKey:randomUUID()}};
    db.queries=[];
    const execution=await executePacketPlan(ctx,command,db.io),receipt=UspPacketPdfOriginalsReceiptSchema.parse(execution.packet);
    assert.equal(plan.version,2);assert.equal(receipt.assembly.version,'packet-pdf-assembly/3');assert.equal(receipt.assembly.output.pages,2);
    assert.deepEqual(receipt.assembly.regions,[db.secondRegion,db.region]);
    assert.deepEqual(receipt.assembly.originals,[db.secondCitation.document,db.citation.document]);
    assert(!UspPacketPdfOriginalsReceiptSchema.safeParse({...receipt,entries:[receipt.entries[1],receipt.entries[0]]}).success);
    assert(!UspPacketPdfOriginalsReceiptSchema.safeParse({...receipt,entries:[receipt.entries[0],{...receipt.entries[0],outputPage:2}]}).success);
    assert.deepEqual(db.extractOrder,[db.secondCitation.id,db.citation.id]);assert.equal(db.extracts,2);assert.equal(db.puts,1);
    const recording=db.queries.findIndex(q=>q.q.includes('physical-area-recording'));
    for(const sourceCaseId of [caseId,id(13)]){
      const gate=db.queries.findIndex(q=>q.v[0]===`registry-import:${sourceCaseId}`),row=db.queries.findIndex(q=>q.q==='SELECT id FROM cases WHERE id=$1 FOR SHARE'&&q.v[0]===sourceCaseId);
      assert(gate>=0&&gate<row&&row<recording);
    }
    const output=await readPacketPdf(ctx,receipt.packetId,db.pdf);assert.deepEqual(output.receipt,receipt);assert.equal(sha256(output.bytes),receipt.artifact.sha256);
    assert.deepEqual(await executePacketPlan(ctx,command,db.io),execution);assert.equal(db.extracts,2);assert.equal(db.puts,1);
    const card=await generatePropertyCard(ctx,cardCommand(plan),db.cardIo);
    assert.deepEqual(card.evidenceEntrySha256,plan.entries.map(e=>e.entrySha256));assert.equal(card.packetId,receipt.packetId);
    assert.equal((await resolvePropertyCard(ctx,{cardId:card.cardId,revision:1},db.cardIo)).card.packetSha256,receipt.artifact.sha256);
    const saved=process.env.ULPIN_PACKET_ORIGINALS_FLOW_ROOT;
    if(saved){mkdirSync(saved,{recursive:true});writeFileSync(saved+'/packet.pdf',output.bytes,{flag:'wx'});
      writeFileSync(saved+'/flow.json',JSON.stringify({scope:'Two distinct genuine source crops; controlled target/bindings/applicability/snapshot/SQL/storage/extraction transports',
        plan,confirmation,execution,card,output:{bytes:output.bytes.length,sha256:sha256(output.bytes)},extracts:db.extracts,
        extractOrder:db.extractOrder,packetPuts:1,originals:'Unchanged retained originals; no operational property crosswalk'},null,2)+'\n',{flag:'wx'});}
  }));

test('second original revocation blocks full publication/download/replay; distinct original count and aggregate bytes are bounded',
  {skip:!present||!actualOtherOriginal},()=>withDb(async(db,ctx)=>{
    await db.enableMultipleOriginals();const input=db.originalsInput();
    const small=db.citation.document;
    assert(!PacketPdfOriginalSetSchema.safeParse([small,small]).success);
    assert(!PacketPdfOriginalSetSchema.safeParse([1,2,3].map(n=>({...small,sourceId:id(100+n),sourceBytes:16*1024**2}))).success);
    assert(!UspPdfOriginalsPacketPlanInputSchema.safeParse({...input,entries:[input.entries[0],input.entries[0]]}).success);
    const plan=await createPacketPlan(ctx,{input,guard:{mode:'create',requestKey:randomUUID()}},db.io),confirmation=await confirmPacketPlan(ctx,confirm(plan),db.io),
      command={planId:plan.planId,version:plan.version,confirmationId:confirmation.confirmationId,guard:{mode:'create',requestKey:randomUUID()}};
    db.secondArchived=true;await assert.rejects(()=>executePacketPlan(ctx,command,db.io),(e:any)=>e.status===403);assert.equal(db.extracts,0);
    db.secondArchived=false;db.afterPut=()=>{db.secondSource.inspection.documentOriginal.subject='revoked-second-original';};
    await assert.rejects(()=>executePacketPlan(ctx,command,db.io),(e:any)=>e.status===403);
    assert.equal(db.state.packets.length,0);assert.equal(db.state.executions.length,0);assert.equal(db.objects.size,1);
    assert(!db.state.receipts.some(r=>r.operation==='packet_plan_execute'));assert(!db.state.events.some(e=>e.type==='packet.plan.executed'));
    db.afterPut=undefined;db.secondSource.inspection.documentOriginal.subject=subject;
    const execution=await executePacketPlan(ctx,command,db.io);assert.equal(db.state.packets.length,1);
    db.afterRead=()=>{db.secondArchived=true;};
    await assert.rejects(()=>readPacketPdf(ctx,execution.packet.packetId,db.pdf),(e:any)=>e.status===403);
    db.afterRead=undefined;const reads=db.reads,extracts=db.extracts;
    await assert.rejects(()=>readPacketPdf(ctx,execution.packet.packetId,db.pdf),(e:any)=>e.status===403);assert.equal(db.reads,reads);
    await assert.rejects(()=>executePacketPlan(ctx,command,db.io),(e:any)=>e.status===403);assert.equal(db.extracts,extracts);
    const saved=process.env.ULPIN_PACKET_ORIGINALS_FLOW_ROOT;if(saved)writeFileSync(saved+'/denials.json',JSON.stringify({scope:'controlled second-source/access/SQL/storage denials',
      beforeExtractionDenied:true,afterStagingDenied:true,readyRowsAfterDeniedStage:0,unreferencedDerivativePreserved:true,afterDownloadReadDenied:true,
      revokedReplayDenied:true,sameOriginalNewRecipeDenied:true,aggregateBytesSchemaDenied:true,duplicateSelectionDenied:true},null,2)+'\n',{flag:'wx'});
  }));

async function queuedOriginals(db:ControlDb,ctx:RequestContext){
  await db.enableMultipleOriginals();const plan=await createPacketPlan(ctx,{input:db.originalsInput(),guard:{mode:'create',requestKey:randomUUID()}},db.io),
    confirmation=await confirmPacketPlan(ctx,confirm(plan),db.io),command={planId:plan.planId,version:plan.version,
      confirmationId:confirmation.confirmationId,guard:{mode:'create' as const,requestKey:randomUUID()}};
  const queued=await enqueuePacketPdfJob(ctx,command);return {plan,command,queued};
}
test('queued PDF: durable duplicate enrollment → independent dispatcher → atomic accepted private result without HTTP work',
  {skip:!present||!actualOtherOriginal},()=>withDb(async(db,ctx)=>{
    const {plan,command,queued}=await queuedOriginals(db,ctx);
    assert.equal(queued.status,'queued');assert.equal(db.extracts,0);assert.equal(db.state.packets.length,0);
    assert.equal((await enqueuePacketPdfJob(ctx,command)).jobId,queued.jobId);
    assert.equal((await enqueuePacketPdfJob(ctx,{...command,guard:{mode:'create',requestKey:randomUUID()}})).jobId,queued.jobId);
    assert.equal(db.state.jobs.length,1);assert.equal(db.state.jobMeta.length,1);
    await assert.rejects(()=>readPacketPdfJobResult(ctx,queued.jobId,db.pdf),(e:any)=>e.code==='PACKET_PDF_NOT_READY');
    for(const generic of [()=>readUspJob(queued.jobId),()=>cancelUspJob(queued.jobId,1),()=>retryJob(queued.jobId)])
      await assert.rejects(generic,(e:any)=>e.code==='PACKET_PDF_READER_REQUIRED'||e.code==='PACKET_PDF_CONTROL_REQUIRED');
    let independentlyOwned:Promise<void>|undefined;
    assert.equal(await dispatchTick({packetPdf:async jobId=>{independentlyOwned=runPacketPdfJob(jobId,db.pdf);await independentlyOwned;}}),1);
    assert(independentlyOwned);await independentlyOwned;
    const accepted=await readPacketPdfJob(ctx,queued.jobId);assert.equal(accepted.status,'succeeded');assert.equal(accepted.attempt.number,1);
    assert.equal(db.extracts,2);assert.equal(db.state.packets.length,1);assert.equal(db.state.executions.length,1);
    assert.equal(db.state.attempts[0].state,'accepted');assert.equal(db.state.jobMeta[0].result_ref.sha256,accepted.result!.artifact.sha256);
    const output=await readPacketPdfJobResult(ctx,queued.jobId,db.pdf);
    assert.equal(sha256(output.bytes),'cda69b79c3aeccac153b624bb70cb62add81889e7add54a323e0426feb638172');
    assert.deepEqual(db.extractOrder,[db.secondCitation.id,db.citation.id]);
    assert.equal((await enqueuePacketPdfJob(ctx,command)).status,'succeeded');await runPacketPdfJob(queued.jobId,db.pdf);assert.equal(db.extracts,2);
    const saved=process.env.ULPIN_PACKET_QUEUE_FLOW_ROOT;
    if(saved){mkdirSync(saved,{recursive:true});writeFileSync(saved+'/packet.pdf',output.bytes,{flag:'wx'});
      writeFileSync(saved+'/flow.json',JSON.stringify({scope:'Actual retained two-original crops through durable canonical job/dispatcher/packet method flow; SQL/storage/extractor and target/applicability are controls',
        plan,queued,accepted,job:db.state.jobs[0],metadata:db.state.jobMeta[0],attempt:db.state.attempts[0],execution:db.state.executions[0].body,
        output:{bytes:output.bytes.length,sha256:sha256(output.bytes)},extracts:db.extracts,extractOrder:db.extractOrder,packetPuts:db.puts,
        independentDispatcher:true,events:db.state.events},null,2)+'\n',{flag:'wx'});}
    db.secondArchived=true;const reads=db.reads;
    await assert.rejects(()=>readPacketPdfJob(ctx,queued.jobId),(e:any)=>e.status===403);
    await assert.rejects(()=>readPacketPdfJobResult(ctx,queued.jobId,db.pdf),(e:any)=>e.status===403);assert.equal(db.reads,reads);
  }));
test('queued PDF: expired attempt recovery fences old owner; revoked staged source cannot publish and exact retry remains useful',
  {skip:!present||!actualOtherOriginal},async()=>{
    await withDb(async(db,ctx)=>{
      const {queued}=await queuedOriginals(db,ctx),input=db.state.jobs[0].payload;
      const interrupted=await claimUspJobAttempt(queued.jobId,'interrupted-control',client=>capturePacketPdfJobTx(client,ctx,input).then(()=>{}));
      db.state.attempts[0].lease_until=new Date(Date.now()-1).toISOString();
      await runPacketPdfJob(queued.jobId,db.pdf);
      const accepted=await readPacketPdfJob(ctx,queued.jobId);assert.equal(accepted.status,'succeeded');assert.equal(accepted.attempt.number,2);
      let oldValidator=false;await assert.rejects(()=>acceptUspJobAttempt(interrupted,accepted.result!.artifact,async()=>{oldValidator=true;}),(e:any)=>e.status===409);
      assert.equal(oldValidator,false);assert.equal(db.state.packets.length,1);assert.equal(db.state.jobMeta[0].accepted_fence,2);assert.equal(db.extracts,2);
    });
    await withDb(async(db,ctx)=>{
      const {queued}=await queuedOriginals(db,ctx);db.afterPut=()=>{db.secondSource.inspection.documentOriginal.subject='revoked-after-stage';};
      await runPacketPdfJob(queued.jobId,db.pdf);
      assert.equal(db.state.packets.length,0);assert.equal(db.state.executions.length,0);assert.equal(db.objects.size,3);
      assert.equal(db.state.jobMeta[0].logical_state,'failed');assert.equal(db.state.jobs[0].error,'PACKET_PDF_ACCESS_REVOKED');
      assert(!db.state.events.some(e=>e.type==='job.succeeded'||e.type==='packet.plan.executed'));
      db.afterPut=undefined;db.secondSource.inspection.documentOriginal.subject=subject;
      const failed=await readPacketPdfJob(ctx,queued.jobId),retry={jobId:queued.jobId,action:'retry',expectedVersion:failed.version,requestKey:randomUUID()};
      assert.equal((await controlPacketPdfJob(ctx,retry)).status,'queued');await runPacketPdfJob(queued.jobId,db.pdf);
      assert.equal((await readPacketPdfJob(ctx,queued.jobId)).status,'succeeded');assert.equal(db.state.packets.length,1);assert.equal(db.objects.size,4);
    });
  });
test('queued PDF: synchronous winner and lost acceptance acknowledgement preserve one result; cancellation blocks staged publication',
  {skip:!present||!actualOtherOriginal},async()=>{
    await withDb(async(db,ctx)=>{
      const {queued,command}=await queuedOriginals(db,ctx);
      db.afterPut=async()=>{db.afterPut=undefined;await executePacketPlan(ctx,{...command,guard:{mode:'create',requestKey:randomUUID()}},db.io);db.commitLost=true;};
      await runPacketPdfJob(queued.jobId,db.pdf);
      const accepted=await readPacketPdfJob(ctx,queued.jobId);assert.equal(accepted.status,'succeeded');
      assert.equal(db.state.packets.length,1);assert.equal(db.state.executions.length,1);assert.equal(db.objects.size,4);
      assert.equal(accepted.result!.packetId,db.state.packets[0].id);assert.equal(db.state.attempts[0].completion_sha256,accepted.result!.artifact.sha256);
      const count=db.extracts;await runPacketPdfJob(queued.jobId,db.pdf);assert.equal(db.extracts,count);
    });
    await withDb(async(db,ctx)=>{
      const {queued}=await queuedOriginals(db,ctx);
      db.afterPut=async()=>{db.afterPut=undefined;const current=await readPacketPdfJob(ctx,queued.jobId);
        await controlPacketPdfJob(ctx,{jobId:queued.jobId,action:'cancel',expectedVersion:current.version,requestKey:randomUUID()});};
      await runPacketPdfJob(queued.jobId,db.pdf);assert.equal((await readPacketPdfJob(ctx,queued.jobId)).status,'cancelled');
      assert.equal(db.state.packets.length,0);assert.equal(db.state.executions.length,0);assert.equal(db.objects.size,3);
      assert.equal(db.state.attempts[0].state,'fenced');assert(!db.state.events.some(e=>e.type==='job.succeeded'||e.type==='packet.plan.executed'));
    });
  });

test('PDF entry recovery: accepted first crop survives later failure; retry reuses it and preserves exact packet bytes',
  {skip:!present||!actualOtherOriginal},()=>withDb(async(db,ctx)=>{
    const {plan,queued}=await queuedOriginals(db,ctx);db.extractFailAt=2;
    await runPacketPdfJob(queued.jobId,db.pdf);
    const failed=await readPacketPdfJob(ctx,queued.jobId);
    assert.equal(failed.status,'failed');assert.equal(failed.result,null);assert.equal(db.state.packets.length,0);
    assert.equal(db.state.checkpoints.length,1);assert.equal(db.cropPuts,1);assert.equal(db.puts,0);
    const first=structuredClone(db.state.checkpoints[0]);
    assert.equal(first.entry_index,0);assert.equal(first.accepted_attempt,1);assert.equal(first.accepted_fence,1);
    assert.equal(first.body.identity.original.sourceId,db.secondSource.id);assert.equal(db.state.attempts[0].state,'fenced');
    await controlPacketPdfJob(ctx,{jobId:queued.jobId,action:'retry',expectedVersion:failed.version,requestKey:randomUUID()});
    await runPacketPdfJob(queued.jobId,db.pdf);
    const accepted=await readPacketPdfJob(ctx,queued.jobId),output=await readPacketPdfJobResult(ctx,queued.jobId,db.pdf);
    assert.equal(accepted.status,'succeeded');assert.equal(accepted.attempt.number,2);assert.equal(db.state.packets.length,1);
    assert.equal(db.extracts,3);assert.equal(db.cropPuts,2);assert.equal(db.puts,1);
    assert.deepEqual(db.extractAttempts,[db.secondSource.id,sourceId,sourceId]);
    assert.deepEqual(db.state.checkpoints[0],first);assert.equal(db.state.checkpoints[1].accepted_attempt,2);
    assert.equal(db.state.checkpoints[1].entry_index,1);assert.equal(db.state.checkpoints[1].accepted_fence,2);
    assert.equal(output.bytes.length,337862);assert.equal(sha256(output.bytes),'cda69b79c3aeccac153b624bb70cb62add81889e7add54a323e0426feb638172');
    const extracts=db.extracts;await runPacketPdfJob(queued.jobId,db.pdf);assert.equal(db.extracts,extracts);
    const saved=process.env.ULPIN_PACKET_ENTRY_FLOW_ROOT;
    if(saved){mkdirSync(saved,{recursive:true});writeFileSync(saved+'/packet.pdf',output.bytes,{flag:'wx'});
      writeFileSync(saved+'/accepted-first-crop.png',db.objects.get(first.object_key)!,{flag:'wx'});
      writeFileSync(saved+'/flow.json',JSON.stringify({scope:'Actual retained crop pixels through packet checkpoint/queue/service methods; SQL/storage/extractor/current-recipe/target/snapshot authority are explicit controls',
        plan,queued,failed,accepted,checkpointAfterFailure:first,checkpoints:db.state.checkpoints,attempts:db.state.attempts,
        job:db.state.jobs[0],metadata:db.state.jobMeta[0],execution:db.state.executions[0].body,
        extractAttempts:db.extractAttempts,cropPuts:db.cropPuts,packetPuts:db.puts,firstCropRepeated:false,
        output:{bytes:output.bytes.length,sha256:sha256(output.bytes)},events:db.state.events},null,2)+'\n',{flag:'wx'});}
  }));

test('PDF entry recovery: revoked full-set authority, changed recipe and corrupt committed crop refuse reuse without extraction',
  {skip:!present||!actualOtherOriginal},()=>withDb(async(db,ctx)=>{
    const {queued}=await queuedOriginals(db,ctx);db.extractFailAt=2;await runPacketPdfJob(queued.jobId,db.pdf);
    const first=structuredClone(db.state.checkpoints[0]),reads=db.reads;
    const retry=async()=>{const failed=await readPacketPdfJob(ctx,queued.jobId);
      await controlPacketPdfJob(ctx,{jobId:queued.jobId,action:'retry',expectedVersion:failed.version,requestKey:randomUUID()});};
    await retry();db.archived=true;await runPacketPdfJob(queued.jobId,db.pdf);
    assert.equal(db.state.jobs[0].error,'PACKET_PDF_ACCESS_REVOKED');assert.equal(db.reads,reads);assert.equal(db.extracts,2);
    db.archived=false;await retry();db.recipeChanged=true;await runPacketPdfJob(queued.jobId,db.pdf);
    assert.equal(db.state.jobs[0].error,'PACKET_PDF_INPUT_STALE');assert.equal(db.reads,reads);assert.equal(db.extracts,2);
    db.recipeChanged=false;await retry();const corrupt=Buffer.from(db.objects.get(first.object_key)!);corrupt[corrupt.length-1]^=1;
    db.objects.set(first.object_key,corrupt);await runPacketPdfJob(queued.jobId,db.pdf);
    assert.equal(db.state.jobs[0].error,'PACKET_PDF_CHECKPOINT_INTEGRITY');assert.equal(db.extracts,2);
    assert.deepEqual(db.state.checkpoints[0],first);assert.equal(db.state.checkpoints.length,1);assert.equal(db.state.packets.length,0);
    assert(!db.state.events.some(e=>e.type==='job.succeeded'||e.type==='packet.plan.executed'));
  }));

test('PDF entry recovery: missing migration stays actionable; expired acceptance is not cached; unknown entry COMMIT recovers',
  {skip:!present||!actualOtherOriginal},async()=>{
    await withDb(async(db,ctx)=>{
      const {queued,command}=await queuedOriginals(db,ctx);db.checkpointAvailable=false;
      await runPacketPdfJob(queued.jobId,db.pdf);
      assert.equal(db.state.jobs[0].error,'PACKET_PDF_CHECKPOINT_UNAVAILABLE');assert.equal(db.extracts,0);assert.equal(db.objects.size,0);
      const sync=await executePacketPlan(ctx,command,db.io);assert.equal(sync.packet.artifact.sha256,'cda69b79c3aeccac153b624bb70cb62add81889e7add54a323e0426feb638172');
      assert.equal(db.state.checkpoints.length,0);
    });
    await withDb(async(db,ctx)=>{
      const {queued}=await queuedOriginals(db,ctx);
      db.afterCropPut=()=>{db.afterCropPut=undefined;db.state.attempts[0].lease_until=new Date(Date.now()-1).toISOString();};
      await runPacketPdfJob(queued.jobId,db.pdf);
      assert.equal(db.state.checkpoints.length,0);assert.equal(db.objects.size,1);assert.equal(db.state.packets.length,0);
      assert.equal(db.state.jobs[0].error,'PACKET_PDF_INPUT_STALE');
    });
    await withDb(async(db,ctx)=>{
      const {queued}=await queuedOriginals(db,ctx);
      db.afterCropPut=()=>{db.afterCropPut=undefined;db.commitLost=true;};await runPacketPdfJob(queued.jobId,db.pdf);
      assert.equal(db.state.checkpoints.length,1);assert.equal(db.state.jobs[0].status,'running');assert.equal(db.state.packets.length,0);
      const first=structuredClone(db.state.checkpoints[0]);db.state.attempts[0].lease_until=new Date(Date.now()-1).toISOString();
      await runPacketPdfJob(queued.jobId,db.pdf);
      assert.equal((await readPacketPdfJob(ctx,queued.jobId)).status,'succeeded');assert.equal(db.extracts,2);
      assert.deepEqual(db.state.checkpoints[0],first);assert.equal(db.state.checkpoints.length,2);assert.equal(db.state.packets.length,1);
      assert.deepEqual(db.extractAttempts,[db.secondSource.id,sourceId]);
    });
  });

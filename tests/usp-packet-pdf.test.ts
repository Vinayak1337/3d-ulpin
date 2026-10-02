import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import type {Pool,PoolClient} from 'pg';
import {RegistryRegionCitationSchema} from '../packages/contracts/src';
import {UspSnapshotManifestSchema,type RequestContext} from '../packages/contracts/src/usp';
import {UspPdfPacketPlanInputSchema,UspPacketPdfReceiptSchema} from '../packages/contracts/src/usp/packet-pdf';
import {PacketRegionWorkerSchema} from '../packages/contracts/src/packet-region';
import {createPacketPlan,revisePacketPlan,confirmPacketPlan,executePacketPlan,readPacketPlan} from '../packages/server/src/modules/usp/packets/plan-service';
import {readPacketPdf,type PdfPacketIo} from '../packages/server/src/modules/usp/packets/pdf-service';
import {readPacket0} from '../packages/server/src/modules/usp/packet0';
import {generatePropertyCard} from '../packages/server/src/modules/usp/packets/card-service';
import {regionCitationId} from '../packages/server/src/modules/registry/registry-region-evidence';
import {registryRegionSourceTx} from '../packages/server/src/modules/registry/registry-region-evidence';
import {fingerprint,canonical} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';

// Adapted from existing packet-plan memory SQL/transport control. All identities,
// committed target/history and snapshot rows are technical doubles. Unchanged
// retained crop bytes/proof are reused; no native execution or original I/O.
const root='E:/BhuAayam-data/task-data/desktop-packet-region-extract-20261002/real-crop-02';
const present=existsSync(root+'/result.json')&&existsSync(root+'/region.png'),subject='packet-pdf-protocol-control';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const siteId=id(1),sourceId=id(2),caseId=id(3),targetId=id(4),manifestId=id(5),digest='a'.repeat(64);
type State={plans:any[];confirmations:any[];executions:any[];receipts:any[];packets:any[];streams:any[];events:any[]};
class ControlDb{
  state:State={plans:[],confirmations:[],executions:[],receipts:[],packets:[],streams:[],events:[]};
  queries:{q:string;v:any[]}[]=[];active=0;connects=0;releases=0;transactionActive=0;heldCases=new Set<string>();
  expired=false;archived=false;latest=1;failEvent=false;extractFail=false;afterExtract?:()=>void;afterPut?:()=>void;afterRead?:()=>void;
  ctx!:RequestContext;objects=new Map<string,Uint8Array>();extracts=0;puts=0;reads=0;
  region=PacketRegionWorkerSchema.parse(JSON.parse(readFileSync(root+'/result.json','utf8')));png=readFileSync(root+'/region.png');
  oldBody={kind:'building',name:'Technical committed target',alias:'Technical target',footprint:[],links:[],rights:[],evidence:[],synthetic:true};
  source:any={id:sourceId,case_id:caseId,family_id:sourceId,revision:1,name:'Technical retained original',
    sha256:this.region.sourceSha256,bytes:this.region.sourceBytes,object_key:'technical-only-no-original-io',profile:'pdf-reference-v2',status:'needs_input',
    inspection:{documentOriginal:{version:'source-document/1',subject,format:'pdf',sha256:this.region.sourceSha256,
      bytes:this.region.sourceBytes,receivedAt:'2026-10-02T00:00:00Z'}}};
  sourceCase:any={id:caseId,site_id:siteId,revision:1,archived:false,context:null,frame:null};
  citation:any;record:any;captured:any;history=new Map<number,any>();
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
  capture(){this.captured={...structuredClone(this.record),project_code:null,project_status:null,project_location:null,projectIdentity:null,historicalAliases:[]};}
  manifest(){return UspSnapshotManifestSchema.parse({schemaVersion:'usp/1',id:manifestId,digest,scope:this.scope,
    capturedAt:'2026-10-02T00:00:00Z',selection:{kind:'targets',pins:[this.target]},
    members:[{pin:this.target,bodySha256:fingerprint(this.captured),bodyRef:'technical-target',authority:'registry'}],
    frame:{horizontal:null,vertical:null,unit:null,transform:null},accessViewId:this.ctx.accessViewId,policyVersion:this.ctx.policyVersion,
    validAt:null,asOf:null,coverage:{state:'complete',reasonCodes:[]}});}
  pool={query:(q:string,v:any[])=>this.query(q,v),connect:async()=>{
    this.connects++;this.active++;let baseline:State;
    return {release:()=>{this.releases++;this.active--;},query:async(q:string,v:any[]=[])=>{
      if(q==='BEGIN'){baseline=structuredClone(this.state);this.transactionActive++;}
      if(q==='ROLLBACK')this.state=baseline!;
      const result=await this.query(q,v);
      if(q==='COMMIT'||q==='ROLLBACK'){this.transactionActive--;this.heldCases.clear();}return result;
    }} as unknown as PoolClient;
  }} as unknown as Pool;
  async query(sql:string,v:any[]=[]){
    const q=sql.replace(/\s+/g,' ').trim();this.queries.push({q,v});const result=(rows:any[]=[])=>({rows,rowCount:rows.length});
    if(q==='BEGIN'||q==='COMMIT'||q==='ROLLBACK'||q.includes('pg_advisory_xact_lock'))return result();
    if(q.startsWith('SELECT set_config'))return result([{deadline_live:true}]);
    if(q.startsWith('SELECT id FROM cases')&&q.includes('FOR SHARE')){this.heldCases.add(v[0]);return result([{id:v[0]}]);}
    if(q.includes('FROM cases'))return result(v[0]===caseId?[{...this.sourceCase,archived:this.archived}]:[]);
    if(q.includes('SELECT max(revision)'))return result([{revision:this.latest}]);
    if(q.includes('FROM sources'))return result(v[q.includes('WHERE case_id=')?1:0]===sourceId?[structuredClone(this.source)]:[]);
    if(q.startsWith('SELECT body FROM usp_snapshots'))return result([{body:this.manifest()}]);
    if(q.startsWith('SELECT body,body_sha256 FROM usp_snapshot_bodies'))return result(v[2]===targetId&&v[3]===2?
      [{body:structuredClone(this.captured),body_sha256:fingerprint(this.captured)}]:[]);
    if(q.includes('FROM registry_revisions'))return result(this.history.has(v[1])?[{body:structuredClone(this.history.get(v[1]))}]:[]);
    if(q.includes('FROM registry_records'))return result(v[0]===targetId&&v[1]===siteId?
      [{...structuredClone(this.record),...q.includes('project_code')?{project_code:null,project_status:null,project_location:null}:{project_status:null}}]:[]);
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
    this.extracts++;if(this.extractFail)throw new Error('CONTROL renderer failed');
    assert.equal(source,sourceId);assert.equal(page,1);assert.equal(raw.sha256,this.region.sourceSha256);
    assert.equal(canonical(raw.selection),canonical(this.citation.region));this.afterExtract?.();
    return {bytes:this.png,provenance:{...this.region,version:'packet-region/1',caseId,caseRevision:1,sourceId,sourceRevision:1,purpose:'private_source_preview'}};
  },put:async(key,bytes,type)=>{assert.equal(this.active,0);assert.equal(type,'application/pdf');assert(!this.objects.has(key));
    this.puts++;this.objects.set(key,Buffer.from(bytes));this.afterPut?.();},
    read:async(key,bytes,hash)=>{assert.equal(this.active,0);this.reads++;const value=this.objects.get(key);assert(value);
      assert.equal(bytes,value.length);this.afterRead?.();return Buffer.from(value);}};
  io={read:async()=>{throw new Error('PDF must not use PACK0 original I/O');},put:async()=>{throw new Error('PDF must not use PACK0 writer');},pdf:this.pdf};
  input(bindingId=this.citation.id){return UspPdfPacketPlanInputSchema.parse({target:this.target,scope:this.scope,purpose:'record_evidence',
    format:'pdf',recipe:'pack1-single-region-image/1',expiresAt:new Date(Date.now()+3600000).toISOString(),
    entries:[{bindingId,required:true,inclusionReason:'Explicit technical exact committed region selection'}]});}
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

test('blocked selection → immutable revise → exact confirmation → clean PDF/read/replay; historical versions and PACK0/card refusal',
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
    await assert.rejects(()=>generatePropertyCard(ctx,{planId:plan.planId,planVersion:2,cardId:null,expiresAt:new Date(Date.now()+3600000).toISOString(),
      guard:{mode:'create',requestKey:randomUUID()}}),(e:any)=>e.code==='CARD_PDF_PLAN_UNSUPPORTED');
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

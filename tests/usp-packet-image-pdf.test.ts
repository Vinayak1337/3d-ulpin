import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import type {Pool,PoolClient} from 'pg';
import {RegistryImageRegionCitationSchema} from '../packages/contracts/src/registry-document-evidence';
import {PacketImageRegionProvenanceSchema} from '../packages/contracts/src/packet-image-region';
import {PACKET_IMAGE_PDF_RECIPE,UspImagePdfPacketPlanInputSchema,UspPacketImagePdfReceiptSchema}
  from '../packages/contracts/src/usp/packet-image-pdf';
import {UspSnapshotManifestSchema,type RequestContext} from '../packages/contracts/src/usp';
import {createPacketPlan,confirmPacketPlan,executePacketPlan,readPacketPlan} from '../packages/server/src/modules/usp/packets/plan-service';
import {readPacketPdf,capturePacketPdfTx,type PdfPacketIo} from '../packages/server/src/modules/usp/packets/pdf-service';
import {enqueuePacketPdfJob} from '../packages/server/src/modules/usp/packets/pdf-jobs';
import {readPacketPdfBundle} from '../packages/server/src/modules/usp/packets/pdf-bundle';
import {generatePropertyCard} from '../packages/server/src/modules/usp/packets/card-service';
import {assemblePacketImagePdf} from '../packages/server/src/modules/usp/packets/image-pdf-render';
import {registryImageRegionSourceTx,imageRegionCitationId} from '../packages/server/src/modules/registry/registry-image-region-evidence';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {fingerprint,canonical} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {transaction} from '../packages/server/src/infrastructure/db';

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
  afterPut?:()=>void;afterRead?:()=>void;failEvent=false;
  objects=new Map<string,Uint8Array>();queries:string[]=[];
  state={plans:[] as any[],confirmations:[] as any[],executions:[] as any[],receipts:[] as any[],packets:[] as any[],streams:[] as any[],events:[] as any[]};
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
  pool={connect:async()=>{this.opens++;let baseline:typeof this.state;
    return {release:()=>{this.releases++;},query:async(q:string,v:any[]=[])=>{
      if(q==='BEGIN'){baseline=structuredClone(this.state);this.active++;}
      if(q==='ROLLBACK')this.state=baseline!;
      const result=await this.query(q,v);if(q==='COMMIT'||q==='ROLLBACK')this.active--;return result;
    }} as unknown as PoolClient;}} as unknown as Pool;
  async query(sql:string,v:any[]=[]){const q=sql.replace(/\s+/g,' ').trim();this.queries.push(q);
    const rows=(value:any[]=[])=>({rows:value,rowCount:value.length});
    if(['BEGIN','COMMIT','ROLLBACK'].includes(q)||q.includes('pg_advisory_xact_lock'))return rows();
    if(q.startsWith('SELECT set_config'))return rows([{deadline_live:true}]);
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
    put:async(key,bytes,type)=>{assert.equal(this.active,0);assert.equal(type,'application/pdf');this.puts++;
      this.objects.set(key,Buffer.from(bytes));this.afterPut?.();},
    read:async(key,bytes,hash)=>{assert.equal(this.active,0);this.reads++;const value=this.objects.get(key);assert(value);
      assert.equal(value.length,bytes);assert.equal(sha256(value),hash);this.afterRead?.();return value;}};
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

test('saved committed original-image citation -> plan -> confirm -> atomic PDF -> exact private download; guards before I/O',()=>control(async db=>{
  const {plan,confirmation,command}=await db.confirmed();
  const execution=await executePacketPlan(db.ctx,command,db.io),receipt=UspPacketImagePdfReceiptSchema.parse(execution.packet);
  assert.equal(receipt.bindingId,db.citation.id);assert.deepEqual(receipt.assembly.region,db.citation.validation);
  const downloaded=await readPacketPdf(db.ctx,receipt.packetId,db.pdf);
  assert.equal(sha256(downloaded.bytes),receipt.artifact.sha256);assert.deepEqual(downloaded.bytes,assemblePacketImagePdf(db.citation.validation,db.png).bytes);
  assert.deepEqual((await readPacketPlan(db.ctx,{planId:plan.planId,version:1})).execution,execution);
  assert.deepEqual(await executePacketPlan(db.ctx,command,db.io),execution);assert.equal(db.extracts,1);assert.equal(db.puts,1);
  const before=db.reads;
  await assert.rejects(()=>enqueuePacketPdfJob(db.ctx,command),code('PACKET_IMAGE_PDF_QUEUE_UNSUPPORTED'));
  await assert.rejects(()=>readPacketPdfBundle(db.ctx,receipt.packetId,{read:db.pdf.read,
    capture:(ctx,id)=>transaction(client=>capturePacketPdfTx(client,ctx,id))}),code('PACKET_IMAGE_PDF_BUNDLE_UNSUPPORTED'));
  await assert.rejects(()=>generatePropertyCard(db.ctx,{planId:plan.planId,planVersion:1,cardId:null,
    expiresAt:new Date(Date.now()+3600000).toISOString(),guard:{mode:'create',requestKey:randomUUID()}},
    {pdf:db.pdf,readPacket:db.io.read,readCard:db.pdf.read,put:db.pdf.put}),code('PACKET_IMAGE_PDF_CARD_UNSUPPORTED'));
  assert.equal(db.reads,before);
  const root=process.env.ULPIN_PACKET_IMAGE_PDF_EVIDENCE;
  if(root){mkdirSync(root,{recursive:true});writeFileSync(root+'/packet.pdf',downloaded.bytes,{flag:'wx'});
    writeFileSync(root+'/journey.json',JSON.stringify({classification:'retained_crop_and_citation; controlled_source_target_SQL_storage',
      priorCitationJourneySha256:sha256(readFileSync(citations+'/png-journey.json')),plan,confirmation,execution,
      download:{sha256:sha256(downloaded.bytes),bytes:downloaded.bytes.length},extracts:db.extracts,puts:db.puts},null,2),{flag:'wx'});}
  db.afterRead=()=>{db.source.inspection.documentOriginal.subject='revoked-after-read';};
  await assert.rejects(()=>readPacketPdf(db.ctx,receipt.packetId,db.pdf),code('DOCUMENT_DENIED'));db.afterRead=undefined;
  const reads=db.reads;await assert.rejects(()=>readPacketPdf(db.ctx,receipt.packetId,db.pdf),code('DOCUMENT_DENIED'));assert.equal(db.reads,reads);
}));

test('missing, uncommitted, stale image context and alpha cannot publish; late revocation keeps staged bytes unreachable',()=>control(async db=>{
  const missing=await createPacketPlan(db.ctx,{input:db.input(digest),guard:{mode:'create',requestKey:randomUUID()}},db.io);
  assert.equal(missing.requiredContext,'blocked');await assert.rejects(()=>confirmPacketPlan(db.ctx,confirmationCommand(db,missing),db.io),code('PACKET_PLAN_BLOCKED'));
  db.latest=2;await assert.rejects(()=>createPacketPlan(db.ctx,{input:db.input(),guard:{mode:'create',requestKey:randomUUID()}},db.io),/current retained image/);db.latest=1;
  const bad=structuredClone(db.citation);bad.target.revision=2;bad.id=imageRegionCitationId(bad);
  db.record.body.documentCitations=[bad];db.capture();db.history.set(2,structuredClone(db.record.body));
  await assert.rejects(()=>createPacketPlan(db.ctx,{input:db.input(bad.id),guard:{mode:'create',requestKey:randomUUID()}},db.io),/canonical commit/);
  db.record.body.documentCitations=[db.citation];db.capture();db.history.set(2,structuredClone(db.record.body));
  assert.throws(()=>assemblePacketImagePdf({...db.citation.validation,output:{...db.citation.validation.output,mode:'RGBA'}},db.png),code('PACKET_IMAGE_PDF_ALPHA_UNSUPPORTED'));
  assert.throws(()=>assemblePacketImagePdf({...db.citation.validation,sourceImage:{...db.citation.validation.sourceImage,
    color:{...db.citation.validation.sourceImage.color,transparency:'supplied'}}},db.png),code('PACKET_IMAGE_PDF_ALPHA_UNSUPPORTED'));
  assert.equal(db.extracts,0);const {command}=await db.confirmed();
  db.afterPut=()=>{db.source.inspection.documentOriginal.subject='revoked-before-publication';};
  await assert.rejects(()=>executePacketPlan(db.ctx,command,db.io),code('DOCUMENT_DENIED'));
  assert.equal(db.objects.size,1);assert.equal(db.state.packets.length,0);assert.equal(db.state.executions.length,0);
}));

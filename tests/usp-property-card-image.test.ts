import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import type {Pool,PoolClient} from 'pg';
import {UspSnapshotManifestSchema,type RequestContext} from '../packages/contracts/src/usp';
import {UspPropertyCardSchema} from '../packages/contracts/src/usp/property-card';
import {UspImagePdfPacketPlanSchema,UspImagePdfPacketPlanExecutionSchema} from '../packages/contracts/src/usp/packet-image-pdf';
import {generatePropertyCard,readPropertyCard,resolvePropertyCard,type PropertyCardIo} from '../packages/server/src/modules/usp/packets/card-service';
import {registryImageRegionSourceTx} from '../packages/server/src/modules/registry/registry-image-region-evidence';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {fingerprint,canonical} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// Reuse the actual saved accepted image PDF and immutable plan/confirmation/
// committed citation. Reconstructed source/target/snapshot/SQL/storage are technical
// controls. No crop, original, model, native PDF renderer or source fact extraction.
const root='E:/BhuAayam-data/task-data/desktop-packet-image-pdf-20261003';
const citationRoot='E:/BhuAayam-data/task-data/desktop-reviewed-image-regions-20261003';
const subject='registry-image-region-technical-control',pdfHash='1893b7bb2bf26b3ebe54b99fbdfd432dd5d1878901bb8a9744043a1ad4f2eb39';
const code=(value:string)=>(error:any)=>error.code===value;
class CardDb{
  saved=JSON.parse(readFileSync(root+'/journey.json','utf8'));
  plan=UspImagePdfPacketPlanSchema.parse(this.saved.plan);
  execution=UspImagePdfPacketPlanExecutionSchema.parse(this.saved.execution);
  confirmation=this.saved.confirmation;
  prior=JSON.parse(readFileSync(citationRoot+'/png-journey.json','utf8'));
  citation=this.plan.entries[0].binding!;
  packet=readFileSync(root+'/packet.pdf');ctx!:RequestContext;
  source:any;sourceCase:any;record:any;captured:any;latest=1;history=new Map<number,any>();
  active=0;opens=0;releases=0;packetReads=0;cardReads=0;cardPuts=0;
  afterPacketRead?:()=>void;afterCardRead?:()=>void;afterCardPut?:()=>void;
  objects=new Map<string,Uint8Array>();queries:string[]=[];
  state={plans:[] as any[],confirmations:[] as any[],executions:[] as any[],packets:[] as any[],
    cards:[] as any[],receipts:[] as any[],streams:[] as any[],events:[] as any[]};
  constructor(){
    const p=this.citation.document,binding=ingestionBinding(p.caseId),siteId=this.plan.input.scope.scopeId;
    this.source={id:p.sourceId,case_id:p.caseId,family_id:p.sourceId,revision:1,sha256:p.sourceSha256,bytes:p.sourceBytes,
      object_key:'technical-retained-image',name:'Technical image envelope',mime_type:'image/png',profile:'image-reference-v2',
      status:'needs_input',created_at:'2026-10-03T00:00:00Z',inspection:{status:'needs_input',
        documentOriginal:{version:'source-document/1',subject:binding.subject,format:'png',sha256:p.sourceSha256,
          bytes:p.sourceBytes,receivedAt:'2026-10-03T00:00:00Z'}}};
    this.sourceCase={id:p.caseId,site_id:siteId,revision:1,archived:false,context:null,frame:null};
    const body=structuredClone(this.prior.storedHistory),{documentCitations:_,...old}=body;
    assert.equal(fingerprint(old),this.citation.target.bodySha256);this.history.set(1,old);this.history.set(2,structuredClone(body));
    this.record={id:this.plan.input.target.ref.id,site_id:siteId,kind:'building',revision:2,identifier:'technical-reference',body};
    this.captured={...structuredClone(this.record),project_code:null,project_status:null,project_location:null,
      projectIdentity:null,historicalAliases:[]};
    assert.equal(fingerprint(this.captured),this.plan.targetBodySha256);
    assert.equal(sha256(this.packet),pdfHash);assert.equal(this.packet.length,60397);
    assert.equal(this.execution.packet.artifact.sha256,pdfHash);
    const packetId=this.execution.packet.packetId,key=`usp/packets/${packetId}/${pdfHash}`;
    this.objects.set(key,this.packet);
    this.state.plans=[{id:this.plan.planId,version:this.plan.version,body:structuredClone(this.plan)}];
    this.state.confirmations=[{plan_id:this.plan.planId,version:this.plan.version,body:structuredClone(this.confirmation)}];
    this.state.executions=[{plan_id:this.plan.planId,version:this.plan.version,packet_id:packetId,body:structuredClone(this.execution)}];
    this.state.packets=[{id:packetId,artifact_hash:pdfHash,object_key:key,body:structuredClone(this.execution.packet)}];
  }
  async init(){const current=await registryImageRegionSourceTx({query:this.query.bind(this)} as any,this.plan.input.scope.scopeId,this.citation.document);
    assert.equal(current.authority.authoritySha256,this.citation.authoritySha256);this.queries=[];}
  manifest(){const pin=this.plan.input.target,scope=this.plan.input.scope;
    return UspSnapshotManifestSchema.parse({schemaVersion:'usp/1',id:scope.manifestId,digest:scope.snapshotDigest,scope,
      capturedAt:'2026-10-03T00:00:00Z',selection:{kind:'targets',pins:[pin]},
      members:[{pin,bodySha256:fingerprint(this.captured),bodyRef:fingerprint([pin.ref.namespace,pin.ref.id,pin.revision,this.captured]),authority:'registry'}],
      frame:{horizontal:null,vertical:null,unit:null,transform:null},accessViewId:this.ctx.accessViewId,policyVersion:this.ctx.policyVersion,
      validAt:null,asOf:null,coverage:{state:'complete',reasonCodes:[]}});}
  pool={connect:async()=>{this.opens++;let baseline:typeof this.state;
    return {release:()=>{this.releases++;},query:async(q:string,v:any[]=[])=>{
      if(q==='BEGIN'){baseline=structuredClone(this.state);this.active++;}if(q==='ROLLBACK')this.state=baseline!;
      const result=await this.query(q,v);if(q==='COMMIT'||q==='ROLLBACK')this.active--;return result;
    }} as unknown as PoolClient;}} as unknown as Pool;
  async query(sql:string,v:any[]=[]){const q=sql.replace(/\s+/g,' ').trim();this.queries.push(q);
    const rows=(value:any[]=[])=>({rows:value,rowCount:value.length});
    if(['BEGIN','COMMIT','ROLLBACK'].includes(q)||q.includes('pg_advisory_xact_lock'))return rows();
    if(q.startsWith('SELECT set_config'))return rows([{deadline_live:true}]);
    if(q.includes('FROM cases'))return rows(v[0]===this.sourceCase.id?[structuredClone(this.sourceCase)]:[]);
    if(q.includes('SELECT max(revision)')&&q.includes('usp_property_cards'))return rows([{revision:Math.max(...this.state.cards.filter(c=>c.id===v[0]).map(c=>c.revision))}]);
    if(q.includes('SELECT max(revision)'))return rows([{revision:this.latest}]);
    if(q.includes('FROM sources'))return rows(v[q.includes('WHERE case_id=')?1:0]===this.source.id?[structuredClone(this.source)]:[]);
    if(q.includes('FROM registry_sites'))return rows([{id:this.plan.input.scope.scopeId}]);
    if(q.includes('FROM registry_records'))return rows(v[0]===this.record.id&&v[1]===this.record.site_id?
      [{...structuredClone(this.record),project_status:null}]:[]);
    if(q.includes('FROM registry_revisions'))return rows(this.history.has(v[1])?[{body:structuredClone(this.history.get(v[1]))}]:[]);
    if(q.startsWith('SELECT body FROM usp_snapshots'))return rows([{body:this.manifest()}]);
    if(q.includes('FROM usp_snapshot_bodies'))return rows(v[2]===this.record.id&&v[3]===2?[{body:structuredClone(this.captured),body_sha256:fingerprint(this.captured)}]:[]);
    if(q.startsWith('SELECT clock_timestamp()'))return rows([{live:Date.parse(v[0])>Date.now()}]);
    if(q.includes('FROM usp_packet_plans'))return rows(this.state.plans.filter(p=>p.id===v[0]&&p.version===v[1]));
    if(q.includes('FROM usp_packet_plan_confirmations'))return rows(this.state.confirmations.filter(p=>p.plan_id===v[0]&&p.version===v[1]));
    if(q.includes('FROM usp_packet_plan_executions'))return rows(this.state.executions.filter(p=>q.includes('packet_id=')?p.packet_id===v[0]:p.plan_id===v[0]&&p.version===v[1]));
    if(q.includes('FROM usp_packets'))return rows(this.state.packets.filter(p=>p.id===v[0]));
    if(q.includes('FROM usp_property_cards'))return rows(this.state.cards.filter(c=>c.id===v[0]&&c.revision===v[1]));
    if(q.includes('FROM usp_command_receipts'))return rows(this.state.receipts.filter(p=>p.subject===v[0]&&p.scope_key===v[1]&&p.operation===v[2]&&p.request_key===v[3]));
    if(q.startsWith('INSERT INTO usp_property_cards')){this.state.cards.push({id:v[0],revision:v[1],artifact_hash:v[8],object_key:v[9],body:structuredClone(v[10])});return rows();}
    if(q.startsWith('INSERT INTO usp_command_receipts')){this.state.receipts.push({subject:v[1],scope_key:v[2],operation:v[3],request_key:v[4],command_sha256:v[5],body:structuredClone(v[6])});return rows();}
    if(q.startsWith('INSERT INTO usp_outbox_streams')){if(!this.state.streams.some(s=>s.id===v[0]))this.state.streams.push({id:v[0],sequence:0});return rows();}
    if(q.startsWith('UPDATE usp_outbox_streams'))return rows([{sequence:String(++this.state.streams.find(s=>s.id===v[0]).sequence)}]);
    if(q.startsWith('INSERT INTO usp_outbox(')){this.state.events.push(v[2]);return rows();}
    throw new Error('Unmodelled image card SQL: '+q);
  }
  io:PropertyCardIo={readPacket:async()=>{throw new Error('No original/PACK0 read');},
    pdf:{extract:async()=>{throw new Error('No PDF source run');},imageExtract:async()=>{throw new Error('No image crop run');},
      put:async()=>{throw new Error('No packet write');},read:async(key,bytes,hash)=>{
        assert.equal(this.active,0);this.packetReads++;const value=this.objects.get(key);assert(value);
        assert.equal(value.length,bytes);assert.equal(sha256(value),hash);this.afterPacketRead?.();return value;}},
    readCard:async(key,bytes,hash)=>{assert.equal(this.active,0);this.cardReads++;const value=this.objects.get(key);assert(value);
      assert.equal(value.length,bytes);assert.equal(sha256(value),hash);this.afterCardRead?.();return value;},
    put:async(key,bytes,type)=>{assert.equal(this.active,0);assert.equal(type,'application/pdf');this.cardPuts++;
      assert(bytes.length<=524288);this.objects.set(key,Buffer.from(bytes));this.afterCardPut?.();}};
  command(){return {planId:this.plan.planId,planVersion:this.plan.version,cardId:null,
    expiresAt:new Date(Date.now()+3600000).toISOString(),guard:{mode:'create' as const,requestKey:randomUUID()}};}
}
async function control(work:(db:CardDb)=>Promise<void>){const global=globalThis as unknown as {ulpinPool?:Pool},oldPool=global.ulpinPool,
  oldSubject=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
  const db=new CardDb();global.ulpinPool=db.pool;db.ctx=localRequestContext(randomUUID());
  try{await db.init();await work(db);assert.equal(db.opens,db.releases);assert.equal(db.active,0);
    assert.equal(sha256(db.packet),pdfHash);assert.deepEqual(db.state.plans[0].body,db.plan);
    assert.deepEqual(db.state.executions[0].body,db.execution);}
  finally{global.ulpinPool=oldPool;if(oldSubject===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=oldSubject;}}

test('saved accepted image PDF -> existing card generate/read/replay/exact resolver; captured facts never come from pixels',()=>control(async db=>{
  const command=db.command(),card=UspPropertyCardSchema.parse(await generatePropertyCard(db.ctx,command,db.io));
  assert.equal(card.profile,'property-card-summary-ascii/1');assert.equal(card.mode,'local_operator');
  assert.equal(card.packetId,db.execution.packet.packetId);assert.equal(card.packetSha256,pdfHash);
  assert.equal(card.planSha256,db.plan.planSha256);assert.equal(card.confirmationId,db.confirmation.confirmationId);
  assert.deepEqual(card.target,db.plan.input.target);assert.deepEqual(card.scope,db.plan.input.scope);
  assert.equal(card.targetBodySha256,db.plan.targetBodySha256);assert.deepEqual(card.evidenceEntrySha256,db.plan.entries.map(e=>e.entrySha256));
  for(const key of ['project_identity','vertical_locator','parcel_assertions','declared_share','geometry','measurements','render'])
    assert.equal(card.facts.find(f=>f.key===key)?.state,'unavailable');
  assert.equal(card.facts.find(f=>f.key==='rights')?.state,'not_assessed');
  assert.equal(card.facts.find(f=>f.key==='identifier')?.value,db.captured.identifier);
  const before={reads:db.packetReads+db.cardReads,puts:db.cardPuts,events:db.state.events.length};
  assert.deepEqual(await generatePropertyCard(db.ctx,command,db.io),card);
  assert.deepEqual({reads:db.packetReads+db.cardReads,puts:db.cardPuts,events:db.state.events.length},before);
  assert.equal(db.state.cards.length,1);const exact={cardId:card.cardId,revision:card.revision};
  const view=await readPropertyCard(db.ctx,exact,db.io);assert.deepEqual(view.card,card);assert.equal(view.snapshotState,'same_revision');
  db.record.revision=3;db.record.body.name='Later technical record';
  const historical=await readPropertyCard(db.ctx,exact,db.io);assert.deepEqual(historical.card,card);
  assert.equal(historical.snapshotState,'changed_revision');assert.equal(historical.currentTargetRevision,3);
  const url=new URL(card.resolverUrl);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.search,'');assert.equal(url.hash,'');
  const match=/\/property-cards\/([^/]+)\/revisions\/([1-9]\d*)$/.exec(url.pathname)!;
  const resolved=await resolvePropertyCard(db.ctx,{cardId:match[1],revision:Number(match[2])},db.io);
  assert.deepEqual(resolved.card,card);assert.equal(sha256(resolved.bytes),card.artifact.sha256);assert.equal(resolved.bytes.length,card.artifact.bytes);
  await assert.rejects(()=>resolvePropertyCard(db.ctx,{...exact,revision:9},db.io),/exact property card revision/);
  assert.equal(db.state.packets.length,1);assert.equal(db.cardPuts,1);
  const evidence=process.env.ULPIN_IMAGE_CARD_EVIDENCE;
  if(evidence){mkdirSync(evidence,{recursive:true});writeFileSync(evidence+'/property-card.pdf',resolved.bytes,{flag:'wx'});
    writeFileSync(evidence+'/journey.json',JSON.stringify({classification:'saved_accepted_image_PDF; controlled_source_target_snapshot_SQL_storage',
      priorJourneySha256:sha256(readFileSync(root+'/journey.json')),card,view,historical,resolver:{url:card.resolverUrl,
        cardId:resolved.card.cardId,revision:resolved.card.revision,bytes:resolved.bytes.length,sha256:sha256(resolved.bytes)},
      zeroIoReplay:true,cardPuts:db.cardPuts,imagePacketHashUnchanged:pdfHash,rendererProof:'existing profiles reused; no new native/QR campaign'},null,2),{flag:'wx'});}
}));

test('image card late source revocation and packet drift deny publication/resolver; stale source blocks I/O and expiry blocks card bytes',()=>control(async db=>{
  db.afterCardPut=()=>{db.source.inspection.documentOriginal.subject='revoked-before-card-publication';};
  await assert.rejects(()=>generatePropertyCard(db.ctx,db.command(),db.io),code('DOCUMENT_DENIED'));
  assert.equal(db.state.cards.length,0);assert.equal(db.state.receipts.length,0);assert.equal(db.state.events.length,0);
  db.afterCardPut=undefined;db.source.inspection.documentOriginal.subject=subject;
  const card=await generatePropertyCard(db.ctx,db.command(),db.io),exact={cardId:card.cardId,revision:1};
  db.afterCardRead=()=>{db.source.inspection.documentOriginal.subject='revoked-after-card-read';};
  await assert.rejects(()=>resolvePropertyCard(db.ctx,exact,db.io),code('DOCUMENT_DENIED'));
  const reads=db.packetReads+db.cardReads;await assert.rejects(()=>resolvePropertyCard(db.ctx,exact,db.io),code('DOCUMENT_DENIED'));
  assert.equal(db.packetReads+db.cardReads,reads);db.afterCardRead=undefined;db.source.inspection.documentOriginal.subject=subject;
  db.sourceCase.revision=2;await assert.rejects(()=>readPropertyCard(db.ctx,exact,db.io),/exact image original source or case pin changed/);
  assert.equal(db.packetReads+db.cardReads,reads);db.sourceCase.revision=1;
  const savedKey=db.state.packets[0].object_key;db.state.packets[0].object_key='changed-private-packet-link';
  await assert.rejects(()=>readPropertyCard(db.ctx,exact,db.io),/saved PDF linkage changed/);assert.equal(db.packetReads+db.cardReads,reads);
  db.state.packets[0].object_key=savedKey;
  const stored=db.state.cards[0],expired={...stored.body,expiresAt:'2000-01-01T00:00:00Z'};
  const {cardSha256:_,...body}=expired;stored.body={...body,cardSha256:fingerprint(body)};
  await assert.rejects(()=>resolvePropertyCard(db.ctx,exact,db.io),code('CARD_EXPIRED'));assert.equal(db.cardReads,1);
}));

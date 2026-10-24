import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import type {Pool,PoolClient} from 'pg';
import {PacketPdfBundleManifestSchema,PACKET_PDF_BUNDLE_LIMITS} from '../packages/contracts/src/usp/packet-pdf-bundle';
import {UspAnyPdfPacketPlanSchema,UspAnyPdfPacketPlanExecutionSchema,PACKET_PDF_LIMITS} from '../packages/contracts/src/usp/packet-pdf';
import {UspSnapshotManifestSchema} from '../packages/contracts/src/usp';
import {readPacketPdfBundle,type PdfBundleDependencies} from '../packages/server/src/modules/usp/packets/pdf-bundle';
import {capturePacketPdfTx,readPacketPdf,pdfPacketStorage} from '../packages/server/src/modules/usp/packets/pdf-service';
import {transaction} from '../packages/server/src/infrastructure/db';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {canonical,fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// Reuse saved accepted PDF/plan/confirmation/receipt bytes. Target, snapshot,
// source/access and SQL/storage rows are reconstructed controls, not real persistence
// or property applicability. No original/crop/renderer I/O or packet publication.
const single='E:/BhuAayam-data/task-data/desktop-packet-pdf-one-region-20261003/complete-flow',
  multiple='E:/BhuAayam-data/task-data/desktop-packet-pdf-multiple-originals-20261003/complete-flow',
  present=[single,multiple].every(root=>existsSync(root+'/flow.json')&&existsSync(root+'/packet.pdf'));
function fixture(root:string){
  const flowBytes=readFileSync(root+'/flow.json'),saved=JSON.parse(flowBytes.toString('utf8')),
    plan=UspAnyPdfPacketPlanSchema.parse(saved.plan),execution=UspAnyPdfPacketPlanExecutionSchema.parse(saved.execution),
    receipt=execution.packet,pdf=readFileSync(root+'/packet.pdf');
  assert.equal(sha256(flowBytes),root===single?'e6b88e09f4112a7544b4987dc6e90f50625f97f621691e80b804556f7334d110':'f342ef0ec187441b5d51685cdbc611c72f7bd5b1e2884706ef2e2979578cc2cb');
  assert.equal(sha256(pdf),receipt.assembly.output.sha256);assert.equal(pdf.length,receipt.assembly.output.bytes);
  const ctx=localRequestContext('private-pdf-bundle-control');assert.deepEqual(ctx.principal,plan.creator);
  const bindings=plan.entries.map(entry=>entry.binding!),oldBody={kind:'building',name:'Technical committed target',alias:'Technical target',
    footprint:[],links:[],rights:[],evidence:[],synthetic:true},
    ordered=[...bindings].sort((a,b)=>a.document.sourceId.localeCompare(b.document.sourceId)),
    record={id:receipt.target.ref.id,site_id:receipt.scope.scopeId,kind:'building',revision:receipt.target.revision,
      identifier:'technical-pdf-target',body:{...oldBody,documentCitations:ordered}},
    captured={...record,project_code:null,project_status:null,project_location:null,projectIdentity:null,historicalAliases:[]};
  assert.equal(fingerprint(oldBody),bindings[0].target.bodySha256);assert.equal(fingerprint(captured),plan.targetBodySha256);
  const manifest=UspSnapshotManifestSchema.parse({schemaVersion:'usp/1',id:receipt.scope.manifestId,digest:receipt.scope.snapshotDigest,
    scope:receipt.scope,capturedAt:'2026-10-02T00:00:00Z',selection:{kind:'targets',pins:[receipt.target]},
    members:[{pin:receipt.target,bodySha256:fingerprint(captured),bodyRef:fingerprint([receipt.target.ref.namespace,receipt.target.ref.id,receipt.target.revision,captured]),authority:'registry'}],
    frame:{horizontal:null,vertical:null,unit:null,transform:null},accessViewId:ctx.accessViewId,policyVersion:ctx.policyVersion,
    validAt:null,asOf:null,coverage:{state:'complete',reasonCodes:[]}});
  const state={active:0,reads:0,captures:0,archived:false,revokeAfterRead:false,overrun:false,deadlines:[] as number[],queries:[] as string[]};
  const sources=new Map(bindings.map(binding=>{const d=binding.document;return [d.sourceId,{id:d.sourceId,case_id:d.caseId,family_id:d.sourceId,
    revision:d.sourceRevision,sha256:d.sourceSha256,bytes:d.sourceBytes,object_key:'private-original-key-never-read',profile:'pdf-reference-v2',
    inspection:{documentOriginal:{version:'source-document/1',subject:ctx.principal.subject,format:'pdf',sha256:d.sourceSha256,
      bytes:d.sourceBytes,receivedAt:'2026-10-02T00:00:00Z'}}}];}));
  const query=async(raw:string,args:any[]=[])=>{
    const sql=raw.replace(/\s+/g,' ').trim();state.queries.push(sql);let rows:any[]=[];
    assert(!/^(INSERT|UPDATE|DELETE)\b/.test(sql),'Read representation must not write packet/job/receipt state');
    if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||sql.includes('pg_advisory_xact_lock'))rows=[];
    else if(sql.startsWith('SELECT set_config'))rows=[{deadline_live:true}];
    else if(sql.startsWith('SELECT id FROM cases')||sql.startsWith('SELECT id FROM sources'))rows=[];
    else if(sql.includes('FROM cases')){const d=bindings.find(binding=>binding.document.caseId===args[0])?.document;
      rows=d?[{id:d.caseId,site_id:receipt.scope.scopeId,revision:d.caseRevision,archived:state.archived,context:null,frame:null}]:[];}
    else if(sql.includes('SELECT max(revision)'))rows=[{revision:1}];
    else if(sql.includes('FROM sources'))rows=sources.has(args[sql.includes('WHERE case_id=')?1:0])?[sources.get(args[sql.includes('WHERE case_id=')?1:0])]:[];
    else if(sql.includes('FROM usp_snapshots'))rows=[{body:manifest}];
    else if(sql.includes('FROM usp_snapshot_bodies'))rows=[{body:captured,body_sha256:fingerprint(captured)}];
    else if(sql.includes('FROM registry_revisions'))rows=[{body:args[1]===receipt.target.revision?record.body:oldBody}];
    else if(sql.includes('FROM registry_records'))rows=[{...record,project_status:null}];
    else if(sql.includes('FROM registry_sites'))rows=[{id:receipt.scope.scopeId}];
    else if(sql.includes('FROM usp_packet_plans'))rows=[{body:plan}];
    else if(sql.includes('FROM usp_packet_plan_confirmations'))rows=[{body:saved.confirmation}];
    else if(sql.includes('FROM usp_packet_plan_executions'))rows=[{body:execution}];
    else if(sql.includes('FROM usp_packets'))rows=[{body:receipt,artifact_hash:receipt.artifact.sha256,object_key:`usp/packets/${receipt.packetId}/${receipt.artifact.sha256}`}];
    else assert.fail('Unexpected bundle control SQL '+sql);
    return {rows:structuredClone(rows),rowCount:rows.length};
  };
  const pool={connect:async()=>{state.active++;return {query,release:()=>{state.active--;}} as unknown as PoolClient;}} as unknown as Pool;
  const dependencies:PdfBundleDependencies={capture:(ctx,id,deadline)=>{state.captures++;state.deadlines.push(deadline);
    return transaction(client=>capturePacketPdfTx(client,ctx,id),{deadlineAt:deadline});},
    read:async(key,bytes,hash,deadline)=>{assert.equal(state.active,0,'Artifact I/O under authority locks');state.reads++;
      assert.equal(key,`usp/packets/${receipt.packetId}/${receipt.artifact.sha256}`);assert.equal(bytes,pdf.length);assert.equal(hash,sha256(pdf));
      if(deadline)state.deadlines.push(deadline);if(state.revokeAfterRead)state.archived=true;
      return state.overrun?Buffer.concat([pdf,Buffer.from([0])]):pdf;}};
  return {pool,ctx,plan,receipt,pdf,dependencies,state,flowBytes};
}
async function local(work:()=>Promise<void>){const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='packet-pdf-protocol-control';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}}
async function withFixture(root:string,work:(f:ReturnType<typeof fixture>)=>Promise<void>){
  const globals=globalThis as unknown as {ulpinPool?:Pool},prior=globals.ulpinPool,f=fixture(root);globals.ulpinPool=f.pool;
  try{await work(f);}finally{globals.ulpinPool=prior;assert.equal(f.state.active,0);}}
function save(name:string,value:Uint8Array|object){const dir=process.env.ULPIN_PACKET_BUNDLE_PROOF_DIR;if(!dir)return;
  mkdirSync(dir,{recursive:true});writeFileSync(dir+'/'+name,value instanceof Uint8Array?value:JSON.stringify(value,null,2)+'\n',{flag:'wx'});}

test('accepted single/two-original PDFs become deterministic private two-entry bundles with exact provenance and unchanged PDF reads',{skip:!present},()=>local(async()=>{
  for(const [name,root] of [['single',single],['multiple',multiple]])await withFixture(root,async f=>{
    const result=await readPacketPdfBundle(f.ctx,f.receipt.packetId,f.dependencies),entries=unzipSync(result.bytes),
      manifest=PacketPdfBundleManifestSchema.parse(JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8')));
    assert.deepEqual(Object.keys(entries),['packet.pdf','manifest.json']);assert.deepEqual(Buffer.from(entries['packet.pdf']),f.pdf);
    assert.deepEqual(manifest,result.manifest);assert.equal(manifest.packet.plan.sha256,f.plan.planSha256);
    assert.equal(manifest.packet.receiptSha256,fingerprint(f.receipt));assert.equal(manifest.packet.targetBodySha256,f.plan.targetBodySha256);
    assert.equal(manifest.entries.length,f.plan.entries.length);assert.equal(manifest.qualification.documentRole,'generated_compilation');
    for(const [index,entry] of manifest.entries.entries()){
      assert.equal(entry.source.sha256,f.plan.entries[index].binding!.document.sourceSha256);
      assert.deepEqual(entry.derivative,f.plan.entries[index].binding!.validation);assert.equal(entry.entrySha256,f.plan.entries[index].entrySha256);}
    assert(result.manifestBytes.length<=PACKET_PDF_BUNDLE_LIMITS.manifestBytes);assert(result.bytes.length<=PACKET_PDF_BUNDLE_LIMITS.archiveBytes);
    assert.equal(Buffer.from(result.bytes).readUInt16LE(8),0);assert.equal(Buffer.from(result.bytes).readUInt16LE(10),0);
    assert.equal(Buffer.from(result.bytes).readUInt16LE(12),33);assert.equal(f.state.reads,1);assert.equal(f.state.captures,2);
    assert.equal(new Set(f.state.deadlines).size,1);
    const text=Buffer.from(entries['manifest.json']).toString('utf8');
    for(const secret of ['object_key','accessSha256','subject','creator','reviewer','entitlementVersion','targetLabel','private-original-key-never-read','usp/packets/'])assert(!text.includes(secret));
    const repeat=await readPacketPdfBundle(f.ctx,f.receipt.packetId,f.dependencies);assert.deepEqual(repeat.bytes,result.bytes);
    const old=await readPacketPdf(f.ctx,f.receipt.packetId,{...pdfPacketStorage,read:f.dependencies.read});assert.deepEqual(old.bytes,f.pdf);assert.deepEqual(old.receipt,f.receipt);
    save(name+'.bundle.zip',result.bytes);save(name+'.manifest.json',result.manifestBytes);
    save(name+'.journey.json',{scope:'Saved accepted PDFs/receipts; reconstructed target/source/snapshot/access/SQL/storage authority; no original/crop/native I/O',
      inputRoot:root,packetId:f.receipt.packetId,pdfBytes:f.pdf.length,pdfSha256:sha256(f.pdf),zipBytes:result.bytes.length,zipSha256:result.sha256,
      manifestBytes:result.manifestBytes.length,manifestSha256:result.manifestSha256,captures:2,artifactReads:1,
      archiveFiles:Object.keys(entries),deterministic:true,oldReaderCompatible:true,sourcePermissionAndApplicability:'unqualified'});
  });
}));

test('revoked sources and bounded receipt/artifact overruns refuse bundle disclosure without writes',{skip:!present},()=>local(async()=>{
  await withFixture(multiple,async f=>{f.state.revokeAfterRead=true;
    await assert.rejects(()=>readPacketPdfBundle(f.ctx,f.receipt.packetId,f.dependencies),(e:any)=>e.status===403);
    assert.equal(f.state.reads,1);assert.equal(f.state.captures,2);});
  await withFixture(single,async f=>{f.state.overrun=true;
    await assert.rejects(()=>readPacketPdfBundle(f.ctx,f.receipt.packetId,f.dependencies),(e:any)=>e.code==='PACKET_PDF_ARTIFACT_INTEGRITY');
    assert.equal(f.state.captures,1);});
  await withFixture(single,async f=>{
    const capture=await f.dependencies.capture(f.ctx,f.receipt.packetId,Date.now()+30000),oversized=structuredClone(capture);
    oversized.receipt.assembly.output.bytes=PACKET_PDF_LIMITS.bytes+1;
    await assert.rejects(()=>readPacketPdfBundle(f.ctx,f.receipt.packetId,{...f.dependencies,capture:async()=>oversized}),
      (e:any)=>e.code==='PACKET_PDF_BUNDLE_UNSUPPORTED');assert.equal(f.state.reads,0);
    save('denials.json',{scope:'SQL/source/storage and oversized-receipt controls',revokedAfterReadDenied:true,
      artifactOverrunDenied:true,declaredOversizeBeforeReadDenied:true,writes:0});
  });
}));

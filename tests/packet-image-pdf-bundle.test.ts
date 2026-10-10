import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import type {Pool,PoolClient} from 'pg';
import {PacketImagePdfBundleManifestSchema,PacketPdfBundleManifestSchema,UspAnyPacketPdfBundleManifestSchema,
  PACKET_PDF_BUNDLE_LIMITS} from '../packages/contracts/src/usp/packet-pdf-bundle';
import {UspImagePdfPacketPlanSchema,UspImagePdfPacketPlanExecutionSchema,PACKET_IMAGE_PDF_LIMITS}
  from '../packages/contracts/src/usp/packet-image-pdf';
import {UspSnapshotManifestSchema} from '../packages/contracts/src/usp';
import {readPacketPdfBundle,type PdfBundleDependencies} from '../packages/server/src/modules/usp/packets/pdf-bundle';
import {capturePacketPdfTx,readPacketPdf,pdfPacketStorage} from '../packages/server/src/modules/usp/packets/pdf-service';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {transaction} from '../packages/server/src/infrastructure/db';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {canonical,fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// Saved accepted image PDF/plan/confirmation/receipt and committed citation;
// reconstructed source/target/snapshot/access/SQL/storage controls. No original,
// crop, renderer, model or publication I/O; no authentic property applicability.
const root='E:/BhuAayam-data/task-data/desktop-packet-image-pdf-20261003',
  citationRoot='E:/BhuAayam-data/task-data/desktop-reviewed-image-regions-20261003';
function fixture(){
  const completion=readFileSync(root+'/completion-f8825090.json'),journeyBytes=readFileSync(root+'/journey.json'),
    citationBytes=readFileSync(citationRoot+'/png-journey.json');
  assert.equal(sha256(completion),'0e63ec81d27e21256c4fe1b708232aca26b5d956ddb6d7c12ec3d6c9df53dc8e');
  assert.equal(sha256(journeyBytes),'55806456e9a0cf18345c19aec956b0880a58a6fcec218ffc566cc24216878538');
  assert.equal(sha256(citationBytes),'cc2f496aeafe5e45319b6731022ec244c7df74798c5be02cff80b51c26eb77af');
  const saved=JSON.parse(journeyBytes.toString('utf8')),citationJourney=JSON.parse(citationBytes.toString('utf8')),
    plan=UspImagePdfPacketPlanSchema.parse(saved.plan),execution=UspImagePdfPacketPlanExecutionSchema.parse(saved.execution),
    receipt=execution.packet,binding=plan.entries[0].binding!,d=binding.document,pdf=readFileSync(root+'/packet.pdf'),
    ctx=localRequestContext('private-image-pdf-bundle-control');
  assert.deepEqual(ctx.principal,plan.creator);assert.equal(pdf.length,60397);
  assert.equal(sha256(pdf),'1893b7bb2bf26b3ebe54b99fbdfd432dd5d1878901bb8a9744043a1ad4f2eb39');
  assert.equal(sha256(pdf),receipt.assembly.output.sha256);assert.equal(pdf.length,receipt.assembly.output.bytes);
  assert.deepEqual(binding,citationJourney.privateHistoricalEvidence.citations[0].pin);
  const body=citationJourney.storedHistory,{documentCitations:_,...oldBody}=body,
    record={id:receipt.target.ref.id,site_id:receipt.scope.scopeId,kind:'building',revision:2,identifier:'technical-reference',body},
    captured={...record,project_code:null,project_status:null,project_location:null,projectIdentity:null,historicalAliases:[]};
  assert.equal(fingerprint(oldBody),binding.target.bodySha256);assert.equal(fingerprint(captured),plan.targetBodySha256);
  const sourceBinding=ingestionBinding(d.caseId),source={id:d.sourceId,case_id:d.caseId,family_id:d.sourceId,revision:d.sourceRevision,
    sha256:d.sourceSha256,bytes:d.sourceBytes,object_key:'technical-retained-image',name:'Technical image envelope',
    mime_type:'image/png',profile:'image-reference-v2',status:'needs_input',created_at:'2026-10-03T00:00:00Z',
    inspection:{status:'needs_input',documentOriginal:{version:'source-document/1',subject:sourceBinding.subject,format:'png',
      sha256:d.sourceSha256,bytes:d.sourceBytes,receivedAt:'2026-10-03T00:00:00Z'}}};
  const manifest=UspSnapshotManifestSchema.parse({schemaVersion:'usp/1',id:receipt.scope.manifestId,digest:receipt.scope.snapshotDigest,
    scope:receipt.scope,capturedAt:'2026-10-03T00:00:00Z',selection:{kind:'targets',pins:[receipt.target]},
    members:[{pin:receipt.target,bodySha256:fingerprint(captured),
      bodyRef:fingerprint([receipt.target.ref.namespace,receipt.target.ref.id,receipt.target.revision,captured]),authority:'registry'}],
    frame:{horizontal:null,vertical:null,unit:null,transform:null},accessViewId:ctx.accessViewId,policyVersion:ctx.policyVersion,
    validAt:null,asOf:null,coverage:{state:'complete',reasonCodes:[]}});
  const state={active:0,reads:0,captures:0,archived:false,revokeAfterRead:false,overrun:false,deadlines:[] as number[],queries:[] as string[]};
  const query=async(raw:string,args:any[]=[])=>{
    const sql=raw.replace(/\s+/g,' ').trim();state.queries.push(sql);let rows:any[]=[];
    assert(!/^(INSERT|UPDATE|DELETE)\b/.test(sql),'Bundle reads must not write packet/job/receipt state');
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.includes('pg_advisory_xact_lock'))rows=[];
    else if(sql.startsWith('SELECT set_config'))rows=[{deadline_live:true}];
    else if(sql.includes('FROM cases'))rows=args[0]===d.caseId?[{id:d.caseId,site_id:record.site_id,
      revision:d.caseRevision,archived:state.archived,context:null,frame:null}]:[];
    else if(sql.includes('SELECT max(revision)'))rows=[{revision:d.sourceRevision}];
    else if(sql.includes('FROM sources'))rows=args[sql.includes('WHERE case_id=')?1:0]===d.sourceId?[source]:[];
    else if(sql.includes('FROM usp_snapshots'))rows=[{body:manifest}];
    else if(sql.includes('FROM usp_snapshot_bodies'))rows=[{body:captured,body_sha256:fingerprint(captured)}];
    else if(sql.includes('FROM registry_revisions'))rows=[{body:args[1]===receipt.target.revision?record.body:oldBody}];
    else if(sql.includes('FROM registry_records'))rows=[{...record,project_status:null}];
    else if(sql.includes('FROM registry_sites'))rows=[{id:record.site_id}];
    else if(sql.includes('FROM usp_packet_plans'))rows=[{body:plan}];
    else if(sql.includes('FROM usp_packet_plan_confirmations'))rows=[{body:saved.confirmation}];
    else if(sql.includes('FROM usp_packet_plan_executions'))rows=[{body:execution}];
    else if(sql.includes('FROM usp_packets'))rows=[{body:receipt,artifact_hash:receipt.artifact.sha256,
      object_key:`usp/packets/${receipt.packetId}/${receipt.artifact.sha256}`}];
    else assert.fail('Unexpected image bundle control SQL '+sql);
    return {rows:structuredClone(rows),rowCount:rows.length};
  };
  const pool={connect:async()=>{state.active++;return {query,release:()=>{state.active--;}} as unknown as PoolClient;}} as unknown as Pool;
  const dependencies:PdfBundleDependencies={capture:(ctx,id,deadline)=>{state.captures++;state.deadlines.push(deadline);
    return transaction(client=>capturePacketPdfTx(client,ctx,id),{deadlineAt:deadline});},
    read:async(key,bytes,hash,deadline)=>{assert.equal(state.active,0,'Artifact I/O under authority locks');state.reads++;
      assert.equal(key,`usp/packets/${receipt.packetId}/${receipt.artifact.sha256}`);assert.equal(bytes,pdf.length);assert.equal(hash,sha256(pdf));
      if(deadline)state.deadlines.push(deadline);if(state.revokeAfterRead)state.archived=true;
      return state.overrun?Buffer.concat([pdf,Buffer.from([0])]):pdf;}};
  return {pool,ctx,plan,receipt,binding,pdf,dependencies,state};
}
async function control(work:(f:ReturnType<typeof fixture>)=>Promise<void>){
  const globals=globalThis as unknown as {ulpinPool?:Pool},prior=globals.ulpinPool,subject=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='registry-image-region-technical-control';
  try{const f=fixture();globals.ulpinPool=f.pool;try{await work(f);}finally{assert.equal(f.state.active,0);}}
  finally{globals.ulpinPool=prior;if(subject===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;}
}
function save(name:string,value:Uint8Array|object){const dir=process.env.ULPIN_PACKET_IMAGE_BUNDLE_PROOF_DIR;if(!dir)return;
  mkdirSync(dir,{recursive:true});writeFileSync(dir+'/'+name,value instanceof Uint8Array?value:JSON.stringify(value,null,2)+'\n',{flag:'wx'});}

test('accepted image PDF becomes deterministic private two-file bundle with exact typed image provenance',()=>control(async f=>{
  const result=await readPacketPdfBundle(f.ctx,f.receipt.packetId,f.dependencies),entries=unzipSync(result.bytes),
    manifest=PacketImagePdfBundleManifestSchema.parse(JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8'))),entry=manifest.entries[0];
  assert.deepEqual(Object.keys(entries),['packet.pdf','manifest.json']);assert.deepEqual(Buffer.from(entries['packet.pdf']),f.pdf);
  assert.deepEqual(manifest,result.manifest);assert.deepEqual(UspAnyPacketPdfBundleManifestSchema.parse(manifest),manifest);
  assert.equal(PacketPdfBundleManifestSchema.safeParse(manifest).success,false);
  assert.equal(manifest.packet.plan.sha256,f.plan.planSha256);assert.equal(manifest.packet.receiptSha256,fingerprint(f.receipt));
  assert.equal(manifest.packet.targetBodySha256,f.plan.targetBodySha256);assert.equal(entry.bindingId,f.binding.id);
  assert.equal(entry.entrySha256,f.plan.entries[0].entrySha256);assert.equal(entry.applicabilitySha256,f.plan.entries[0].applicabilitySha256);
  assert.deepEqual(entry.derivative,f.binding.validation);assert.deepEqual(entry.derivative.selection,f.binding.region);
  assert.deepEqual(entry.source,{sha256:f.binding.document.sourceSha256,revision:f.binding.document.sourceRevision,bytes:f.binding.document.sourceBytes});
  assert.equal(entry.calibration,null);assert.equal(entry.qualification,'not_assessed');assert.equal(entry.associationState,'operator_selected');
  assert.equal(manifest.qualification.documentRole,'generated_compilation');assert.equal(manifest.qualification.propertyMatching,'not_assessed');
  assert(result.manifestBytes.length<=PACKET_PDF_BUNDLE_LIMITS.manifestBytes);assert(result.bytes.length<=PACKET_PDF_BUNDLE_LIMITS.archiveBytes);
  const archive=Buffer.from(result.bytes);assert.equal(archive.readUInt16LE(8),0);assert.equal(archive.readUInt16LE(10),0);assert.equal(archive.readUInt16LE(12),33);
  assert.equal(f.state.reads,1);assert.equal(f.state.captures,2);assert.equal(new Set(f.state.deadlines).size,1);
  assert(f.state.deadlines[0]<=Date.now()+30000);
  const text=Buffer.from(entries['manifest.json']).toString('utf8');
  for(const secret of ['object_key','authoritySha256','accessSha256','subject','creator','reviewer','entitlementVersion','targetLabel',
    'technical-retained-image','usp/packets/','exifData','jobId','fence','renderer'])assert(!text.includes(secret),secret);
  const repeat=await readPacketPdfBundle(f.ctx,f.receipt.packetId,f.dependencies);assert.deepEqual(repeat.bytes,result.bytes);
  const download=await readPacketPdf(f.ctx,f.receipt.packetId,{...pdfPacketStorage,read:f.dependencies.read});
  assert.deepEqual(download.bytes,f.pdf);assert.deepEqual(download.receipt,f.receipt);
  save('image.bundle.zip',result.bytes);save('image.manifest.json',result.manifestBytes);
  save('image.journey.json',{classification:'saved accepted image PDF and receipt; controlled source/target/snapshot/access/SQL/storage authority',
    inputRoot:root,packetId:f.receipt.packetId,pdfBytes:f.pdf.length,pdfSha256:sha256(f.pdf),zipBytes:result.bytes.length,zipSha256:result.sha256,
    manifestBytes:result.manifestBytes.length,manifestSha256:result.manifestSha256,captures:2,artifactReads:1,archiveFiles:Object.keys(entries),
    deterministic:true,oldPdfReaderCompatible:true,physicalCalibration:null,applicabilityAndSourcePermissions:'unqualified'});
}));

// These controls protect private disclosure and the distinct image size ceiling.
test('late source revocation and image receipt/artifact overruns deny bundle disclosure without writes',async()=>{
  await control(async f=>{f.state.revokeAfterRead=true;
    await assert.rejects(()=>readPacketPdfBundle(f.ctx,f.receipt.packetId,f.dependencies),(e:any)=>e.status===403);
    assert.equal(f.state.reads,1);assert.equal(f.state.captures,2);});
  await control(async f=>{f.state.overrun=true;
    await assert.rejects(()=>readPacketPdfBundle(f.ctx,f.receipt.packetId,f.dependencies),(e:any)=>e.code==='PACKET_PDF_ARTIFACT_INTEGRITY');
    assert.equal(f.state.reads,1);assert.equal(f.state.captures,1);});
  await control(async f=>{
    const captured=await f.dependencies.capture(f.ctx,f.receipt.packetId,Date.now()+30000),oversized=structuredClone(captured);
    oversized.receipt.assembly.output.bytes=PACKET_IMAGE_PDF_LIMITS.bytes+1;
    await assert.rejects(()=>readPacketPdfBundle(f.ctx,f.receipt.packetId,{...f.dependencies,capture:async()=>oversized}),
      (e:any)=>e.code==='PACKET_PDF_BUNDLE_UNSUPPORTED');assert.equal(f.state.reads,0);
    save('image.denials.json',{classification:'source revocation and artifact/receipt bound controls',revokedAfterReadDenied:true,
      artifactOverrunDenied:true,declaredImageOversizeBeforeReadDenied:true,writes:0});
  });
});

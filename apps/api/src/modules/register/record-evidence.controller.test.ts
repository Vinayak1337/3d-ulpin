import 'reflect-metadata';
import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {Readable} from 'node:stream';
import type {PoolClient} from 'pg';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';
import {HEADERS_METADATA,GUARDS_METADATA} from '@nestjs/common/constants';
import {RegistryRecordEvidenceController} from './record-evidence.controller';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
import {RegistryRecordEvidenceService,readRegistryRecordEvidenceTx} from '@ulpin/server/modules/registry/registry-record-evidence';
import {RegistryRecordEvidenceSchema} from '../../../../../packages/contracts/src/registry-record-evidence';
import {DocumentResultSchema} from '../../../../../packages/contracts/src/usp';
import {GltfOriginalSchema,GltfResultSchema} from '../../../../../packages/contracts/src/usp/gltf-ingestion';
import {readObjectBounded,sha256,closeStorageClient} from '@ulpin/server/infrastructure/storage';
import {settings} from '@ulpin/server/infrastructure/config';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {gltfInput,gltfArtifactKey,gltfResultKey} from '@ulpin/server/modules/usp/ingestion/gltf';
import {gltfSummary} from '@ulpin/server/modules/usp/ingestion/gltf-processor';
import {documentResultKey,readDocumentResult} from '@ulpin/server/modules/usp/ingestion/documents';
import {ingestionBinding} from '@ulpin/server/modules/usp/ingestion/events';
import {readFusionResult,readFusionObject,type FusionBudget} from '@ulpin/server/modules/usp/ingestion/source-fusion-authority';
import {fingerprint} from '@ulpin/server/modules/cases/domain';
import type {RegistryDocumentDependencies} from '@ulpin/server/modules/registry/registry-document-evidence';

// Reuse GLTF-REFERENCE's accepted recordedBody and unchanged real original/native/document bytes.
// Target/site/footprint, source/job/attempt SQL, storage and tool inventory remain explicitly controlled,
// not live operational records, current installed-tool admission or genuine property correspondence.
// This prevents history substitution and partial disclosure after a concrete access/target change.
const serverRequire=createRequire(new URL('../../../../../packages/server/package.json',import.meta.url)),
  {S3Client}=serverRequire('@aws-sdk/client-s3'),id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,
  root='E:/BhuAayam-data/task-data/gltf-api-20261004-run01',
  priorRoot='E:/BhuAayam-data/task-data/gltf-reference-link-20261004-run01',
  originals='E:/BhuAayam-data/task-data/desktop-gltf-native/originals',
  documentPath='E:/BhuAayam-data/task-data/desktop-reference-document-enrollment/epsg7415-accepted-result.json';
const receipts:any[]=[];
before(()=>{
  test.mock.getter(settings,'s3Endpoint',()=> 'http://127.0.0.1:1');
  test.mock.getter(settings,'s3AccessKey',()=> 'unconnected-control');
  test.mock.getter(settings,'s3SecretKey',()=> 'unconnected-control');
});
after(()=>{closeStorageClient();test.mock.restoreAll();});
const save=(name:string,value:unknown)=>{if(process.env.ULPIN_RECORD_EVIDENCE_PROOF_DIR)
  writeFileSync(process.env.ULPIN_RECORD_EVIDENCE_PROOF_DIR+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});};
async function local(work:()=>Promise<void>){const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='registry-gltf-protocol';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}}
function fixture(name:'Box.glb'|'Box.gltf'){
  const savedRead=JSON.parse(readFileSync(priorRoot+'/'+name+'.controlled-journey.json','utf8')),
    raw=readFileSync(originals+'/'+name),artifact=readFileSync(root+'/'+name+'.native.json'),
    saved=GltfResultSchema.parse(JSON.parse(readFileSync(root+'/'+name+'.journey.json','utf8')).accepted),
    siteId=id(10),caseId=id(1),sourceId=id(2),jobId=id(3),binding=ingestionBinding(caseId),
    current={id:caseId,revision:1,archived:false,frame:null,context:null,site_id:siteId},
    original=GltfOriginalSchema.parse({version:'gltf-native/1',subject:binding.subject,accessSha256:binding.access,sha256:sha256(raw),bytes:raw.length,
      receivedAt:'2026-10-03T00:00:00Z',lineageState:'caller_declared',lineage:{issuer:null,originalUrl:null,acquiredAt:null,permissionReference:null,
        geography:null,limitations:['memory protocol authority; unchanged retained test_only bytes']}}),
    source={id:sourceId,case_id:caseId,family_id:sourceId,revision:1,profile:'gltf-native-v1',status:'received',sha256:sha256(raw),bytes:raw.length,
      object_key:`sources/${sourceId}/${sha256(raw)}`,inspection:{gltfOriginal:original}},
    input=gltfInput({current,source,binding,latest:true,context:fingerprint({frame:null,context:null,siteId})} as any,jobId,
      {...saved.input.tools!,readerSha256:saved.input.readerSha256}),
    result=GltfResultSchema.parse({...saved,input,summary:gltfSummary(artifact,input),
      artifact:{...saved.artifact,key:gltfArtifactKey(jobId,sha256(artifact))},createdAt:'2026-10-03T00:00:00Z'}),
    resultBytes=Buffer.from(JSON.stringify(result)),documentBytes=readFileSync(documentPath),
    document=DocumentResultSchema.parse(JSON.parse(documentBytes.toString('utf8'))),
    body=structuredClone(savedRead.recordedBody),{documentCitations:_,...base}=body,
    state={row:{id:id(11),site_id:siteId,identifier:'controlled-existing-record',kind:body.kind,revision:2,body,footprint:JSON.stringify(body.footprint)},
      site:{id:siteId,identifier:'protocol-site',name:'protocol-site',revision:2,
        frame:{id:'protocol-frame',horizontalUnit:'m',verticalUnit:'m',benchmark:'protocol-only'},synthetic:true},
      history:new Map([[1,{body:base,site_revision:1}],[2,{body:structuredClone(body),site_revision:2}]]),
      calls:[] as string[],reads:0,toolChecks:0,revoke:false,change:false},
    job={id:jobId,operation:'gltf-native',case_id:caseId,source_id:sourceId,case_revision:1,payload:input,
      input_fingerprint:fingerprint(input),input_sha256:fingerprint(input),status:'succeeded',logical_state:'succeeded',
      result_ref:{assetId:`gltf:${jobId}:${resultBytes.length}`,version:1,sha256:sha256(resultBytes)},accepted_fence:1,
      attempt_state:'accepted',attempt_fence:1,attempt_input_sha256:fingerprint(input),completion_sha256:sha256(resultBytes)};
  assert.equal(sha256(raw),savedRead.sourceSha256);assert.equal(sha256(artifact),savedRead.artifactSha256);
  assert.equal(sha256(resultBytes),body.documentCitations[1].document.resultSha256);
  assert.equal(sha256(documentBytes),body.documentCitations[0].document.resultSha256);
  assert.equal(fingerprint(base),body.documentCitations[0].target.bodySha256);
  const client={query:async(sql:string,args:any[]=[])=>{
    state.calls.push(sql);assert(sql.startsWith('SELECT'),'Read leaf must never write');let rows:any[]=[];
    if(sql.includes('END selected_body')){
      const h=state.history.get(args[1]);
      if(h){const {body:__,...record}=state.row;rows=[{record,history:{record_id:state.row.id,revision:args[1],site_revision:h.site_revision},
        site:state.site,body:state.row.body,selected_body:h.body,project_status:null}];}
    }else if(sql.includes('pg_advisory_xact_lock')||sql.startsWith('SELECT id FROM cases')||sql.startsWith('SELECT id FROM sources'))rows=[];
    else if(sql.includes('FROM registry_sites'))rows=[state.site];
    else if(sql.includes('CASE WHEN r.revision'))rows=[{site_id:siteId,kind:state.row.kind,body:args[1]===state.row.revision?state.row.body:state.history.get(args[1])?.body}];
    else if(sql.includes('FROM registry_records'))rows=[state.row];
    else if(sql.includes('SELECT id,revision,archived,frame,context,site_id FROM cases'))rows=[current];
    else if(sql.includes('FROM sources'))rows=[source];
    else if(sql.includes('SELECT max(revision)'))rows=[{revision:1}];
    else if(sql.includes('SELECT j.*,m.result_ref'))rows=[job];
    else if(sql.includes('SELECT accepted_fence'))rows=[{accepted_fence:1}];
    else assert.fail('Unexpected controlled SQL: '+sql);
    return {rows:structuredClone(rows),rowCount:rows.length};
  }} as PoolClient,
    objects=new Map([[gltfResultKey(jobId,sha256(resultBytes)),resultBytes],[result.artifact.key,artifact],
      [documentResultKey(document.input.jobId,sha256(documentBytes)),documentBytes]]);
  const dependencies:RegistryDocumentDependencies={source:async(_client,_ctx,pin)=>{
    assert.equal(pin.sourceId,document.input.sourceId);if(current.archived)throw new AppError(403,'CONTROL_REVOKED','Controlled private access revoked.');return document.input;
  },result:readDocumentResult,registrySource:async(_client,_site,sourceId)=>{
    if(current.archived)throw new AppError(403,'CONTROL_REVOKED','Controlled private access revoked.');
    return sourceId===document.input.sourceId?({revision:document.input.sourceRevision,sha256:document.input.sourceSha256,
      accessSha256:document.input.accessSha256}) as any:({revision:1,sha256:'a'.repeat(64),accessSha256:'a'.repeat(64)}) as any;
  },gltfTools:()=>{state.toolChecks++;},fusionResult:async(selection,authority,budget)=>{
    state.reads++;
    return readFusionResult(selection,authority,budget,(key,size,hash,bounds)=>readFusionObject(key,size,hash,bounds,async()=>{
      const bytes=objects.get(key);assert(bytes);
      if(key===result.artifact.key){if(state.revoke)current.archived=true;if(state.change)state.row.body.name='changed controlled target';}
      return {body:Readable.from([bytes]),etag:'controlled'};
    }));
  }};
  return {state,client,dependencies,objects,documentBytes,body,artifact,result,current};
}

test('exact committed native plus complete/partial mesh, historical revision and empty eligible record',()=>local(async()=>{
  for(const name of ['Box.glb','Box.gltf'] as const){
    const f=fixture(name),mock=test.mock.method(S3Client.prototype,'send',async(command:any)=>{
      const bytes=f.objects.get(command.input.Key);assert(bytes);return {Body:Readable.from([bytes]),ContentLength:bytes.length};
    });
    try{
      const budget:FusionBudget={deadlineAt:Date.now()+30_000,signal:new AbortController().signal,reservedBytes:0},
        response=await readRegistryRecordEvidenceTx(f.client,{recordId:id(11),revision:2},f.dependencies,budget);
      assert(RegistryRecordEvidenceSchema.safeParse(response).success);assert.equal(response.citations.length,3);
      assert.equal(response.snapshotState,'current');assert.equal(response.recordBodySha256,fingerprint(f.body));
      assert.equal(response.siteRevision,2);assert.equal(response.currentSiteRevision,2);
      assert.deepEqual(response.citations[0].pin,f.body.documentCitations[0]);
      const mesh=response.citations[2];assert('fragment' in mesh&&mesh.fragment.kind==='gltf');
      assert.equal(mesh.fragment.nodes[0].index,1);assert(mesh.pin.version==='registry-gltf-node-citation/1');
      assert.equal(mesh.pin.gltf.placement,'unknown');
      assert.equal(mesh.fragment.summary.status,name==='Box.glb'?'inspected_local':'inspected_partial');
      if(name==='Box.gltf')assert.equal(mesh.fragment.buffers[0].record.fetched,false);
      assert.equal(budget.reservedBytes,4*1024*1024+f.objects.get(gltfResultKey(id(3),f.body.documentCitations[1].document.resultSha256))!.length+f.artifact.length);
      const later={...structuredClone(f.body),name:'later controlled revision',documentCitations:[]};
      f.state.row.revision=3;f.state.row.body=later;f.state.site.revision=3;f.state.history.set(3,{body:structuredClone(later),site_revision:3});
      const historical=await readRegistryRecordEvidenceTx(f.client,{recordId:id(11),revision:2},f.dependencies);
      assert.equal(historical.snapshotState,'historical');assert.equal(historical.currentRecordRevision,3);
      assert.equal(historical.currentSiteRevision,3);assert.equal(historical.siteRevision,2);
      assert.deepEqual(historical.citations,response.citations);assert.equal(historical.recordBodySha256,response.recordBodySha256);
      const reads=f.state.reads,empty=await readRegistryRecordEvidenceTx(f.client,{recordId:id(11),revision:3},f.dependencies);
      assert.deepEqual(empty.citations,[]);assert.equal(f.state.reads,reads);
      const gate=f.state.calls.findIndex(sql=>sql.includes('pg_advisory_xact_lock')),
        destination=f.state.calls.findIndex(sql=>sql.includes('registry_sites WHERE id=$1 FOR SHARE'));
      assert(gate>=0&&gate<destination);assert(f.state.toolChecks>0);
      receipts.push({name,sourceSha256:sha256(readFileSync(originals+'/'+name)),artifactSha256:sha256(f.artifact),
        documentSha256:sha256(f.documentBytes),current:response,historical,empty,reservedBytes:budget.reservedBytes,
        responseBytes:Buffer.byteLength(JSON.stringify(response)),writes:0,nativeRuns:0,liveToolAdmission:false});
    }finally{mock.mock.restore();}
  }
  save('journeys.json',receipts);
}));

test('revoked evidence and changed complete record refuse whole read; unsupported target and missing history avoid object reads',()=>local(async()=>{
  for(const mode of ['revoke','change'] as const){
    const f=fixture('Box.glb');f.state[mode]=true;
    const mock=test.mock.method(S3Client.prototype,'send',async(command:any)=>{
      const bytes=f.objects.get(command.input.Key);assert(bytes);return {Body:Readable.from([bytes]),ContentLength:bytes.length};
    });
    try{await assert.rejects(()=>readRegistryRecordEvidenceTx(f.client,{recordId:id(11),revision:2},f.dependencies),
      (error:any)=>error.status===(mode==='revoke'?403:409));}finally{mock.mock.restore();}
    assert(f.state.calls.every(sql=>sql.startsWith('SELECT')));
  }
  const f=fixture('Box.glb');f.state.row.kind='parcel';
  await assert.rejects(()=>readRegistryRecordEvidenceTx(f.client,{recordId:id(11),revision:2},f.dependencies),(e:any)=>e.status===422);
  assert.equal(f.state.reads,0);f.state.row.kind='building';f.state.history.delete(2);
  await assert.rejects(()=>readRegistryRecordEvidenceTx(f.client,{recordId:id(11),revision:2},f.dependencies),(e:any)=>e.status===404);
  assert.equal(f.state.reads,0);
  save('refusals.json',{revokedSource:403,changedBodyWithoutRevision:409,unsupportedTarget:422,missingExactHistory:404,writes:0,partialDisclosures:0});
}));

test('unknown-length derivative bounds, cancellation and cleanup before native parsing',async()=>{
  let opened=0,body:Readable|undefined,mode:'oversize'|'actual'|'unicode'|'short'|'cancel'='oversize';
  const controller=new AbortController(),mock=test.mock.method(S3Client.prototype,'send',async()=>{
    opened++;body=mode==='cancel'?new Readable({read(){}}):Readable.from([mode==='unicode'?'ééé':Buffer.alloc(mode==='actual'?9:2)]);
    if(mode==='cancel')setImmediate(()=>controller.abort());
    return {Body:body,ContentLength:mode==='oversize'?9:mode==='cancel'?2:4};
  });
  try{
    await assert.rejects(()=>readObjectBounded('bounded',8,Date.now()+1000,controller.signal),(e:any)=>e.code==='SOURCE_INTEGRITY');assert(body?.destroyed);
    mode='actual';await assert.rejects(()=>readObjectBounded('bounded',8,Date.now()+1000,controller.signal),(e:any)=>e.code==='SOURCE_INTEGRITY');assert(body?.destroyed);
    mode='unicode';await assert.rejects(()=>readObjectBounded('bounded',8,Date.now()+1000,controller.signal),(e:any)=>e.code==='SOURCE_INTEGRITY');assert(body?.destroyed);
    mode='short';await assert.rejects(()=>readObjectBounded('bounded',8,Date.now()+1000,controller.signal),(e:any)=>e.code==='SOURCE_INTEGRITY');assert(body?.destroyed);
    mode='cancel';await assert.rejects(()=>readObjectBounded('bounded',8,Date.now()+1000,controller.signal),(e:any)=>e.code==='STORAGE_TIMEOUT');assert(body?.destroyed);
    const before=opened;await assert.rejects(()=>readObjectBounded('bounded',8,Date.now()+1000,controller.signal));
    await assert.rejects(()=>readObjectBounded('bounded',8,Date.now()-1,new AbortController().signal));
    await assert.rejects(()=>readObjectBounded('large-originals/control',8,Date.now()+1000,new AbortController().signal),(e:any)=>e.status===413);
    assert.equal(opened,before);
    save('bounds.json',{oversizeMetadataRefused:true,streamOverrunRefused:true,shortStreamRefused:true,cancellationDestroysBody:true,
      expiredAndCancelledAvoidIo:true,largeOriginalGuardPreserved:true,opened});
  }finally{mock.mock.restore();}
});

@Module({controllers:[RegistryRecordEvidenceController],providers:[{provide:RegistryRecordEvidenceService,useValue:{read:async()=>({})}}]})
class ContractModule{}
test('route metadata, strict identity/query shape and private no-store without listener',async()=>{
  const app=await NestFactory.create(ContractModule,{logger:false,abortOnError:false});
  try{
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Committed private citation control').build()),
      route=document.paths['/api/v1/registry-records/{recordId}/revisions/{revision}/document-citations']?.get;
    assert.equal(route?.operationId,'GET_api_v1_registry_records_recordId_revisions_revision_document_citations');
    const schema=(route!.responses['200'] as any).content['application/json'].schema;
    assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.citations.maxItems,25);
    assert(Reflect.getMetadata(GUARDS_METADATA,RegistryRecordEvidenceController).includes(PrivateSpatialGuard));
    assert(Reflect.getMetadata(HEADERS_METADATA,RegistryRecordEvidenceController.prototype.read)
      .some((header:any)=>header.name==='Cache-Control'&&header.value==='private, no-store'));
    let calls=0;const controller=new RegistryRecordEvidenceController({read:async(recordId:string,revision:number)=>{calls++;return {recordId,revision};}} as any),
      request={query:{},originalUrl:'/api/v1/registry-records/control'} as any;
    assert.deepEqual(await controller.read(id(11).toUpperCase(),'2',request),{recordId:id(11),revision:2});
    for(const revision of ['01','0','2147483648','1e2'])assert.throws(()=>controller.read(id(11),revision,request));
    assert.throws(()=>controller.read('alias','2',request));
    assert.throws(()=>controller.read(id(11),'2',{...request,originalUrl:request.originalUrl+'?extra=1'}));
    assert.equal(calls,1);
    // Route-only metadata already retained if an earlier evidence group failed.
    if(!process.env.ULPIN_RECORD_EVIDENCE_ROUTE_RETAINED)
      save('route.json',{operationId:route!.operationId,privateNoStore:true,strictIdentityAndQuery:true,listenerStarted:false,calls});
  }finally{await app.close();}
});

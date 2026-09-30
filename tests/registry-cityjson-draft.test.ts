import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {PoolClient} from 'pg';
import {CityJSONInputSchema,CityJSONResultSchema,CityJSONOriginalSchema} from '../packages/contracts/src/usp/cityjson-ingestion';
import {RegistryCityJSONPrepareSchema} from '../packages/contracts/src';
import {AppError} from '../packages/server/src/infrastructure/errors';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {acceptedCityJSONTx,cityjsonSourceTx,cityjsonInput} from '../packages/server/src/modules/usp/ingestion/cityjson';
import {createSourceWorkspace} from '../packages/server/src/modules/cases/source-workspaces';
import {ManualIngestionService} from '../packages/server/src/modules/usp/ingestion/service';
import {importRegistryCase} from '../packages/server/src/modules/registry/registry-seed';
import {prepareRegistryCityJSONDraftTx,readRegistryCityJSONDraftTx,removeRegistryCityJSONDraftTx,
  selectCityJSONExterior,nativePointer} from '../packages/server/src/modules/registry/cityjson-draft';
import {assertNoNativeCandidates,createRegistryDraftTx,commitRegistryReviewTx} from '../packages/server/src/modules/registry/registry';
import {publicRegistryBody,publicRegistryDraft,publicRegistryReview} from '../packages/server/src/modules/registry/registry-document-evidence';

// Memory-only technical authority controls. No operational records, accepted
// receipts, geometry qualifications or source bytes are invented/persisted.
// The technical envelope contains unchanged D1 geometry with copied native
// locator summaries; it is not a second production reader or accepted artifact.
const originalBytes=readFileSync(new URL('../fixtures/usp/D1/single-roof/original.json',import.meta.url));
const original=JSON.parse(originalBytes.toString('utf8'));
const building='NL.IMBAG.Pand.1655100000500568',part=building+'-0';
const root='/feature/CityObjects/',geometryPointer=root+part+'/geometry/2';
const footprintPointer=root+building+'/geometry/0/boundaries/0';
const selection={buildingObjectId:building,objectId:part,geometryPointer,footprintSurfacePointer:footprintPointer};
const subject='registry-cityjson-technical-control';
const status=(code:number)=>(error:any)=>error.status===code;
async function attributed(work:()=>Promise<void>){
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}
}
function envelope(){return {schemaVersion:'source-native-cityjson/1',sourceSha256:sha256(originalBytes),sourceBytes:originalBytes.length,
  sourceDocument:structuredClone(original),verticesPointer:'/feature/vertices',transformPointer:'/metadata/transform',
  frame:{referenceSystemState:'declared',referenceSystem:'https://www.opengis.net/def/crs/EPSG/0/7415'},
  objects:[{id:building,pointer:root+building,type:'Building',geometries:[{pointer:root+building+'/geometry/0',
    type:'MultiSurface',lod:'0',status:'supported',surfaces:[{pointer:footprintPointer,ringPointers:[footprintPointer+'/0']}]}]},
  {id:part,pointer:root+part,type:'BuildingPart',geometries:[{pointer:geometryPointer,type:'Solid',lod:'2.2',status:'supported',surfaces:[]}]}]};}
function fixture(artifactBytes=Buffer.from(JSON.stringify(envelope()))){
  const caseId=randomUUID(),sourceId=randomUUID(),jobId=randomUUID(),binding=ingestionBinding(caseId);
  const input=CityJSONInputSchema.parse({version:'cityjson-native/1',jobId,caseId,caseRevision:1,caseContextSha256:'a'.repeat(64),
    sourceId,sourceFamilyId:sourceId,sourceRevision:1,sourceSha256:sha256(originalBytes),sourceBytes:originalBytes.length,
    objectKey:`sources/${sourceId}/${sha256(originalBytes)}`,subject:binding.subject,accessSha256:binding.access,
    readerSha256:'b'.repeat(64),selection:'complete_bounded_source'});
  const result=CityJSONResultSchema.parse({version:'cityjson-native/1',input,createdAt:'2026-10-01T00:00:00Z',
    artifact:{key:`cityjson-native/${jobId}/${sha256(artifactBytes)}.native.json`,sha256:sha256(artifactBytes),bytes:artifactBytes.length,
      mediaType:'application/json',profile:'source-native-cityjson/1'},
    summary:{schemaVersion:'source-native-cityjson/1',status:'supported',sourceSha256:input.sourceSha256,sourceBytes:input.sourceBytes,
      objectCount:2,vertexCount:62,boundaryIndexCount:0,supportedGeometryCount:2,unsupportedGeometryCount:0,decodedBounds:null,
      transformState:'supplied',coordinateMode:'supplied_transform_only',referenceSystemState:'declared',structuralReadingOnly:true,
      globalPlacement:'not_qualified',watertightSolid:'not_qualified',interiorFloors:'not_established_by_reader',rights:'not_assessed'}});
  const request={requestKey:randomUUID(),destination:{kind:'source_site' as const},source:{caseId,caseRevision:1,sourceId,sourceRevision:1,
    sourceSha256:input.sourceSha256,jobId,resultSha256:fingerprint(result)},...selection};
  const state={sites:new Map<string,any>(),drafts:new Map<string,any>(),operations:new Map<string,any>(),reserved:[] as any[],
    queries:[] as {sql:string;args:any[]}[],reads:0,checks:0,writes:0,fence:1,denied:false,afterRead:undefined as (()=>void)|undefined,input:structuredClone(input),result:structuredClone(result)};
  const client={query:async(sql:string,args:any[]=[])=>{
    state.queries.push({sql,args});
    let rows:any[]=[];
    if(sql.includes('pg_advisory_xact_lock')){}
    else if(sql.includes('SELECT site_id,records FROM registry_drafts')){const d=state.drafts.get(args[0]);rows=d?[structuredClone(d)]:[];}
    else if(sql.includes('SELECT site_id FROM registry_drafts')){const d=state.drafts.get(args[0]);rows=d?[{site_id:d.site_id}]:[];}
    else if(sql.includes('FROM registry_sites'))rows=state.sites.has(args[0])?[structuredClone(state.sites.get(args[0]))]:[];
    else if(sql.includes('SELECT id FROM registry_drafts'))rows=[...state.drafts.values()].filter(d=>d.site_id===args[0]&&d.request_key===args[1]).map(d=>({id:d.id}));
    else if(sql.includes('SELECT * FROM registry_drafts'))rows=state.drafts.has(args[0])?[structuredClone(state.drafts.get(args[0]))]:[];
    else if(sql.includes('SELECT payload_hash,result FROM operations'))rows=state.operations.has(args[1])?[structuredClone(state.operations.get(args[1]))]:[];
    else if(sql.includes('SELECT result FROM operations')){const found=[...state.operations.values()].find(o=>o.result.intentSha256===args[1]);rows=found?[structuredClone(found)]:[];}
    else if(sql.startsWith('UPDATE registry_drafts SET records')){const d=state.drafts.get(args[0]);d.records=JSON.parse(args[1]);
      if(sql.includes('revision=revision+1'))d.revision++;state.writes++;}
    else if(sql.startsWith('INSERT INTO operations'))state.operations.set(args[1],{payload_hash:args[2],result:structuredClone(args[3])});
    else throw new Error('Unexpected technical SQL: '+sql);
    return {rows,rowCount:rows.length};
  }} as unknown as PoolClient;
  const dependencies={accepted:async()=>{
    state.checks++;if(state.denied)throw new AppError(403,'CITYJSON_DENIED','Technical revoked authority.');
    return {input:structuredClone(state.input),job:{accepted_fence:state.fence,result_ref:{sha256:request.source.resultSha256}}} as any;
  },result:async()=>{state.reads++;return structuredClone(state.result);},artifact:async()=>{state.reads++;state.afterRead?.();return artifactBytes;},
  createSite:async(_client:any,name:any,frame:any,synthetic:any)=>{const site={id:randomUUID(),identifier:'technical-reservation',name,frame,synthetic,revision:0};state.sites.set(site.id,site);return site;},
  createDraft:async(_client:any,siteId:any,_recordId:any,body:any,key:any)=>{
    const record={...body,id:randomUUID(),siteId,identifier:'technical-reservation:B001',revision:0};state.reserved.push(structuredClone(record));
    const d={id:randomUUID(),site_id:siteId,case_id:randomUUID(),revision:1,status:'draft',records:[record],request_key:key};state.drafts.set(d.id,d);
    return {id:d.id,siteId,caseId:d.case_id,revision:1,status:'draft',records:[record],createdAt:'2026-10-01T00:00:00Z'} as any;
  }};
  return {state,client,dependencies,request,input,result,artifactBytes};
}

test('unchanged D1 encoded vertices, transform, slanted solid, semantics and parent context survive exact selection',()=>attributed(async()=>{
  const f=fixture(),selected=selectCityJSONExterior(f.artifactBytes,f.input,f.result,selection);
  assert.equal(sha256(originalBytes),'5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2');
  assert.deepEqual(selected.native.geometry,original.feature.CityObjects[part].geometry[2]);
  assert.deepEqual(selected.native.object,original.feature.CityObjects[part]);
  assert.deepEqual(selected.native.building,original.feature.CityObjects[building]);
  assert.deepEqual(selected.native.encodedVertices,original.feature.vertices);
  assert.deepEqual(selected.native.transform,original.metadata.transform);
  assert.equal(selected.footprint.length,8);assert.equal(selected.footprint[0][0],original.feature.vertices[0][0]*0.001+original.metadata.transform.translate[0]);
}));
test('retained accepted D1 artifact is preserved (explicit external artifact pin)',{skip:!process.env.ULPIN_CITYJSON_DRAFT_ARTIFACT},()=>attributed(async()=>{
  const bytes=readFileSync(process.env.ULPIN_CITYJSON_DRAFT_ARTIFACT!),f=fixture(bytes);
  assert.equal(bytes.length,33168);assert.equal(sha256(bytes),'634685e1901b7e247878212262e45bf860942b1863490d7b8b67bda0b210022e');
  const selected=selectCityJSONExterior(bytes,f.input,f.result,selection);
  assert.deepEqual(selected.native.geometry,original.feature.CityObjects[part].geometry[2]);
  assert.deepEqual(selected.native.encodedVertices,original.feature.vertices);
}));
test('same-client accepted authority locks source/job/attempt and rejects stale family/context, tampered pins and revoked source',()=>attributed(async()=>{
  const f=fixture(),current={id:f.input.caseId,revision:1,archived:false,frame:null,context:null,site_id:null};
  const binding=ingestionBinding(current.id),source={id:f.input.sourceId,case_id:current.id,family_id:f.input.sourceId,revision:1,
    profile:'cityjson-native-v1',sha256:f.input.sourceSha256,bytes:originalBytes.length,object_key:f.input.objectKey,
    inspection:{cityjsonOriginal:CityJSONOriginalSchema.parse({version:'cityjson-native/1',subject:binding.subject,accessSha256:binding.access,
      sha256:f.input.sourceSha256,bytes:originalBytes.length,receivedAt:'2026-10-01T00:00:00Z',lineageState:'caller_declared',
      lineage:{issuer:null,originalUrl:null,acquiredAt:null,permissionReference:null,geography:null,limitations:[]}})}};
  const queries:string[]=[];let latest=1,job:any,attempt:any;
  const client={query:async(sql:string)=>{queries.push(sql);return {rows:sql.includes('FROM cases')?[current]:
    sql.includes('max(revision)')?[{revision:latest}]:sql.includes('FROM sources')?[source]:
    sql.includes('FROM jobs j')?[job]:sql.includes('FROM usp_job_attempts')?[attempt]:[]};}} as unknown as PoolClient;
  const input=cityjsonInput(await cityjsonSourceTx(client,current.id,source.id),f.input.jobId,'complete_bounded_source'),digest=fingerprint(input);
  job={id:input.jobId,operation:'cityjson-native',case_id:current.id,source_id:source.id,case_revision:1,payload:input,
    input_fingerprint:digest,input_sha256:digest,status:'succeeded',logical_state:'succeeded',accepted_fence:1,
    result_ref:{assetId:`cityjson:${input.jobId}`,version:1,sha256:f.request.source.resultSha256},
    attempt_state:'accepted',attempt_fence:1,attempt_input_sha256:digest,completion_sha256:f.request.source.resultSha256};
  attempt={state:'accepted',input_sha256:digest,completion_sha256:f.request.source.resultSha256};
  assert.deepEqual((await acceptedCityJSONTx(client,f.request.source,true)).input,input);
  assert(queries.some(sql=>sql.includes('FOR SHARE OF j,m')));assert(queries.some(sql=>sql.includes('FROM usp_job_attempts')&&sql.includes('FOR SHARE')));
  await assert.rejects(()=>acceptedCityJSONTx(client,{...f.request.source,resultSha256:'c'.repeat(64)},true),status(409));
  latest=2;await assert.rejects(()=>acceptedCityJSONTx(client,f.request.source,true),status(409));latest=1;
  current.revision++;await assert.rejects(()=>acceptedCityJSONTx(client,f.request.source,true),status(409));current.revision--;
  attempt.state='failed';await assert.rejects(()=>acceptedCityJSONTx(client,f.request.source,true),status(409));attempt.state='accepted';
  job.payload={...input,sourceBytes:input.sourceBytes+1};await assert.rejects(()=>acceptedCityJSONTx(client,f.request.source,true),status(422));job.payload=input;
  current.archived=true;await assert.rejects(()=>acceptedCityJSONTx(client,f.request.source,true),status(403));
}));
test('canonical preparation creates a separate site, reserves no public geometry, reuses same intent and rejects drift',()=>attributed(async()=>{
  const f=fixture(),sourceBefore=fingerprint(f.input),receipt=await prepareRegistryCityJSONDraftTx(f.client,f.request,f.dependencies);
  assert.equal(f.state.sites.size,1);assert.equal(f.state.drafts.size,1);assert.equal(f.state.writes,1);
  assert.deepEqual(f.state.reserved[0].footprint,[]);assert.equal(fingerprint(f.input),sourceBefore);
  const read=await readRegistryCityJSONDraftTx(f.client,receipt.draftId,f.dependencies);
  assert.equal(read.candidate.state,'unrecorded');assert.equal(read.candidate.reference.qualification,'not_assessed');
  assert.equal(read.candidate.representation.geometry.profile,'asset');assert.deepEqual(read.native.geometry,original.feature.CityObjects[part].geometry[2]);
  assert.deepEqual(await prepareRegistryCityJSONDraftTx(f.client,f.request,f.dependencies),receipt);
  assert.deepEqual(await prepareRegistryCityJSONDraftTx(f.client,{...f.request,requestKey:randomUUID()},f.dependencies),receipt);
  assert.equal(f.state.writes,1);assert.equal(f.state.drafts.size,1);
  await assert.rejects(()=>prepareRegistryCityJSONDraftTx(f.client,{...f.request,objectId:building},f.dependencies),status(409));
  f.state.fence=2;
  await assert.rejects(()=>prepareRegistryCityJSONDraftTx(f.client,f.request,f.dependencies),status(409));
  f.state.fence=1;const record=f.state.drafts.get(receipt.draftId).records[0];record.nativeExteriorCandidate.representation.geometry.asset.ref.id='another-asset';
  await assert.rejects(()=>readRegistryCityJSONDraftTx(f.client,receipt.draftId,f.dependencies),status(409));
  const foreign=fixture(),site={id:randomUUID(),synthetic:false,revision:0,frame:{id:'EPSG:4326',horizontalUnit:'m',verticalUnit:'m',benchmark:'NAP'}};
  foreign.state.sites.set(site.id,site);
  await assert.rejects(()=>prepareRegistryCityJSONDraftTx(foreign.client,{...foreign.request,destination:{kind:'existing_site',siteId:site.id,expectedSiteRevision:0}},foreign.dependencies),status(422));
  assert.equal(foreign.state.reads,0);assert.equal(foreign.state.drafts.size,0);
  const unrelated=fixture(),compatible={...site,id:randomUUID(),frame:{id:'EPSG:7415',horizontalUnit:'m',verticalUnit:'m',benchmark:'NAP'}};
  unrelated.state.sites.set(compatible.id,compatible);
  const existing={id:randomUUID(),site_id:compatible.id,request_key:unrelated.request.requestKey,records:[{name:'unrelated technical draft'}]};
  unrelated.state.drafts.set(existing.id,existing);const preserved=fingerprint(existing);
  await assert.rejects(()=>prepareRegistryCityJSONDraftTx(unrelated.client,{...unrelated.request,destination:{kind:'existing_site',siteId:compatible.id,expectedSiteRevision:0}},unrelated.dependencies),status(409));
  assert.equal(fingerprint(unrelated.state.drafts.get(existing.id)),preserved);assert.equal(unrelated.state.reads,0);
}));
test('private read and preparation reject revoked or changed authority after object I/O, result and artifact drift',()=>attributed(async()=>{
  for(const mutate of [(f:ReturnType<typeof fixture>)=>f.state.denied=true,(f:ReturnType<typeof fixture>)=>f.state.fence++,
    (f:ReturnType<typeof fixture>)=>f.state.input.caseContextSha256='c'.repeat(64)]){
    const f=fixture();f.state.afterRead=()=>{mutate(f);};
    await assert.rejects(()=>prepareRegistryCityJSONDraftTx(f.client,f.request,f.dependencies),error=>[403,409].includes((error as any).status));
    assert.equal(f.state.drafts.size,0);assert.equal(f.state.sites.size,0);
  }
  const f=fixture(),receipt=await prepareRegistryCityJSONDraftTx(f.client,f.request,f.dependencies);
  f.state.afterRead=()=>f.state.denied=true;
  await assert.rejects(()=>readRegistryCityJSONDraftTx(f.client,receipt.draftId,f.dependencies),status(403));
  f.state.afterRead=undefined;f.state.denied=false;f.state.result.artifact.sha256='d'.repeat(64);
  await assert.rejects(()=>readRegistryCityJSONDraftTx(f.client,receipt.draftId,f.dependencies),status(409));
  assert.throws(()=>selectCityJSONExterior(Buffer.concat([f.artifactBytes,Buffer.from(' ')]),f.input,f.result,selection),status(422));
}));
test('unsupported/missing planar face or parent/reference stays recoverable; closed native ring projects once',()=>attributed(async()=>{
  for(const change of [n=>n.frame.referenceSystemState='absent',n=>n.sourceDocument.feature.CityObjects[part].parents=[],
    n=>n.objects[0].geometries[0].surfaces[0].ringPointers.push(footprintPointer+'/1'),
    n=>n.sourceDocument.feature.vertices[0][2]+=1] as ((n:any)=>void)[]){
    const native=envelope();change(native);const f=fixture(Buffer.from(JSON.stringify(native)));
    assert.throws(()=>selectCityJSONExterior(f.artifactBytes,f.input,f.result,selection),status(422));
  }
  const native=envelope();native.sourceDocument.feature.CityObjects[building].geometry[0].boundaries[0][0].push(0);
  const f=fixture(Buffer.from(JSON.stringify(native))),chosen=selectCityJSONExterior(f.artifactBytes,f.input,f.result,selection);
  assert.equal(chosen.footprint.length,8);assert.equal((chosen.native.footprintSurface as any)[0].length,9);
  assert.throws(()=>nativePointer(original,'/feature/~2bad'),status(422));
  assert(!RegistryCityJSONPrepareSchema.safeParse({...f.request,geometry:{copied:true}}).success);
}));
test('private projections and generic creation/edit/review/recording guard reject marker even without legacy geometry',()=>attributed(async()=>{
  const f=fixture(),receipt=await prepareRegistryCityJSONDraftTx(f.client,f.request,f.dependencies),d=f.state.drafts.get(receipt.draftId),record=d.records[0];
  for(const marker of [record.nativeExteriorCandidate,null,undefined])assert.throws(()=>assertNoNativeCandidates([{nativeExteriorCandidate:marker}]),status(422));
  assert.deepEqual(publicRegistryBody(record).footprint,[]);assert(!Object.hasOwn(publicRegistryBody(record),'nativeExteriorCandidate'));
  assert(!JSON.stringify(publicRegistryDraft({records:[record]})).includes(f.input.sourceId));
  assert(!JSON.stringify(publicRegistryReview({records:[record],before:[record]})).includes(f.input.sourceId));
  await assert.rejects(()=>createRegistryDraftTx(f.client,receipt.siteId,undefined,record,randomUUID()),status(422));
  const review={records:[record],before:[]};
  for(const committed of [false,true]){
    const client={query:async(sql:string)=>({rows:sql.includes('registry_reviews')?[{draft_id:d.id,body:review,committed}]:
      sql.includes('registry_sites')?[f.state.sites.get(receipt.siteId)]:sql.includes('registry_drafts')?[d]:[]})} as unknown as PoolClient;
    await assert.rejects(()=>commitRegistryReviewTx(client,randomUUID(),''),status(422));
  }
}));
test('explicit removal succeeds without source I/O, clears private footprint and replays while duplicate preparation fails',()=>attributed(async()=>{
  const f=fixture(),receipt=await prepareRegistryCityJSONDraftTx(f.client,f.request,f.dependencies),reads=f.state.reads,checks=f.state.checks;
  f.state.denied=true;
  const request={requestKey:randomUUID(),expectedDraftRevision:1,recordId:receipt.recordId};
  const removed=await removeRegistryCityJSONDraftTx(f.client,receipt.draftId,request);
  assert.equal(removed.draftRevision,2);assert.equal(f.state.reads,reads);assert.equal(f.state.checks,checks);
  assert.deepEqual(f.state.drafts.get(receipt.draftId).records[0].footprint,[]);
  assert(!Object.hasOwn(f.state.drafts.get(receipt.draftId).records[0],'nativeExteriorCandidate'));
  assert.deepEqual(await removeRegistryCityJSONDraftTx(f.client,receipt.draftId,request),removed);
  await assert.rejects(()=>prepareRegistryCityJSONDraftTx(f.client,f.request,f.dependencies),status(409));
  assert.equal(f.state.drafts.size,1);
}));

// Protocol controls below run real entry points against query doubles. The
// cooperative gate models sequencing only; PostgreSQL contention is unrun.
const gateSql='SELECT pg_advisory_xact_lock(hashtext($1))';
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};}
async function memoryPool<T>(client:any,work:()=>Promise<T>){
  const globals=globalThis as any,previous=globals.ulpinPool;
  globals.ulpinPool={connect:async()=>({...client,release(){}})};
  try{return await work();}finally{if(previous===undefined)delete globals.ulpinPool;else globals.ulpinPool=previous;}
}
test('lock protocol serializes the opposing source-workspace writer before native destination rows',()=>attributed(async()=>{
  const f=fixture(),caseHeld=deferred(),finishWriter=deferred(),writerDone=deferred(),nativeWaiting=deferred();
  const site=await f.dependencies.createSite(f.client,'technical destination',{id:'EPSG:7415',horizontalUnit:'m',verticalUnit:'m',benchmark:'NAP'},false);
  const area={id:randomUUID(),site_id:site.id,name:'technical destination',revision:0,reference:null};
  const writerQueries:{sql:string;args:any[]}[]=[],events:string[]=[];
  const writer={query:async(sql:string,args:any[]=[])=>{
    writerQueries.push({sql,args});let rows:any[]=[];
    if(sql===gateSql){assert.equal(args[0],`registry-import:${f.input.caseId}`);events.push('writer gate');}
    else if(sql==='COMMIT'){events.push('writer commit');writerDone.resolve();}
    else if(sql.includes('FROM cases')&&sql.includes('FOR UPDATE')){events.push('writer case');caseHeld.resolve();await finishWriter.promise;rows=[{id:f.input.caseId}];}
    else if(sql.includes('SELECT id FROM map_areas')){events.push('writer area');rows=[{id:area.id}];}
    else if(sql.includes('FROM map_areas a'))rows=[area];
    else if(sql.includes('SELECT frame FROM registry_sites')){events.push('writer site');rows=[{frame:site.frame}];}
    else if(['BEGIN','ROLLBACK'].includes(sql)||sql.includes('pg_advisory_xact_lock')||sql.startsWith('INSERT ')||
      sql.includes('FROM import_packages')||sql.includes('FROM registry_case_feature_mappings')||sql.includes('FROM sources')){}
    else throw new Error('Unexpected technical writer SQL: '+sql);
    return {rows,rowCount:rows.length};
  }};
  const native={query:async(sql:string,args:any[]=[])=>{
    if(sql===gateSql){events.push('native waits for gate');nativeWaiting.resolve();await writerDone.promise;events.push('native gate');}
    if(sql.includes('registry_sites')&&sql.includes('FOR UPDATE'))events.push('native site');
    return (f.client.query as any)(sql,args);
  }} as unknown as PoolClient;
  await memoryPool(writer,async()=>{
    const pendingWriter=createSourceWorkspace({requestKey:randomUUID(),caseId:f.input.caseId,areaId:area.id,expectedAreaRevision:0,
      name:'technical source workspace',worldStatus:'observed'});
    await caseHeld.promise;
    const pendingNative=prepareRegistryCityJSONDraftTx(native,{...f.request,destination:{kind:'existing_site',siteId:site.id,expectedSiteRevision:0}},f.dependencies);
    await nativeWaiting.promise;assert(!events.includes('native site'));
    finishWriter.resolve();await pendingWriter;await pendingNative;
  });
  assert.equal(writerQueries[1].sql,gateSql); // BEGIN, shared gate, then the old workspace-specific lock.
  assert(events.indexOf('writer case')<events.indexOf('writer area')&&events.indexOf('writer area')<events.indexOf('writer site'));
  assert(events.indexOf('writer commit')<events.indexOf('native site'));
}));
test('lock protocol gates native read/replay and revalidates lookup case/site identities before source authority',()=>attributed(async()=>{
  const f=fixture(),receipt=await prepareRegistryCityJSONDraftTx(f.client,f.request,f.dependencies),key=`registry-import:${f.input.caseId}`;
  f.state.queries=[];await readRegistryCityJSONDraftTx(f.client,receipt.draftId,f.dependencies);
  assert.equal(f.state.queries[0].sql,'SELECT site_id,records FROM registry_drafts WHERE id=$1');
  assert.equal(f.state.queries[1].sql,gateSql);assert.equal(f.state.queries[1].args[0],key);
  assert(f.state.queries[2].sql.includes('registry_sites')&&f.state.queries[2].sql.includes('FOR UPDATE'));
  f.state.queries=[];await prepareRegistryCityJSONDraftTx(f.client,f.request,f.dependencies);
  assert.equal(f.state.queries[0].sql,gateSql);assert.equal(f.state.queries[0].args[0],key);
  const originalDraft=structuredClone(f.state.drafts.get(receipt.draftId)),checks=f.state.checks;
  f.state.drafts.get(receipt.draftId).records[0].nativeExteriorCandidate.input.caseId=randomUUID();
  await assert.rejects(()=>prepareRegistryCityJSONDraftTx(f.client,f.request,f.dependencies),status(409));
  assert.equal(f.state.checks,checks);f.state.drafts.set(receipt.draftId,structuredClone(originalDraft));
  for(const change of [(d:any)=>d.site_id=randomUUID(),(d:any)=>d.records[0].nativeExteriorCandidate.input.caseId=randomUUID()]){
    const client={query:async(sql:string,args:any[])=>{
      if(sql===gateSql)change(f.state.drafts.get(receipt.draftId));return (f.client.query as any)(sql,args);
    }} as unknown as PoolClient;
    await assert.rejects(()=>readRegistryCityJSONDraftTx(client,receipt.draftId,f.dependencies),status(409));
    assert.equal(f.state.checks,checks);f.state.drafts.set(receipt.draftId,structuredClone(originalDraft));
  }
  f.state.queries=[];await removeRegistryCityJSONDraftTx(f.client,receipt.draftId,{requestKey:randomUUID(),expectedDraftRevision:1,recordId:receipt.recordId});
  assert(!f.state.queries.some(q=>q.sql===gateSql)); // No source case is locked or resolved by removal.
  await assert.rejects(()=>prepareRegistryCityJSONDraftTx(f.client,f.request,f.dependencies),status(409));
}));
test('lock protocol gates manual author/decide and canonical import before their established row order',()=>attributed(async()=>{
  const caseId=randomUUID(),sourceId=randomUUID(),digest='a'.repeat(64),stopped=new Error('technical row boundary');
  let queries:{sql:string;args:any[]}[]=[];
  const stopAtCase={query:async(sql:string,args:any[]=[])=>{
    queries.push({sql,args});if(sql.includes('FROM cases')&&sql.includes('FOR UPDATE'))throw stopped;return {rows:[],rowCount:0};
  }};
  const manual=new ManualIngestionService(),input={requestKey:randomUUID(),expectedRecipeRevision:1};
  const author={...input,expectedRecipeRevision:0,plan:{version:'manual-geojson/1',mode:'manual_mapping',caseId,workspaceRevision:1,
    workspaceFingerprint:digest,source:{sourceId,familyId:sourceId,sourceRevision:1,sourceSha256:digest,schemaFingerprint:digest},
    operations:[{target:'building.sourceKey',sourcePath:'/features/*/id',conversionId:'literal_identifier@1'},
      {target:'building.geometry',sourcePath:'/features/*/geometry',conversionId:'geojson_polygon@1'}]},
    destination:{kind:'new_area',namespace:'technical-control',name:'technical-control'}};
  for(const run of [()=>manual.author(caseId,sourceId,author),()=>manual.decide(caseId,randomUUID(),input,'approve'),
    ()=>manual.decide(caseId,randomUUID(),input,'execute')]){
    queries=[];await memoryPool(stopAtCase,()=>assert.rejects(run,error=>error===stopped));
    assert.equal(queries[1].sql,gateSql);assert.equal(queries[1].args[0],`registry-import:${caseId}`);
    assert(queries[2].sql.includes('FROM cases')&&queries[2].sql.includes('FOR UPDATE'));
  }
  const snapshotId=randomUUID(),frame={id:'EPSG:7415',horizontalUnit:'m',verticalUnit:'m',benchmark:'NAP'};
  queries=[];
  const importer={query:async(sql:string,args:any[]=[])=>{
    queries.push({sql,args});let rows:any[]=[];
    if(sql.includes('FROM registry_sites')&&sql.includes('FOR UPDATE'))throw stopped;
    if(sql.includes('SELECT * FROM cases'))rows=[{id:caseId,revision:1,frame,current_snapshot_id:snapshotId,
      created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z'}];
    if(sql.includes('FROM snapshots'))rows=[{body:{id:snapshotId,revision:1,inputFingerprint:digest}}];
    return {rows,rowCount:rows.length};
  }};
  await memoryPool(importer,()=>assert.rejects(()=>importRegistryCase(randomUUID(),caseId.toUpperCase(),1),error=>error===stopped));
  const gateIndex=queries.findIndex(q=>q.sql===gateSql),siteIndex=queries.findIndex(q=>q.sql.includes('FROM registry_sites')&&q.sql.includes('FOR UPDATE'));
  assert(gateIndex>=0&&gateIndex<siteIndex);assert.equal(queries[gateIndex].args[0],`registry-import:${caseId}`);
}));

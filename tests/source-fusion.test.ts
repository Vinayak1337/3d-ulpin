import assert from 'node:assert/strict';
import test from 'node:test';
import {Readable} from 'node:stream';
import {SourceFusionRequestSchema,SOURCE_FUSION_LIMITS,type SourceFusionSelection} from '../packages/contracts/src/source-fusion';
import {DocumentPartSchema,DocumentResultSchema,type DocumentInput} from '../packages/contracts/src/usp/document-ingestion';
import {CityJSONResultSchema,type CityJSONInput} from '../packages/contracts/src/usp/cityjson-ingestion';
import type {RequestContext} from '../packages/contracts/src/usp/common';
import {AppError} from '../packages/server/src/infrastructure/errors';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {assembleSourceFusion,fusionSourceProjection,fusionContextProjection,type SourceFusionDependencies} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {fusionAuthorityBatch,fusionJson,readFusionObject,type FusionBudget} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';

const digest='a'.repeat(64),subject='source-fusion-technical-control';
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function document(n:number,text='Literal floor G+41; current revision unknown'){
  const input:DocumentInput={version:'source-document/1',jobId:uuid(n+100),caseId:uuid(n),caseRevision:1,
    caseContextSha256:digest,sourceId:uuid(n+200),familyId:uuid(n+200),sourceRevision:1,sourceSha256:digest,
    sourceBytes:1,objectKey:'technical-control',subject,accessSha256:digest,policyVersion:'source-document-native/1',
    readerSha256:digest,gatewayPolicySha256:null,layoutCap:null,mode:'native_only'};
  const parts=[text,'[redacted native line]'].map((text,i)=>DocumentPartSchema.parse({id:uuid(n+300+i),
    sourceId:input.sourceId,sourceRevision:1,sourceSha256:digest,text,sha256:sha256(text),method:'native_text',
    locator:{label:`line ${i+1}`,line:i+1,characterStart:0,characterEnd:text.length}}));
  const result=DocumentResultSchema.parse({version:'source-document/1',input,native:{status:'extracted',format:'text',
    readerSha256:digest,code:null,warnings:[],parts},model:{status:'not_requested',code:null,candidates:[],validationErrors:[],calls:[]},
    createdAt:'2026-10-01T00:00:00Z'});
  const selection:SourceFusionSelection={kind:'document',pin:{caseId:input.caseId,caseRevision:1,sourceId:input.sourceId,
    sourceRevision:1,sourceSha256:digest,jobId:input.jobId,resultSha256:sha256(JSON.stringify(result)),
    readerSha256:digest,inputSha256:fingerprint(input),acceptedFence:1,resultBytes:Buffer.byteLength(JSON.stringify(result))},partIds:[parts[1].id]};
  return {selection,loaded:{kind:'document' as const,result},authority:{kind:'document' as const,input,acceptedFence:1}};
}
function city(n:number){
  const input:CityJSONInput={version:'cityjson-native/1',jobId:uuid(n+100),caseId:uuid(n),caseRevision:1,
    caseContextSha256:digest,sourceId:uuid(n+200),sourceFamilyId:uuid(n+200),sourceRevision:1,sourceSha256:digest,
    sourceBytes:1,objectKey:'technical-control',subject,accessSha256:digest,readerSha256:digest,selection:'complete_bounded_source'};
  const id='Building/~unit',pointer='/CityObjects/Building~1~0unit';
  const native={schemaVersion:'source-native-cityjson/1',sourceSha256:digest,sourceBytes:1,
    sourceDocument:{metadata:{referenceSystem:null,verticalUnit:'m'},transform:{scale:[1,1,1],translate:[0,0,0]},
      CityObjects:{[id]:{type:'Building',attributes:{name:null,floorScopes:['G+41','G+42']},children:['missing'],
        geometry:[{type:'MultiSurface',lod:'2.2',boundaries:[[[0,1,2]]]}]}},vertices:[[0,0,0],[1,1,0],[2,0,0]]},
    frame:{referenceSystemState:'null',referenceSystem:null,metadataPointer:'/metadata',globalPlacement:'not_qualified'},
    transformPointer:'/transform',objects:[{id,pointer,type:'Building',geometryState:'present',
      geometries:[{pointer:`${pointer}/geometry/0`,type:'MultiSurface',status:'supported'}]}],
    hierarchyIssues:[{code:'UNRESOLVED_SOURCE_LINK',pointer:`${pointer}/children/0`,id:'missing'}]};
  const result=CityJSONResultSchema.parse({version:'cityjson-native/1',input,summary:{schemaVersion:'source-native-cityjson/1',
    status:'supported',sourceSha256:digest,sourceBytes:1,objectCount:1,vertexCount:3,boundaryIndexCount:3,
    supportedGeometryCount:1,unsupportedGeometryCount:0,decodedBounds:null,transformState:'supplied',
    coordinateMode:'supplied_transform_only',referenceSystemState:'null',structuralReadingOnly:true,globalPlacement:'not_qualified',
    watertightSolid:'not_qualified',interiorFloors:'not_established_by_reader',rights:'not_assessed'},
    artifact:{key:`cityjson-native/${input.jobId}/${digest}.native.json`,sha256:digest,bytes:1,
      mediaType:'application/json',profile:'source-native-cityjson/1'},createdAt:'2026-10-01T00:00:00Z'});
  const selection:SourceFusionSelection={kind:'cityjson',pin:{caseId:input.caseId,caseRevision:1,sourceId:input.sourceId,
    sourceRevision:1,sourceSha256:digest,jobId:input.jobId,resultSha256:sha256(JSON.stringify(result)),readerSha256:digest,
    inputSha256:fingerprint(input),acceptedFence:1,resultBytes:Buffer.byteLength(JSON.stringify(result))},objectIds:[id]};
  return {selection,loaded:{kind:'cityjson' as const,result,native},authority:{kind:'cityjson' as const,input,acceptedFence:1}};
}
async function local<T>(run:(ctx:RequestContext)=>Promise<T>){
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
  try{return await run(localRequestContext(uuid(999)));}
  finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}
}
const budget=():FusionBudget=>({deadlineAt:Date.now()+30_000,signal:new AbortController().signal,reservedBytes:0});

test('strict selection cannot broaden sources, duplicate normalized UUIDs or exceed total/profile bounds',()=>{
  const a=document(1),b=city(2),request={sources:[a.selection,b.selection]};
  assert(SourceFusionRequestSchema.safeParse(request).success);
  assert(!SourceFusionRequestSchema.safeParse({...request,scope:'global'}).success);
  assert(!SourceFusionRequestSchema.safeParse({sources:[a.selection,{...a.selection,pin:{...a.selection.pin,sourceId:a.selection.pin.sourceId.toUpperCase()}}]}).success);
  assert(!SourceFusionRequestSchema.safeParse({sources:[{...a.selection,pin:{...a.selection.pin,objectKey:'caller-key'}},b.selection]}).success);
  assert(!SourceFusionRequestSchema.safeParse({sources:[a.selection,{...b.selection,objectIds:[]}]}).success);
  assert(!SourceFusionRequestSchema.safeParse({sources:[{...a.selection,partIds:Array.from({length:25},(_,i)=>uuid(i+1000))},b.selection]}).success);
});

test('heterogeneous ordering is reproducible; selected literals and equal native keys retain separate source namespaces',async()=>local(async ctx=>{
  const rows=[document(1),city(2),city(3)],bySource=new Map(rows.map(row=>[row.selection.pin.sourceId,row]));
  const events:string[]=[];
  const deps:SourceFusionDependencies={authority:async(_ctx,selections,_budget,expected)=>{
    events.push(expected?'final-all':'initial-all');return selections.map(s=>bySource.get(s.pin.sourceId)!.authority);
  },read:async selection=>{events.push(`read:${selection.pin.caseId}`);return bySource.get(selection.pin.sourceId)!.loaded;}};
  const forward=await assembleSourceFusion(ctx,{sources:rows.map(r=>r.selection)},deps);
  const reverse=await assembleSourceFusion(ctx,{sources:[...rows].reverse().map(r=>r.selection)},deps);
  assert.deepEqual(reverse,forward);assert.equal(events[4],'final-all');
  const [doc,c1,c2]=forward.sources;
  assert(doc.kind==='document'&&c1.kind==='cityjson'&&c2.kind==='cityjson');
  assert.equal(doc.parts.length,1);assert.deepEqual(doc.parts[0].part,rows[0].loaded.result.native.parts[1]);
  assert.equal(doc.parts[0].textState,'redacted_native_derivative');
  assert.equal(c1.objects[0].id,c2.objects[0].id);assert.notEqual(c1.objects[0].key,c2.objects[0].key);
  assert.deepEqual(c1.objects[0].parents,{state:'absent'});assert.deepEqual(c1.objects[0].children,{state:'declared',value:['missing']});
  assert.deepEqual(c1.objects[0].attributes,{state:'declared',value:{name:null,floorScopes:['G+41','G+42']}});
  assert.deepEqual(c1.reference.metadata,{state:'declared',value:{referenceSystem:null,verticalUnit:'m'}});
  assert.equal(c1.objects[0].geometries[0].lod.state,'declared');
  assert(!JSON.stringify(forward).includes('boundaries'));assert(!JSON.stringify(forward).includes('vertices'));
  assert.equal(forward.association.state,'not_assessed');assert.deepEqual(forward.association.canonicalTargets,[]);
  assert.equal(forward.capabilities.recordedBuildingRequired,false);
}));

test('multiple documents retain native-needs-OCR separately; unknown selected parts fail the whole request',async()=>local(async ctx=>{
  const a=document(1),b=document(2);b.selection={...b.selection,partIds:[]};
  b.loaded.result=DocumentResultSchema.parse({...b.loaded.result,native:{...b.loaded.result.native,status:'needs_ocr',format:'pdf',code:'NATIVE_NEEDS_OCR',parts:[]}});
  const rows=[a,b];const deps:SourceFusionDependencies={authority:async()=>rows.map(r=>r.authority),read:async selection=>rows.find(r=>r.selection.pin.sourceId===selection.pin.sourceId)!.loaded};
  const context=await assembleSourceFusion(ctx,{sources:rows.map(r=>r.selection)},deps);
  const incomplete=context.sources[1];assert(incomplete.kind==='document');assert.equal(incomplete.nativeStatus,'needs_ocr');
  assert.equal(incomplete.capability,'native_incomplete');assert.equal(context.capabilities.contextAssembly,'available');
  await assert.rejects(()=>assembleSourceFusion(ctx,{sources:[{...a.selection,partIds:[uuid(9999)]},b.selection]},deps),
    (e:any)=>e.status===422&&e.code==='SOURCE_FUSION_UNAVAILABLE'&&!e.message.includes(a.selection.pin.sourceId));
}));

test('aggregate authority holds ordered canonical locks and rejects same-revision source/hash drift',async()=>local(async ctx=>{
  const rows=[document(1),document(2)],queries:string[]=[],gates:string[]=[];let changed=false,transactions=0;
  const client={query:async(sql:string)=>{queries.push(sql);return {rows:sql.includes('accepted_fence')?[{accepted_fence:1}]:[]};}};
  const deps:any={transaction:async(action:any,options:any)=>{transactions++;assert(options.signal);assert(options.deadlineAt>Date.now());return action(client);},
    gate:async(_client:any,id:string)=>{gates.push(id);},document:async(_client:any,_ctx:any,pin:any,_prior:any,lock:boolean)=>{
      assert(lock);assert(queries.some(q=>q.startsWith('SELECT id FROM sources')));
      const input=rows.find(r=>r.selection.pin.sourceId===pin.sourceId)!.authority.input;
      return changed&&pin.sourceId===rows[0].selection.pin.sourceId?{...input,sourceSha256:'b'.repeat(64)}:input;
    },cityjson:async()=>assert.fail('No CityJSON authority requested')};
  const selections=rows.map(r=>r.selection),captured=await fusionAuthorityBatch(ctx,selections,budget(),undefined,deps);
  assert.equal(transactions,1);assert.deepEqual(gates,rows.map(r=>r.selection.pin.caseId));
  assert(!queries.some(q=>/\b(INSERT|UPDATE|DELETE)\s+(INTO|cases|sources|jobs)\b/i.test(q)));
  assert(!queries.some(q=>q.includes('SET TRANSACTION')));changed=true;
  await assert.rejects(()=>fusionAuthorityBatch(ctx,selections,budget(),captured,deps),(e:any)=>e.status===409);
}));

test('source A revoked while reading B is denied in the final aggregate transaction, with zero writes and no partial result',async()=>local(async ctx=>{
  const rows=[document(1),document(2)];let revoked=false,inTransaction=false,transactions=0,reads=0,writes=0;
  const events:string[]=[];
  const client={query:async(sql:string)=>{if(/^(INSERT|UPDATE|DELETE)\b/i.test(sql))writes++;
    return {rows:sql.includes('accepted_fence')?[{accepted_fence:1}]:[]};}};
  const authorityDeps:any={transaction:async(action:any)=>{transactions++;inTransaction=true;events.push('transaction');
    try{return await action(client);}finally{inTransaction=false;}},gate:async()=>{},
    document:async(_client:any,_ctx:any,pin:any)=>{if(revoked&&pin.sourceId===rows[0].selection.pin.sourceId)
      throw new AppError(403,'DOCUMENT_DENIED','Specific source A revoked');return rows.find(r=>r.selection.pin.sourceId===pin.sourceId)!.authority.input;},
    cityjson:async()=>assert.fail('No CityJSON authority requested')};
  const deps:SourceFusionDependencies={authority:(ctx,selections,budget,expected)=>fusionAuthorityBatch(ctx,selections,budget,expected,authorityDeps),
    read:async selection=>{assert(!inTransaction);reads++;events.push('read');if(reads===2)revoked=true;
      return rows.find(r=>r.selection.pin.sourceId===selection.pin.sourceId)!.loaded;}};
  let returned=false;
  await assert.rejects(async()=>{await assembleSourceFusion(ctx,{sources:rows.map(r=>r.selection)},deps);returned=true;},
    (e:any)=>e.status===403&&e.code==='SOURCE_FUSION_UNAVAILABLE'&&!e.message.includes('source A'));
  assert.equal(returned,false);assert.equal(transactions,2);assert.equal(reads,2);assert.equal(writes,0);
  assert.deepEqual(events,['transaction','read','read','transaction']);
  revoked=true;reads=0;
  await assert.rejects(()=>assembleSourceFusion(ctx,{sources:rows.map(r=>r.selection)},deps),(e:any)=>e.status===403);
  assert.equal(reads,0);
}));

test('read allocation, exact bytes/hash, JSON depth, response size and expired work are bounded before returning',async()=>{
  const value=Buffer.from('{"literal":null}'),active=budget();let opens=0;const bodies:Readable[]=[];
  const open:any=async(_key:string,size:number,timeout:number,_etag:unknown,signal:AbortSignal)=>{
    opens++;assert.equal(size,value.length);assert(timeout>0&&timeout<=30_000);assert.equal(signal,active.signal);
    const body=Readable.from([value]);bodies.push(body);return {body,etag:'technical'};
  };
  assert.deepEqual(await readFusionObject('server-key',value.length,sha256(value),active,open),value);
  await assert.rejects(()=>readFusionObject('server-key',value.length,digest,active,open),(e:any)=>e.status===422);
  assert(bodies.every(body=>body.destroyed));
  active.reservedBytes=SOURCE_FUSION_LIMITS.aggregateArtifactBytes;
  await assert.rejects(()=>readFusionObject('server-key',value.length,sha256(value),active,open),(e:any)=>e.status===413);assert.equal(opens,2);
  assert.throws(()=>fusionJson(Buffer.from('['.repeat(65)+'0'+']'.repeat(65)),budget()),(e:any)=>e.code==='SOURCE_FUSION_JSON');
  assert.throws(()=>fusionJson(Buffer.from('{"number":1e999}'),budget()),(e:any)=>e.code==='SOURCE_FUSION_JSON');
  await assert.rejects(()=>readFusionObject('server-key',value.length,sha256(value),{...budget(),deadlineAt:0},open),(e:any)=>e.status===503);
  const a=document(1),b=city(2),sources=[fusionSourceProjection(a.selection,a.loaded),fusionSourceProjection(b.selection,b.loaded)];
  const citySource=sources[1];assert(citySource.kind==='cityjson');
  citySource.objects[0].attributes={state:'declared',value:{oversized:'x'.repeat(SOURCE_FUSION_LIMITS.responseBytes)}};
  assert.throws(()=>fusionContextProjection(sources),(e:any)=>e.code==='SOURCE_FUSION_RESPONSE_LIMIT');
});

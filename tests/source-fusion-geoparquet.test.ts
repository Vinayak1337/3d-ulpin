import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {GeoParquetOriginalSchema,GeoParquetResultSchema} from '../packages/contracts/src/usp/geoparquet-ingestion';
import {SourceFusionGeoParquetSelectionSchema} from '../packages/contracts/src/source-fusion-geoparquet';
import {SOURCE_FUSION_LIMITS} from '../packages/contracts/src/source-fusion';
import {fusionGeoParquetSourceProjection} from '../packages/server/src/modules/usp/ingestion/source-fusion-geoparquet';
import {acceptedFusionGeoParquetTx,readFusionGeoParquetResult,verifyFusionGeoParquetTools,type FusionGeoParquetAuthority} from '../packages/server/src/modules/usp/ingestion/source-fusion-geoparquet-authority';
import {readFusionObject,readFusionResult,fusionAuthorityBatch,type FusionBudget} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {assembleSourceFusion} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {DocumentResultSchema} from '../packages/contracts/src/usp/document-ingestion';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {documentResultKey} from '../packages/server/src/modules/usp/ingestion/documents';
import {resolveFusionCitationsTx} from '../packages/server/src/modules/usp/ingestion/source-fusion-citations';
import {proposeFusionAssociations} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations';
import {geoparquetInput,geoparquetSourceTx,geoparquetReaderSha,geoparquetResultKey} from '../packages/server/src/modules/usp/ingestion/geoparquet';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// Retained upstream test_only bytes/envelopes, no parser/profile/runtime mutation.
// SQL/storage are memory controls. Current-reader reconstruction and tool authority
// injection are explicitly labelled; they do not qualify current HTTP/persistence.
// This focused check prevents cross-window expansion and stale/private disclosure.
const root=process.env.ULPIN_GEOPARQUET_FUSION_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-geoparquet-continuation/journey-01';
const absentRoot=process.env.ULPIN_GEOPARQUET_ABSENT_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-geoparquet-private-api/journey-01';
const present=existsSync(root+'/continuation.journey.json')&&existsSync(root+'/continued.native.json')&&
  existsSync(absentRoot+'/alltypes_plain.parquet.journey.json');
const budget=():FusionBudget=>({deadlineAt:Date.now()+30000,signal:new AbortController().signal,reservedBytes:0});
async function local(work:()=>Promise<void>){
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='geoparquet-protocol-control';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}
}
function fixture(absent=false){
  const journey=JSON.parse(readFileSync(absent?absentRoot+'/alltypes_plain.parquet.journey.json':root+'/continuation.journey.json','utf8')),
    saved=absent?journey.accepted:journey.continuedAccepted,result=GeoParquetResultSchema.parse(saved),input=result.input,
    nativeBytes=readFileSync(absent?absentRoot+'/alltypes_plain.parquet.native.json':root+'/continued.native.json'),
    native=JSON.parse(nativeBytes.toString('utf8')),resultBytes=Buffer.from(JSON.stringify(saved)),hash=sha256(resultBytes),
    parent=absent?null:GeoParquetResultSchema.parse(journey.initialAccepted),
    parentBytes=parent?Buffer.from(JSON.stringify(journey.initialAccepted)):null,
    fence=absent?1:journey.continuedAcceptedFence;
  assert.deepEqual(result,saved);assert.equal(sha256(nativeBytes),result.artifact.sha256);assert.equal(nativeBytes.length,result.artifact.bytes);
  if(!absent){assert.equal(hash,journey.continuedResultSha256);assert.equal(sha256(parentBytes!),journey.initialResultSha256);
    assert.equal(fingerprint(parent!.input),input.continuation!.inputSha256);}
  const sources=JSON.parse(readFileSync(new URL('../docs/evidence/usp/native-geoparquet/sources.json',import.meta.url),'utf8')).sources,
    entry=sources.find((s:any)=>s.sha256===input.sourceSha256),original=readFileSync(entry.path);
  assert.equal(sha256(original),input.sourceSha256);assert.equal(original.length,input.sourceBytes);assert.equal(entry.qualification,'test_only');
  const current={id:input.caseId,revision:input.caseRevision,archived:false,frame:null,context:null,site_id:null},binding=ingestionBinding(input.caseId);
  assert.equal(fingerprint({frame:null,context:null,siteId:null}),input.caseContextSha256);
  assert.equal(binding.subject,input.subject);assert.equal(binding.access,input.accessSha256);
  const marker=GeoParquetOriginalSchema.parse({version:input.version,subject:input.subject,accessSha256:input.accessSha256,
    sha256:input.sourceSha256,bytes:input.sourceBytes,receivedAt:result.createdAt,lineageState:'caller_declared',
    lineage:{issuer:entry.issuer,originalUrl:entry.originalUrl,acquiredAt:new Date(entry.acquiredAt).toISOString(),permissionReference:null,
      geography:entry.geography,limitations:['memory source authority; test_only upstream data',entry.licence]}}),
    source={id:input.sourceId,case_id:input.caseId,family_id:input.sourceFamilyId,revision:input.sourceRevision,
      profile:'geoparquet-native-v1',sha256:input.sourceSha256,bytes:input.sourceBytes,object_key:input.objectKey,inspection:{geoparquetOriginal:marker}};
  const job=(r:typeof result,bytes:Buffer,fence:number)=>({id:r.input.jobId,operation:'geoparquet-native',case_id:r.input.caseId,
    source_id:r.input.sourceId,case_revision:r.input.caseRevision,payload:r.input,input_fingerprint:fingerprint(r.input),input_sha256:fingerprint(r.input),
    status:'succeeded',logical_state:'succeeded',result_ref:{assetId:`geoparquet:${r.input.jobId}:${bytes.length}`,version:1,sha256:sha256(bytes)},
    accepted_fence:fence,attempt_state:'accepted',attempt_fence:fence,attempt_input_sha256:fingerprint(r.input),completion_sha256:sha256(bytes)}),
    jobs=new Map([[input.jobId,job(result,resultBytes,fence)]]);
  if(parent)jobs.set(parent.input.jobId,job(parent,parentBytes!,journey.initialAcceptedFence));
  const selection=SourceFusionGeoParquetSelectionSchema.parse({kind:'geoparquet',pin:{caseId:input.caseId,caseRevision:input.caseRevision,
    sourceId:input.sourceId,sourceRevision:input.sourceRevision,sourceSha256:input.sourceSha256,jobId:input.jobId,
    resultSha256:hash,resultBytes:resultBytes.length,readerSha256:input.readerSha256,inputSha256:fingerprint(input),acceptedFence:fence},
    artifactSha256:result.artifact.sha256,rowIndices:[absent?0:3]}),
    objects=new Map([[geoparquetResultKey(input.jobId,hash),resultBytes],[result.artifact.key,nativeBytes]]);
  if(parent)objects.set(geoparquetResultKey(parent.input.jobId,sha256(parentBytes!)),parentBytes!);
  return {current,source,jobs,result,parent,native,nativeBytes,resultBytes,selection,objects,original,entry};
}
function control(f:ReturnType<typeof fixture>){
  let active=false,captures=0,tools=0;const queries:string[]=[],reads:string[]=[];
  const client={query:async(sql:string,args:any[]=[])=>{
    assert(active,'SQL escaped capture');queries.push(sql);assert(!/^(INSERT|UPDATE|DELETE)\b/.test(sql));
    if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
    if(sql.startsWith('SELECT id FROM cases')||sql.startsWith('SELECT id FROM sources'))return {rows:[]};
    if(sql.startsWith('SELECT accepted_fence FROM usp_job_metadata'))return {rows:[{accepted_fence:1}]};
    if(sql.includes('SELECT id,revision,archived,frame,context,site_id FROM cases'))return {rows:[f.current]};
    if(sql.includes('SELECT * FROM sources'))return {rows:[f.source]};
    if(sql.includes('SELECT max(revision)'))return {rows:[{revision:f.source.revision}]};
    if(sql.includes('SELECT j.*,m.result_ref'))return {rows:f.jobs.has(args[0])?[f.jobs.get(args[0])]:[]};
    assert.fail('unexpected SQL: '+sql);
  }};
  // Preserve all historical input/result bytes. Only the current-reader assertion
  // uses the retained tools.readerSha256 instead of physical checkout/EOL bytes.
  const input:typeof geoparquetInput=(ctx,id,selection,tools,continuation)=>({...geoparquetInput(ctx,id,selection,tools,continuation),
    readerSha256:tools!.readerSha256});
  const capture=async(expected?:FusionGeoParquetAuthority)=>{
    assert(!active);captures++;active=true;
    let captured:FusionGeoParquetAuthority;
    try{captured=await acceptedFusionGeoParquetTx(client as any,f.selection.pin,true,{source:geoparquetSourceTx,input});
      if(expected)assert.equal(fingerprint(captured),fingerprint(expected),'final leaf authority changed');}
    finally{active=false;}
    // Tool success is a labelled control, outside locks. Production refusal is
    // tested independently with no configured profile below.
    assert(!active);tools++;return captured!;
  };
  const read:typeof readFusionObject=(key,size,digest,bounds)=>readFusionObject(key,size,digest,bounds,async()=>{
    assert(!active,'object I/O held SQL locks');reads.push(key);const bytes=f.objects.get(key);assert(bytes,'unexpected key '+key);
    return {body:Readable.from([bytes]),etag:'memory-only'};
  });
  const assemblyAuthority=(document:ReturnType<typeof DocumentResultSchema.parse>):typeof fusionAuthorityBatch=>
    (ctx,selections,bounds,expected)=>fusionAuthorityBatch(ctx,selections,bounds,expected,{
      transaction:async(work:any)=>{assert(!active);active=true;captures++;try{return await work(client);}finally{active=false;}},
      gate:async()=>{},document:async(_client,_ctx,pin)=>{assert.equal(pin.inputSha256,fingerprint(document.input));return document.input;},
      cityjson:async()=>{throw new Error('unexpected CityJSON authority');},
      geoparquet:(client,pin,lock)=>acceptedFusionGeoParquetTx(client,pin,lock,{source:geoparquetSourceTx,input}),
      geoparquetTools:()=>{assert(!active,'tool scan held SQL locks');tools++;},
    });
  return {client,capture,read,assemblyAuthority,queries,reads,stats:()=>({active,captures,tools})};
}
function save(name:string,value:unknown){
  const output=process.env.ULPIN_FUSION_GEOPARQUET_PROOF_DIR;if(!output)return;
  mkdirSync(output,{recursive:true});writeFileSync(output+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
}
const errorCode=(code:string)=>(e:any)=>e.code===code;

test('integrated mixed document and GeoParquet context recaptures the accepted parent and requires an exact citation target site',{skip:!present},()=>local(async()=>{
  const f=fixture(),c=control(f),documentBytes=readFileSync('E:/BhuAayam-data/task-data/desktop-reference-document-enrollment/epsg7415-accepted-result.json'),
    document=DocumentResultSchema.parse(JSON.parse(documentBytes.toString('utf8'))),
    entry=JSON.parse(readFileSync(new URL('../docs/evidence/usp/reference-document-enrollment/manifest.json',import.meta.url),'utf8'))
      .enrollments.find((v:any)=>v.id==='epsg7415');
  assert.equal(sha256(documentBytes),entry.resultSha256);assert.equal(fingerprint(document.input),entry.inputSha256);assert.equal(entry.acceptedFence,1);
  const docSelection={kind:'document' as const,pin:{caseId:entry.caseId,caseRevision:entry.caseRevision,sourceId:entry.sourceId,
    sourceRevision:entry.sourceRevision,sourceSha256:entry.sourceSha256,jobId:entry.jobId,resultSha256:entry.resultSha256,
    resultBytes:entry.resultBytes,readerSha256:entry.readerSha256,inputSha256:entry.inputSha256,acceptedFence:entry.acceptedFence},
    partIds:[entry.selectedParts[0].id]};
  f.objects.set(documentResultKey(document.input.jobId,entry.resultSha256),documentBytes);
  const ctx=localRequestContext('geoparquet-mixed-control'),selection={sources:[f.selection,docSelection]},
    deps={authority:c.assemblyAuthority(document),read:((s,a,b)=>readFusionResult(s,a,b,c.read)) as typeof readFusionResult};
  const context=await assembleSourceFusion(ctx,selection,deps);
  const geo=context.sources.find(s=>s.kind==='geoparquet'),doc=context.sources.find(s=>s.kind==='document');
  assert(geo?.kind==='geoparquet'&&doc?.kind==='document');assert.equal(geo.rows.length,1);assert.equal(geo.rows[0].rowIndex,3);
  assert.equal(geo.continuation?.jobId,f.parent!.input.jobId);assert.equal(geo.summary.window.nextRowIndex,4);
  assert.equal(doc.parts[0].part.text,document.native.parts.find(p=>p.id===docSelection.partIds[0])!.text);
  assert.deepEqual(c.stats(),{active:false,captures:2,tools:2});assert.equal(c.reads.length,4);assert(!c.reads.includes(f.parent!.artifact.key));
  assert.equal(context.association.state,'not_assessed');assert.equal(context.sources.length,2);
  await assert.rejects(()=>resolveFusionCitationsTx(null as any,ctx,{contextSha256:context.contextSha256,selection},{} as any),
    (e:any)=>e.code==='SOURCE_FUSION_GEOPARQUET_CONTEXT_ONLY'&&e.message.includes('exact canonical building/floor target site'));
  await assert.rejects(()=>proposeFusionAssociations(ctx,{requestKey:'00000000-0000-4000-8000-000000000001',
    context:{contextSha256:context.contextSha256,selection},scope:null,targets:[]},{} as any),errorCode('SOURCE_FUSION_GEOPARQUET_CONTEXT_ONLY'));
  const parent=f.jobs.get(f.parent!.input.jobId)!;
  await assert.rejects(()=>assembleSourceFusion(ctx,selection,{...deps,read:async(s,a,b)=>{
    const loaded=await readFusionResult(s,a,b,c.read);
    if(s.kind==='geoparquet')parent.accepted_fence=parent.attempt_fence=2;
    return loaded;
  }}),errorCode('SOURCE_FUSION_STALE'));
  parent.accepted_fence=parent.attempt_fence=1;
  await assert.rejects(()=>assembleSourceFusion(ctx,{sources:[{...f.selection,rowIndices:[1]},docSelection]},deps),
    errorCode('SOURCE_FUSION_GEOPARQUET_ROW_WINDOW'));
  save('integrated-mixed-context.json',{qualification:'retained real bytes with memory SQL/document/source/storage/tool controls; no live HTTP admission',
    selection,context,initialCaptures:2,initialReads:4,parentChangeDenied:true,outOfWindowActionable:true,citationTargetSiteRequired:true,automaticAssociationDenied:true});
}));

test('retained continuation selects global row 3 at ordinal 1 with exact literal metadata and bounded receipt reads',{skip:!present},()=>local(async()=>{
  const f=fixture(),c=control(f),bounds=budget(),authority=await c.capture(),loaded=await readFusionGeoParquetResult(f.selection,authority,bounds,c.read),
    projection=fusionGeoParquetSourceProjection(f.selection,loaded);await c.capture(authority);
  assert.equal(projection.rows.length,1);const row=projection.rows[0];
  assert.deepEqual(row.record,f.native.rows[1]);assert.equal(row.rowIndex,3);assert.equal(row.ordinal,1);assert.equal(row.rowGroupIndex,0);
  assert.equal(row.rowIndexInGroup,3);assert.equal(row.pointer,'/rows/1');assert.equal(row.recordSha256,fingerprint(f.native.rows[1]));
  assert.equal((row.record.columns as any).name.value,'Canada');assert.equal((row.record.columns as any).gdp_md_est.value.decimalInteger,'1736425');
  const wkb=(row.record.columns as any).geometry.wkb;assert.equal(sha256(Buffer.from(wkb.hex,'hex')),wkb.sha256);
  assert.equal(Buffer.from(wkb.hex,'hex').length,wkb.bytes);
  for(const name of ['source','reader','schema','geoMetadata','profile','rowGroups','semantics'] as const)assert.deepEqual(projection[name],f.native[name]);
  assert.deepEqual(projection.summary,f.result.summary);assert.deepEqual(projection.continuation,f.result.input.continuation);
  assert.equal(projection.summary.status,'partial');assert.equal(projection.summary.window.nextRowIndex,4);
  assert.equal(projection.coverage.continuationRowsFetch,'not_performed');assert.equal(projection.coverage.propertyMatching,'unsupported');
  assert.equal(c.reads.length,3);assert(!c.reads.includes(f.parent!.artifact.key));
  assert.equal(bounds.reservedBytes,[...f.objects.values()].reduce((n,b)=>n+b.length,0));
  assert(c.queries.filter(q=>q.includes('SELECT j.*,m.result_ref')).every(q=>q.includes('FOR SHARE OF j,m')));
  assert.deepEqual(c.stats(),{active:false,captures:2,tools:2});assert(Buffer.byteLength(JSON.stringify(projection))<SOURCE_FUSION_LIMITS.responseBytes-8192);
  assert.notEqual(fusionGeoParquetSourceProjection({...f.selection,rowIndices:[2]},loaded).selectionSha256,projection.selectionSha256);
  const both=fusionGeoParquetSourceProjection({...f.selection,rowIndices:[3,2]},loaded);
  assert.deepEqual(both.rows.map(row=>row.rowIndex),[2,3]);assert.equal(both.selectionSha256,
    fusionGeoParquetSourceProjection({...f.selection,rowIndices:[2,3]},loaded).selectionSha256);
  save('selected-continuation-row.json',{qualification:'retained test_only data; memory SQL/storage/tool control; historical-reader reconstruction',
    request:f.selection,projection,reads:c.reads,reservedBytes:bounds.reservedBytes,stats:c.stats(),physicalCurrentReaderSha256:geoparquetReaderSha(),
    retainedReaderSha256:f.result.input.readerSha256,original:{path:f.entry.path,bytes:f.original.length,sha256:sha256(f.original)}});
}));

test('absent geo and rows from a different accepted window return actionable selection refusals',{skip:!present},()=>local(async()=>{
  const f=fixture(true),c=control(f),a=await c.capture(),loaded=await readFusionGeoParquetResult(f.selection,a,budget(),c.read);
  assert.equal(loaded.result.summary.geoMetadataState,'absent');assert.equal(loaded.result.summary.window.returnedRows,0);
  assert.throws(()=>fusionGeoParquetSourceProjection(f.selection,loaded),errorCode('SOURCE_FUSION_GEOPARQUET_NO_ROWS'));
  const continued=fixture(),cc=control(continued),ca=await cc.capture(),cl=await readFusionGeoParquetResult(continued.selection,ca,budget(),cc.read);
  assert.throws(()=>fusionGeoParquetSourceProjection({...continued.selection,rowIndices:[1]},cl),errorCode('SOURCE_FUSION_GEOPARQUET_ROW_WINDOW'));
  assert(!SourceFusionGeoParquetSelectionSchema.safeParse({...continued.selection,rowIndices:[3,3]}).success);
  save('unavailable-selection.json',{qualification:'unchanged absent-geo inventory and controlled authority',
    summary:loaded.result.summary,absentCode:'SOURCE_FUSION_GEOPARQUET_NO_ROWS',otherWindowCode:'SOURCE_FUSION_GEOPARQUET_ROW_WINDOW',published:false});
}));

test('exact child/parent pins, bounded hash reads and final revocation deny publication',{skip:!present},()=>local(async()=>{
  const f=fixture(),c=control(f),a=await c.capture();
  // Capture denies a wrong child receipt/fence using unchanged saved inputs.
  for(const patch of [{resultSha256:'0'.repeat(64)},{acceptedFence:2}]){
    const saved=f.selection;f.selection={...saved,pin:{...saved.pin,...patch}};
    await assert.rejects(()=>c.capture(),errorCode('SOURCE_FUSION_STALE'));f.selection=saved;
  }
  const parent=f.jobs.get(f.parent!.input.jobId)!;parent.accepted_fence=2;
  await assert.rejects(()=>c.capture(),(e:any)=>e.status===409);parent.accepted_fence=1;
  await assert.rejects(()=>readFusionGeoParquetResult({...f.selection,artifactSha256:'0'.repeat(64)},a,budget(),c.read),errorCode('SOURCE_FUSION_INTEGRITY'));
  await assert.rejects(()=>readFusionGeoParquetResult(f.selection,{...a,parent:{...a.parent!,acceptedFence:2}},budget(),c.read),errorCode('SOURCE_FUSION_INTEGRITY'));
  const key=f.result.artifact.key,bytes=f.objects.get(key)!;f.objects.set(key,Buffer.from(bytes).fill(32,0,1));
  await assert.rejects(()=>readFusionGeoParquetResult(f.selection,a,budget(),c.read),errorCode('SOURCE_FUSION_INTEGRITY'));f.objects.set(key,bytes);
  await assert.rejects(()=>readFusionGeoParquetResult(f.selection,a,{...budget(),reservedBytes:SOURCE_FUSION_LIMITS.aggregateArtifactBytes},c.read),
    errorCode('SOURCE_FUSION_ARTIFACT_LIMIT'));
  await readFusionGeoParquetResult(f.selection,a,budget(),c.read);f.current.archived=true;
  await assert.rejects(()=>c.capture(a),errorCode('GEOPARQUET_DENIED'));f.current.archived=false;
  // Reauthorization must recapture the direct parent too, after every read.
  parent.accepted_fence=parent.attempt_fence=2;await assert.rejects(()=>c.capture(a),errorCode('SOURCE_FUSION_STALE'));
  save('denial-control.json',{qualification:'memory-only SQL/source/fence/revocation/hash/budget controls; final leaf recapture',
    childResultDenied:true,childFenceDenied:true,parentFenceDenied:true,wrongArtifactDenied:true,wrongHashDenied:true,byteBudgetDenied:true,
    revokedAfterReads:true,parentChangedAfterReads:true,published:false,stats:c.stats()});
}));

test('production tool verifier refuses unconfigured current inventory without repinning a historical profile',{skip:!present},()=>local(async()=>{
  const f=fixture(),names=['ULPIN_GEOPARQUET_PROFILE','ULPIN_GEOPARQUET_PROFILE_SHA256'],prior=names.map(n=>process.env[n]);
  try{for(const name of names)delete process.env[name];
    assert.throws(()=>verifyFusionGeoParquetTools(f.result.input,budget()),(e:any)=>e.status===503);
    assert.throws(()=>verifyFusionGeoParquetTools(f.result.input,{...budget(),deadlineAt:Date.now()-1}),errorCode('SOURCE_FUSION_DEADLINE'));
  }finally{names.forEach((n,i)=>{if(prior[i]===undefined)delete process.env[n];else process.env[n]=prior[i];});}
  save('tool-refusal.json',{qualification:'default production verifier; no configured profile or native process',unconfiguredDenied:true,expiredDenied:true,
    retainedReaderSha256:f.result.input.readerSha256,physicalCurrentReaderSha256:geoparquetReaderSha(),historicalBytesChanged:false});
}));

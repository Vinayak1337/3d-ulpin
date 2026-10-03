import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
// Import leaf first: shared-union initialization must remain independent.
import {SourceFusionRasterSelectionSchema} from '../packages/contracts/src/source-fusion-raster';
import {SOURCE_FUSION_LIMITS,SourceFusionRequestSchema} from '../packages/contracts/src/source-fusion';
import {RasterOriginalSchema,RasterWindowResultSchema} from '../packages/contracts/src/usp/raster-window';
import {DocumentResultSchema} from '../packages/contracts/src/usp/document-ingestion';
import {rasterInput,rasterResultKey} from '../packages/server/src/modules/usp/ingestion/raster-window';
import {documentResultKey} from '../packages/server/src/modules/usp/ingestion/documents';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {fusionAuthorityBatch,readFusionObject,readFusionResult,type FusionBudget} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {assembleSourceFusion} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {resolveFusionCitationsTx} from '../packages/server/src/modules/usp/ingestion/source-fusion-citations';
import {proposeFusionAssociations} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations';
import {associationLiterals} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations-projection';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// Canonical raster capture, complete-set fusion, bounded receipt and projections
// execute over memory SQL/storage/document authority controls. Retained original
// and metadata are unchanged. Input/envelope/fence below are reconstructed controls,
// NOT missing historical accepted proof. No TIFF bytes, decoder or native process.
const root='E:/BhuAayam-data/task-data/desktop-ai05a-raster',
  originalPath='E:/BhuAayam-data/task-data/nyc-10013-multimodal/upload/nyc-10013-dem-2017.tif',
  docPath='E:/BhuAayam-data/task-data/desktop-reference-document-enrollment/epsg7415-accepted-result.json';
const present=existsSync(root+'/raster-http-receipt.json')&&existsSync(originalPath)&&existsSync(docPath);
const code=(name:string)=>(e:any)=>e.code===name;
function fixture(){
  const oldBytes=readFileSync(root+'/raster-http-receipt.json'),old=JSON.parse(oldBytes.toString('utf8')),
    original=readFileSync(originalPath),manifest=JSON.parse(readFileSync('E:/BhuAayam-data/task-data/nyc-10013-multimodal/manifest.json','utf8')),
    upstream=manifest.originals.find((v:any)=>v.name==='be_NYC_025.tif');
  assert.equal(sha256(oldBytes),'60d0e8debbb5524e6351e55abdfd561210cf6e9167a703bee9f7da22d5a787ae');
  assert.equal(sha256(original),old.sourceHash);assert.equal(original.length,old.sourceBytes);
  const current={id:old.caseId,revision:old.first.currentCaseRevision,archived:false,frame:null,context:null,site_id:null},binding=ingestionBinding(current.id),
    marker=RasterOriginalSchema.parse({version:'raster-window/1',subject:binding.subject,sha256:old.sourceHash,bytes:old.sourceBytes,
      receivedAt:old.first.result.createdAt,lineageState:'caller_declared',lineage:{kind:'native_grid_derivative',issuer:'NYS GIS Program Office / NYC survey',
        originalUrl:upstream.url,acquiredAt:new Date(manifest.acquiredAt).toISOString(),permissionReference:null,geography:manifest.coverage,
        upstreamBytes:upstream.bytes,upstreamRetained:false,parentSha256:null,limitations:manifest.limitations,note:'memory-only authority control'}}),
    source={id:old.sourceId,case_id:current.id,family_id:old.sourceId,revision:old.first.sourceRevision,profile:'geotiff-raster-v1',
      sha256:old.sourceHash,bytes:old.sourceBytes,object_key:`sources/${old.sourceId}/${old.sourceHash}`,inspection:{rasterOriginal:marker}},
    input=rasterInput({current,source,binding,latest:true,context:fingerprint({frame:null,context:null,siteId:null})},old.first.jobId,null),
    result=RasterWindowResultSchema.parse({...old.first.result,input}),bytes=Buffer.from(JSON.stringify(result)),digest=fingerprint(input),
    job={id:input.jobId,operation:'raster-window',case_id:input.caseId,source_id:input.sourceId,case_revision:input.caseRevision,
      payload:input,input_fingerprint:digest,input_manifest_id:input.sourceId,input_sha256:digest,scope:{kind:'intake',workspaceId:input.caseId,version:input.caseRevision+1},
      status:'succeeded',error:null,logical_state:'succeeded',result_ref:{assetId:`raster:${input.jobId}`,version:1,sha256:sha256(bytes)},accepted_fence:1,
      attempt_state:'accepted',attempt_fence:1,attempt_input_sha256:digest,completion_sha256:sha256(bytes)},
    raster=SourceFusionRasterSelectionSchema.parse({kind:'raster',pin:{caseId:input.caseId,caseRevision:input.caseRevision,
      sourceId:input.sourceId,sourceRevision:input.sourceRevision,sourceSha256:input.sourceSha256,jobId:input.jobId,
      resultSha256:sha256(bytes),resultBytes:bytes.length,readerSha256:input.readerSha256,inputSha256:digest,acceptedFence:1},
      artifactSha256:result.artifact.sha256,metadataSha256:fingerprint(result.metadata),window:result.metadata.window});
  const docBytes=readFileSync(docPath),document=DocumentResultSchema.parse(JSON.parse(docBytes.toString('utf8'))),
    entry=JSON.parse(readFileSync(new URL('../docs/evidence/usp/reference-document-enrollment/manifest.json',import.meta.url),'utf8'))
      .enrollments.find((v:any)=>v.id==='epsg7415');
  assert.equal(sha256(docBytes),entry.resultSha256);assert.equal(fingerprint(document.input),entry.inputSha256);
  const doc={kind:'document' as const,pin:{caseId:entry.caseId,caseRevision:entry.caseRevision,sourceId:entry.sourceId,
    sourceRevision:entry.sourceRevision,sourceSha256:entry.sourceSha256,jobId:entry.jobId,resultSha256:entry.resultSha256,
    resultBytes:entry.resultBytes,readerSha256:entry.readerSha256,inputSha256:entry.inputSha256,acceptedFence:entry.acceptedFence},
    partIds:[entry.selectedParts[0].id]},
    objects=new Map([[rasterResultKey(input.jobId,sha256(bytes)),bytes],[documentResultKey(document.input.jobId,entry.resultSha256),docBytes]]);
  return {old,original,current,source,input,result,bytes,job,raster,doc,document,objects};
}
function control(f:ReturnType<typeof fixture>){
  let active=false,captures=0,reservedBytes=0;const reads:string[]=[],queries:string[]=[],streams:Readable[]=[];
  const client={query:async(sql:string,args:any[]=[])=>{
    assert(active);queries.push(sql);assert(!/^(INSERT|UPDATE|DELETE)\b/.test(sql));
    if(sql.startsWith('SELECT id FROM cases')||sql.startsWith('SELECT id FROM sources'))return {rows:[]};
    if(sql.startsWith('SELECT accepted_fence FROM usp_job_metadata'))return {rows:[{accepted_fence:f.doc.pin.acceptedFence}]};
    if(sql.includes('SELECT id,revision,archived,frame,context,site_id FROM cases'))return {rows:[structuredClone(f.current)]};
    if(sql.includes('SELECT * FROM sources'))return {rows:[structuredClone(f.source)]};
    if(sql.includes('SELECT max(revision)'))return {rows:[{revision:f.source.revision}]};
    if(sql.includes('SELECT j.*,m.result_ref'))return {rows:args[0]===f.input.jobId?[structuredClone(f.job)]:[]};
    assert.fail('unexpected SQL '+sql);
  }};
  const authority:typeof fusionAuthorityBatch=(ctx,selections,budget,expected)=>fusionAuthorityBatch(ctx,selections,budget,expected,{
    transaction:async(work:any)=>{assert(!active);captures++;active=true;try{return await work(client);}finally{active=false;}},
    gate:async()=>{},cityjson:async()=>assert.fail('unexpected CityJSON'),
    document:async(_client,_ctx,pin)=>{assert.equal(pin.inputSha256,fingerprint(f.document.input));return f.document.input;}});
  const read:typeof readFusionObject=(key,size,hash,budget)=>readFusionObject(key,size,hash,budget,async()=>{
    assert(!active,'I/O held complete-set SQL locks');reads.push(key);const bytes=f.objects.get(key);assert(bytes,'unselected window/pixels fetched');
    const body=Readable.from([bytes]);streams.push(body);return {body,etag:'memory'};
  });
  const deps={authority,read:((selection,a,budget)=>readFusionResult(selection,a,budget,read).then(loaded=>{reservedBytes=budget.reservedBytes;return loaded;})) as typeof readFusionResult};
  return {deps,read,reads,queries,streams,stats:()=>({active,captures,reservedBytes})};
}
async function local(work:()=>Promise<void>){const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='raster-fusion-control';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}}
function save(name:string,value:unknown){const dir=process.env.ULPIN_FUSION_RASTER_PROOF_DIR;if(!dir)return;
  mkdirSync(dir,{recursive:true});writeFileSync(dir+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}

test('retained raster metadata and EPSG fragment assemble through exact canonical capture without TIFF reads',{skip:!present},()=>local(async()=>{
  const f=fixture(),c=control(f),ctx=localRequestContext('raster-mixed-control'),selection={sources:[f.raster,f.doc]},
    context=await assembleSourceFusion(ctx,selection,c.deps),raster=context.sources.find(s=>s.kind==='raster'),doc=context.sources.find(s=>s.kind==='document');
  assert(raster?.kind==='raster'&&doc?.kind==='document');assert.deepEqual(raster.metadata,f.old.first.result.metadata);
  assert.equal(raster.metadataSha256,fingerprint(raster.metadata));assert.equal(raster.metadata.verticalReference,null);
  assert.equal(raster.metadata.verticalReferenceStatus,'unknown');assert.equal(raster.metadata.globalPlacement,'not_qualified');
  assert.equal(raster.metadata.sourceCrsAuthority,'EPSG:2263');assert.equal(raster.metadata.bands[0].dtype,'float32');
  assert.equal(raster.metadata.bands[0].nodataKind,'finite');assert.equal(raster.coverage.pixelContent,'not_read');
  assert.equal(doc.parts[0].part.text,f.document.native.parts.find(p=>p.id===f.doc.partIds[0])!.text);
  assert.equal(context.association.state,'not_assessed');assert.equal(context.association.crossSourceFrameAlignment,'not_assessed');
  assert.equal(c.reads.length,2);assert(!c.reads.includes(f.result.artifact.key));assert(c.streams.every(s=>s.destroyed));
  assert.deepEqual(c.stats(),{active:false,captures:2,reservedBytes:[...f.objects.values()].reduce((n,b)=>n+b.length,0)});
  assert.equal(c.queries.filter(s=>s.includes('SELECT j.*,m.result_ref')).length,2);
  assert(c.queries.filter(s=>s.includes('SELECT j.*,m.result_ref')).every(s=>s.includes('FOR SHARE OF j,m')));
  const json=JSON.stringify(context);assert(!json.includes(f.result.artifact.key));assert(!json.includes(f.input.objectKey));
  const repeat=await assembleSourceFusion(ctx,{sources:[f.doc,f.raster]},c.deps);assert.deepEqual(repeat,context);
  await assert.rejects(()=>proposeFusionAssociations(ctx,{requestKey:'00000000-0000-4000-8000-000000000001',
    context:{contextSha256:context.contextSha256,selection},scope:null,targets:[]},{} as any),code('SOURCE_FUSION_RASTER_CONTEXT_ONLY'));
  await assert.rejects(()=>resolveFusionCitationsTx(null as any,ctx,{contextSha256:context.contextSha256,selection},{} as any,
    '00000000-0000-4000-8000-000000000002'),code('SOURCE_FUSION_RASTER_CONTEXT_ONLY'));
  assert.throws(()=>associationLiterals(context),code('SOURCE_FUSION_RASTER_CONTEXT_ONLY'));
  // Count the raster fragment toward the existing total; no source/window expansion.
  const parts=Array.from({length:25},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
  assert(!SourceFusionRequestSchema.safeParse({sources:[f.raster,{...f.doc,partIds:parts}]}).success);
  assert(!SourceFusionRequestSchema.safeParse({sources:[f.raster,f.raster]}).success);
  save('mixed-context.json',{qualification:'retained original/metadata/document; reconstructed raster input/envelope/fence and memory SQL/storage/document authority; no historical TIFF proof',
    selection,context,initialCaptures:2,initialReads:2,receiptOnly:true,associationAndCitationDenied:true,stableRepeat:true,
    original:{path:originalPath,bytes:f.original.length,sha256:sha256(f.original)},resultObjectUtf8:f.bytes.toString('utf8')});
}));

test('wrong accepted pins/window and final raster revocation or recapture drift deny the entire mixed context',{skip:!present},()=>local(async()=>{
  const ctx=localRequestContext('raster-denial-control'),outcomes=[];
  for(const mode of ['fence','window','metadata','revoked','capture'] as const){
    const f=fixture(),c=control(f);let raster=f.raster;
    if(mode==='fence')raster={...raster,pin:{...raster.pin,acceptedFence:2}};
    if(mode==='window')raster={...raster,window:{...raster.window,x:1}};
    if(mode==='metadata')raster={...raster,metadataSha256:'0'.repeat(64)};
    const deps={...c.deps,read:async(s:any,a:any,b: any)=>{const loaded=await c.deps.read(s,a,b);
      if(s.kind==='raster'){if(mode==='revoked')f.current.archived=true;if(mode==='capture')f.job.error='changed-after-read-control';}return loaded;}};
    await assert.rejects(()=>assembleSourceFusion(ctx,{sources:[raster,f.doc]},deps),
      (e:any)=>e.code===(mode==='fence'||mode==='capture'?'SOURCE_FUSION_STALE':'SOURCE_FUSION_UNAVAILABLE'));
    assert(!c.reads.includes(f.result.artifact.key));assert(!c.stats().active);
    if(mode==='fence')assert.equal(c.reads.length,0);
    outcomes.push({mode,published:false,reads:c.reads,stats:c.stats()});
  }
  const f=fixture(),c=control(f),b:FusionBudget={deadlineAt:Date.now()+1000,signal:new AbortController().signal,reservedBytes:SOURCE_FUSION_LIMITS.aggregateArtifactBytes};
  await assert.rejects(()=>c.read(rasterResultKey(f.input.jobId,f.raster.pin.resultSha256),f.bytes.length,f.raster.pin.resultSha256,b),
    code('SOURCE_FUSION_ARTIFACT_LIMIT'));assert.equal(c.reads.length,0);
  save('authority-denials.json',{qualification:'memory source/window/fence/metadata/full-capture and aggregate-budget controls',outcomes,aggregateLimitBeforeOpen:true});
}));

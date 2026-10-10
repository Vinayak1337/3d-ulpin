import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import type {PoolClient} from 'pg';
import {KMLOriginalSchema,KMLResultSchema,KMLSummarySchema} from '../packages/contracts/src/usp/kml-ingestion';
import {CityGMLOriginalSchema,CityGMLResultSchema} from '../packages/contracts/src/usp/citygml-ingestion';
import {SufficiencyResultSchema,NeedsInputSchema,SufficiencyXMLProcessingSchema} from '../packages/contracts/src/usp/sufficiency';
import {IngestionSufficiencyService,assertSufficiencyReceiptSize} from '../packages/server/src/modules/usp/ingestion/sufficiency';
import {sufficiencyCaseTx} from '../packages/server/src/modules/usp/ingestion/sufficiency-context';
import {sufficiencyXMLOriginalTx} from '../packages/server/src/modules/usp/ingestion/sufficiency-xml';
import {assessSufficiency} from '../packages/server/src/modules/usp/ingestion/sufficiency-policy';
import {kmlReaderSha,kmlResultKey} from '../packages/server/src/modules/usp/ingestion/kml';
import {citygmlReaderSha,citygmlResultKey} from '../packages/server/src/modules/usp/ingestion/citygml';
import {readFusionObject} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {AppError} from '../packages/server/src/infrastructure/errors';

// Reuses exact retained accepted inputs/results and real originals. Source/case,
// SQL/fence, object transport and tool admission are disclosed controls, never
// a current profile, live persistence, property match, native run or hash alias.
const roots={kml:'E:/BhuAayam-data/task-data/desktop-kml-private-api/journey-initial',
  citygml:'E:/BhuAayam-data/task-data/desktop-citygml-private-api/journey-01'},
  labels={kml:'kmlsamples.kml',citygml:'Building_and_garage_LOD2-EPSG25832.gml'},
  id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function local(kind:'kml'|'citygml',work:()=>Promise<void>){const previous=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=kind+'-protocol-control';try{await work();}finally{
    if(previous===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=previous;}}
function save(name:string,value:unknown){const proof=process.env.ULPIN_XML_SUFFICIENCY_PROOF_DIR;
  if(proof)writeFileSync(proof+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
function fixture(kind:'kml'|'citygml',name=labels[kind]){
  const journey=JSON.parse(readFileSync(roots[kind]+'/'+name+'.journey.json','utf8')),
    result=kind==='kml'?KMLResultSchema.parse(journey.accepted):CityGMLResultSchema.parse(journey.accepted),input=result.input,
    bytes=Buffer.from(JSON.stringify(result)),hash=sha256(bytes),
    native=readFileSync(roots[kind]+'/'+name+'.native.json'),
    manifest=JSON.parse(readFileSync(new URL('../docs/evidence/usp/native-'+kind+'/sources.json',import.meta.url),'utf8')),
    entry=manifest.sources.find((entry:any)=>entry.sha256===input.sourceSha256),original=readFileSync(entry.path??entry.localPath);
  assert.deepEqual(result.summary,journey.status.result.summary);assert.equal(sha256(native),result.artifact.sha256);assert.equal(native.length,result.artifact.bytes);
  assert.equal(sha256(original),input.sourceSha256);assert.equal(original.length,input.sourceBytes);
  const current={id:input.caseId,revision:input.caseRevision,archived:false,frame:null,context:null,site_id:null},binding=ingestionBinding(input.caseId);
  assert.equal(binding.subject,input.subject);assert.equal(binding.access,input.accessSha256);
  assert.equal(fingerprint({frame:null,context:null,siteId:null}),input.caseContextSha256);
  const marker=(kind==='kml'?KMLOriginalSchema:CityGMLOriginalSchema).parse({version:input.version,subject:input.subject,accessSha256:input.accessSha256,
    sha256:input.sourceSha256,bytes:input.sourceBytes,receivedAt:result.createdAt,lineageState:'caller_declared',
    lineage:{issuer:null,originalUrl:null,acquiredAt:null,permissionReference:null,geography:null,limitations:['Memory source authority; unchanged test_only retained original.']}}),
    source:any={id:input.sourceId,case_id:input.caseId,family_id:input.sourceFamilyId,revision:input.sourceRevision,sha256:input.sourceSha256,
      bytes:input.sourceBytes,object_key:input.objectKey,profile:kind+'-native-v1',status:'received',inspection:{[kind+'Original']:marker}},
    job:any={id:input.jobId,case_id:input.caseId,source_id:input.sourceId,operation:kind+'-native',case_revision:input.caseRevision,payload:input,
      input_fingerprint:fingerprint(input),input_sha256:fingerprint(input),status:'succeeded',logical_state:'succeeded',
      result_ref:{assetId:`${kind}:${input.jobId}:${bytes.length}`,version:1,sha256:hash},accepted_fence:1,attempt_state:'accepted',attempt_fence:1,
      attempt_input_sha256:fingerprint(input),completion_sha256:hash,error:null},
    state={writes:0,reads:0,tools:0,events:0,sequence:0,present:true,unavailable:false,revokeDuringRead:false,fenceDuringRead:false,
      operations:new Map<string,any>(),calls:[] as string[]};
  const client={query:async(sql:string,args:any[]=[])=>{
    state.calls.push(sql);let rows:any[]=[];
    if(sql.includes('pg_advisory_xact_lock')||sql.startsWith('SELECT id FROM sources')||sql.startsWith('SELECT job_id FROM usp_job_')||sql.startsWith('SELECT id FROM jobs')&&sql.includes('id=ANY')){}
    else if(sql.includes('SELECT id,revision,archived,site_id,current_snapshot_id'))rows=[{id:current.id,revision:current.revision,archived:current.archived,site_id:current.site_id,current_snapshot_id:null,
      frame_sha:fingerprint(current.frame),context_sha:fingerprint(current.context)}];
    else if(sql.includes('SELECT id,revision,archived,frame,context,site_id FROM cases'))rows=[current];
    else if(sql.startsWith('SELECT revision FROM cases'))rows=[{revision:current.revision}];
    else if(sql.includes('SELECT max(revision)'))rows=[{revision:source.revision}];
    else if(sql.includes('FROM sources')&&sql.includes('ORDER BY id LIMIT 257'))rows=[{...source,owner:input.subject,inspection_sha:fingerprint(source.inspection),object_sha:fingerprint(source.object_key)}];
    else if(sql.includes('FROM sources')&&sql.includes('has_parts'))rows=[{...source,manual:null,projected:null,document_original:null,has_parts:false}];
    else if(sql.includes('FROM sources'))rows=[source];
    else if(sql.startsWith('SELECT id FROM jobs'))rows=state.present?[{id:job.id}]:[];
    else if(sql.includes('FROM jobs'))rows=state.present?[job]:[];
    else if(sql.includes('FROM usp_mapping_recipes')||sql.includes('FROM import_packages')||sql.includes('FROM map_areas')||sql.includes('FROM registry_case_feature_mappings')||sql.includes('FROM physical_features')){}
    else if(sql.includes('FROM usp_ingestion_questions'))rows=sql.includes('count(*)')?[{n:0}]:[];
    else if(sql.includes('SELECT payload_hash,result FROM operations'))rows=state.operations.has(args[1])?[state.operations.get(args[1])]:[];
    else if(sql.includes('SELECT result FROM operations'))rows=[...state.operations.values()].reverse();
    else if(sql.startsWith('INSERT INTO operations')){state.operations.set(args[1],{payload_hash:args[3],result:args[4]});state.writes++;}
    else if(sql.startsWith('INSERT INTO usp_outbox_streams'))state.writes++;
    else if(sql.startsWith('UPDATE usp_outbox_streams')){state.writes++;rows=[{sequence:String(++state.sequence)}];}
    else if(sql.startsWith('INSERT INTO usp_outbox(')){state.writes++;state.events++;}
    else assert.fail('Unexpected XML sufficiency SQL: '+sql);
    return {rows:structuredClone(rows),rowCount:rows.length};
  }} as PoolClient;
  const key=(kind==='kml'?kmlResultKey:citygmlResultKey)(input.jobId,hash),
    tools=(pins:unknown)=>{state.tools++;assert.deepEqual(pins,input.tools);if(state.unavailable)throw new AppError(503,'XML_TOOL_CHANGED','Controlled tool outage.');},
    service=new IngestionSufficiencyService({transaction:async(action:any,bounds:any)=>{
      assert(Number.isFinite(bounds.deadlineAt));assert(bounds.signal instanceof AbortSignal);return action(client);
    },xml:{kmlTools:tools,citygmlTools:tools,read:(objectKey:string,size:number,digest:string,budget:any)=>readFusionObject(objectKey,size,digest,budget,async()=>{
      assert.equal(objectKey,key,'Only the accepted result receipt may be read.');state.reads++;
      if(state.revokeDuringRead)current.archived=true;if(state.fenceDuringRead)job.attempt_state='fenced';
      return {body:Readable.from([bytes]),etag:'memory'};
    })}} as any),
    request={requestKey:id(1),expectedCaseRevision:input.caseRevision,expectedSourceRevision:input.sourceRevision,sourceSha256:input.sourceSha256,
      tasks:['retain_evidence','inspect_native_context','context_2d','building_massing','spatial_analysis']},
    rawCurrent=input.readerSha256===(kind==='kml'?kmlReaderSha:citygmlReaderSha)();
  return {service,client,current,source,job,result,input,bytes,hash,state,request,rawCurrent};
}

test('retained KML and CityGML accepted metadata evaluate/read/replay with complete partial findings; spatial tasks stay unqualified',async()=>{
  for(const kind of ['kml','citygml'] as const)await local(kind,async()=>{
    const f=fixture(kind),before=structuredClone(f.source),result=await f.service.evaluate(f.input.caseId,f.input.sourceId,f.request);
    assert(SufficiencyResultSchema.safeParse(result).success);assert.equal(result.questions.length,0);
    assert.deepEqual(result.decisions.map(d=>d.outcome),['complete',f.rawCurrent?'complete':'park','park','reject_for_3d','park']);
    const p=result.decisions[1].processing!;assert.equal(p.state,f.rawCurrent?'inspected_metadata':'stale');assert.equal(p.xml!.kind,kind);
    assert.equal(p.nativeStatus,null);assert.equal(p.modelStatus,null);assert.equal(p.ifc,undefined);assert.equal(p.mesh,undefined);
    if(f.rawCurrent){assert.deepEqual(p.xml!.summary,f.result.summary);assert.equal(p.resultSha256,f.hash);assert.equal(p.xml!.acceptedFence,1);}
    else {assert.equal(p.xml!.summary,null);assert.equal(f.state.reads,0);assert.equal(f.state.tools,0);}
    const writes=f.state.writes;assert.deepEqual(await f.service.evaluate(f.input.caseId,f.input.sourceId,f.request),result);
    const needs=await f.service.needsInput(f.input.caseId);assert(NeedsInputSchema.safeParse(needs).success);
    assert.deepEqual(needs.decisions,result.decisions);assert.equal(f.state.writes,writes);assert.deepEqual(f.source,before);
    f.current.revision++;const stale=await f.service.needsInput(f.input.caseId);assert(stale.decisions.every(d=>d.availability==='stale'));
    await assert.rejects(()=>f.service.evaluate(f.input.caseId,f.input.sourceId,f.request),(e:any)=>e.status===409);assert.equal(f.state.writes,writes);
    save(kind+'-controlled-journey.json',{qualification:'Exact retained accepted envelope/original; disclosed SQL/source/fence/storage/tool controls; no installed tool/live persistence/native run.',
      result,needs,stale,accepted:f.result,resultSha256:f.hash,rawCurrent:f.rawCurrent,writes,reads:f.state.reads,events:f.state.events});
  });
});

test('accepted KMZ member inventory gives the exact selection action; selected partial metadata remains unchanged',()=>local('kml',async()=>{
  const f=fixture('kml','multikml-doc.kmz'),result=await f.service.evaluate(f.input.caseId,f.input.sourceId,f.request);
  const decision=result.decisions[1];assert.equal(result.questions.length,0);assert.equal(result.decisions[0].outcome,'complete');
  assert.equal(decision.outcome,'park');assert.equal(decision.nextAction,f.rawCurrent?'select_native_member':'retry_extraction');
  if(f.rawCurrent){assert.deepEqual(decision.processing!.xml!.summary,f.result.summary);assert.equal((decision.processing!.xml!.summary as any).members.length,4);}
  const selected=KMLResultSchema.parse(JSON.parse(readFileSync(roots.kml+'/multikml-doc.kmz.selected.journey.json','utf8')).accepted),
    detail=SufficiencyXMLProcessingSchema.parse({...decision.processing!.xml,kind:'kml',requestedMember:selected.input.selection,summary:selected.summary});
  assert.equal(detail.kind,'kml');if(detail.kind==='kml')assert.deepEqual(detail.requestedMember,detail.summary!.member);
  assert.equal(selected.summary.featureCount,1);assert.equal(selected.summary.coordinateCount,0);assert.equal(selected.summary.horizontalReference,'unknown');
  // Byte-bound control only, not fabricated accepted input/result or operational metadata.
  const large=KMLSummarySchema.parse({...selected.summary,members:Array.from({length:256},(_,ordinal)=>
    ({...selected.summary.member!,ordinal,path:'a'.repeat(1000)+ordinal+'.kml'}))}),before=JSON.stringify(large);
  assert.throws(()=>assertSufficiencyReceiptSize({summary:large}),(e:any)=>e.status===413&&e.code==='SUFFICIENCY_RECEIPT_LIMIT');assert.equal(JSON.stringify(large),before);
  save('member-selection-and-bounds.json',{qualification:'Accepted member inventory service plus retained selected-result schema control; large metadata is byte-bound control only.',
    result,selectedSummary:selected.summary,requestedMember:selected.input.selection,largeBytes:Buffer.byteLength(before),oversized:'413 whole receipt refused, metadata unchanged'});
}));

test('XML originals survive missing/unavailable processing; protected authorities, final access and fence changes refuse without writes',async()=>{
  for(const kind of ['kml','citygml'] as const)await local(kind,async()=>{
    const pending=fixture(kind);pending.state.present=false;
    const p=await pending.service.evaluate(pending.input.caseId,pending.input.sourceId,pending.request);
    assert.equal(p.decisions[0].outcome,'complete');assert.equal(p.decisions[1].processing!.state,'pending');assert.equal(pending.state.reads,0);
    const unavailable=fixture(kind);unavailable.state.unavailable=true;
    const u=await unavailable.service.evaluate(unavailable.input.caseId,unavailable.input.sourceId,unavailable.request);
    assert.equal(u.decisions[0].outcome,'complete');assert.equal(u.decisions[1].nextAction,unavailable.rawCurrent?'configure_reader':'retry_extraction');assert.equal(unavailable.state.reads,0);
    const markers=fixture(kind),original=structuredClone(markers.source.inspection);
    for(const extra of [{[kind+'Original']:null},{copiedFrom:null},{ifcOriginal:null},{objOriginal:{}},{[kind==='kml'?'citygmlOriginal':'kmlOriginal']:null}]){
      const captured={...markers.source,inspection:{...original,...extra}};
      await assert.rejects(()=>sufficiencyXMLOriginalTx(markers.client,captured),(e:any)=>[403,409].includes(e.status));
      markers.source.inspection=captured.inspection;await assert.rejects(()=>sufficiencyCaseTx(markers.client,markers.input.caseId),(e:any)=>[403,409].includes(e.status));markers.source.inspection=original;
    }
    await assert.rejects(()=>sufficiencyXMLOriginalTx(markers.client,{...markers.source,profile:'plan-pdf-v1',inspection:{}}),(e:any)=>e.status===409);
    for(const change of ['revokeDuringRead','fenceDuringRead'] as const){const denied=fixture(kind);denied.state[change]=true;
      if(denied.rawCurrent){await assert.rejects(()=>denied.service.evaluate(denied.input.caseId,denied.input.sourceId,denied.request),(e:any)=>e.status===(change==='revokeDuringRead'?403:409));assert.equal(denied.state.writes,0);}
    }
    save(kind+'-denials.json',{pending:p,unavailable:u,markers:'captured/current null/copied/competing/current-only protected refusal',
      finalAccessAndFence:unavailable.rawCurrent?'403/409 zero writes after result I/O':'raw stale: result I/O not admissible',artifactReads:0});
  });
  const policy={row:{id:id(2),revision:1,profile:'geojson-manual-v1',manual:{geometryTypes:['Polygon']}},supported:true,latest:true,
    recipe:null,exactRecipe:false,features:[],allQualified:false,projectedAccepted:false,scope:{packageBodies:[]},document:null,mesh:null,ifc:null,xml:null} as any;
  assert.equal(assessSufficiency(policy,'context_2d').nextAction,'review_mapping');
  assert.equal(assessSufficiency({...policy,document:{processing:{state:'needs_ocr',modelStatus:null}}},'spatial_analysis').nextAction,'run_ocr');
  for(const key of ['ifc','mesh'])assert.equal(assessSufficiency({...policy,[key]:{processing:{state:'pending',jobId:null}}},'inspect_native_context').nextAction,'process_source');
});

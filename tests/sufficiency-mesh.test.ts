import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import type {PoolClient} from 'pg';
import {ObjOriginalSchema,ObjResultSchema} from '../packages/contracts/src/usp/obj-ingestion';
import {GltfOriginalSchema,GltfResultSchema} from '../packages/contracts/src/usp/gltf-ingestion';
import {SufficiencyResultSchema,NeedsInputSchema} from '../packages/contracts/src/usp/sufficiency';
import {IngestionSufficiencyService} from '../packages/server/src/modules/usp/ingestion/sufficiency';
import {sufficiencyCaseTx} from '../packages/server/src/modules/usp/ingestion/sufficiency-context';
import {assessSufficiency} from '../packages/server/src/modules/usp/ingestion/sufficiency-policy';
import {readFusionObject} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {AppError} from '../packages/server/src/infrastructure/errors';
import {objResultKey} from '../packages/server/src/modules/usp/ingestion/obj';
import {gltfResultKey} from '../packages/server/src/modules/usp/ingestion/gltf';

// Retained accepted input/result/native/original identities stay exact. SQL rows,
// source receipts, object streams and tool admission are explicitly technical controls.
// No current envelopes, aliases, profile/extraction/service/live-write qualification.
const objRoot='E:/BhuAayam-data/task-data/desktop-obj-api/bridge-run01',
  gltfRoot='E:/BhuAayam-data/task-data/gltf-api-20261004-run01';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function local(subject:string,work:()=>Promise<void>){const previous=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;try{await work();}finally{if(previous===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=previous;}}
function fixture(name='no_material.obj',kind:'obj'|'gltf'='obj'){
  const root=kind==='obj'?objRoot:gltfRoot,journey=JSON.parse(readFileSync(root+'/'+name+'.journey.json','utf8')),
    result=kind==='obj'?ObjResultSchema.parse(journey.accepted):GltfResultSchema.parse(journey.accepted),input=result.input,
    bytes=Buffer.from(JSON.stringify(result)),hash=sha256(bytes),nativeBytes=readFileSync(root+'/'+name+'.native.json'),
    key=kind==='obj'?objResultKey(input.jobId,hash):gltfResultKey(input.jobId,hash);
  assert.equal(nativeBytes.length,result.artifact.bytes);assert.equal(sha256(nativeBytes),result.artifact.sha256);
  const retained=journey.objectHashes.find((entry:any)=>entry.key===key);assert(retained);assert.equal(retained.bytes,bytes.length);assert.equal(retained.sha256,hash);
  const manifest=JSON.parse(readFileSync(new URL('../docs/evidence/usp/native-'+kind+'/sources.json',import.meta.url),'utf8')),
    entry=(manifest.originals??manifest.sources).find((entry:any)=>entry.sha256===input.sourceSha256),
    originalPath=entry?.path??('E:/BhuAayam-data/task-data/desktop-gltf-native/originals/'+name),original=readFileSync(originalPath);
  assert.equal(original.length,input.sourceBytes);assert.equal(sha256(original),input.sourceSha256);
  const current={id:input.caseId,revision:input.caseRevision,archived:false,frame:null,context:null,site_id:null,current_snapshot_id:null},
    binding=ingestionBinding(input.caseId);assert.equal(binding.subject,input.subject);assert.equal(binding.access,input.accessSha256);
  const marker=(kind==='obj'?ObjOriginalSchema:GltfOriginalSchema).parse({version:input.version,subject:input.subject,accessSha256:input.accessSha256,
    sha256:input.sourceSha256,bytes:input.sourceBytes,receivedAt:result.createdAt,lineageState:'caller_declared',
    lineage:{issuer:null,originalUrl:null,acquiredAt:null,permissionReference:null,geography:null,limitations:['in-memory authority controls; unchanged retained test_only original']}}),
    source:any={id:input.sourceId,case_id:input.caseId,family_id:input.sourceFamilyId,revision:input.sourceRevision,
      profile:kind+'-native-v1',sha256:input.sourceSha256,bytes:input.sourceBytes,object_key:input.objectKey,status:'ready',inspection:{[kind+'Original']:marker}},
    job:any={id:input.jobId,case_id:input.caseId,source_id:input.sourceId,operation:kind+'-native',case_revision:input.caseRevision,payload:input,
      input_fingerprint:fingerprint(input),input_sha256:fingerprint(input),status:'succeeded',logical_state:'succeeded',
      result_ref:{assetId:`${kind}:${input.jobId}:${bytes.length}`,version:1,sha256:hash},accepted_fence:1,attempt_state:'accepted',attempt_fence:1,
      attempt_input_sha256:fingerprint(input),completion_sha256:hash,error:null},
    state={operations:new Map<string,any>(),writes:0,reads:0,tools:0,events:0,sequence:0,unavailable:false,jobPresent:true,revokeDuringRead:false,driftDuringRead:false};
  const client={query:async(sql:string,args:any[]=[])=>{
    let rows:any[]=[];
    assert(!sql.startsWith('SET TRANSACTION'),'Deadline transaction guard precedes callback SQL; isolation must not change late.');
    if(sql.includes('pg_advisory_xact_lock')||sql.startsWith('SELECT id FROM cases'))rows=[];
    else if(sql.includes('SELECT id,revision,archived,site_id,current_snapshot_id'))rows=[{id:current.id,revision:current.revision,archived:current.archived,site_id:current.site_id,current_snapshot_id:null,
      frame_sha:fingerprint(current.frame),context_sha:fingerprint(current.context)}];
    else if(sql.includes('SELECT id,revision,archived,frame,context,site_id FROM cases'))rows=[current];
    else if(sql.startsWith('SELECT revision FROM cases'))rows=[{revision:current.revision}];
    else if(sql.includes('FROM sources')&&sql.includes('ORDER BY id LIMIT 257'))rows=[{...source,owner:input.subject,inspection_sha:fingerprint(source.inspection),object_sha:fingerprint(source.object_key)}];
    else if(sql.includes('FROM sources')&&sql.includes('has_parts'))rows=[{...source,manual:null,projected:null,document_original:null,has_parts:false}];
    else if(sql.includes('SELECT max(revision)'))rows=[{revision:source.revision}];
    else if(sql.includes('FROM sources'))rows=[source];
    else if(sql.includes('FROM usp_mapping_recipes')||sql.includes('FROM import_packages')||sql.includes('FROM map_areas')||sql.includes('FROM registry_case_feature_mappings')||sql.includes('FROM physical_features'))rows=[];
    else if(sql.startsWith('SELECT id FROM jobs'))rows=state.jobPresent?[{id:job.id}]:[];
    else if(sql.includes('FROM jobs'))rows=state.jobPresent?[job]:[];
    else if(sql.includes('FROM usp_ingestion_questions'))rows=sql.includes('count(*)')?[{n:0}]:[];
    else if(sql.includes('SELECT payload_hash,result FROM operations'))rows=state.operations.has(args[1])?[state.operations.get(args[1])]:[];
    else if(sql.includes('SELECT result FROM operations'))rows=[...state.operations.values()].reverse();
    else if(sql.startsWith('INSERT INTO operations')){state.operations.set(args[1],{payload_hash:args[3],result:args[4]});state.writes++;}
    else if(sql.startsWith('INSERT INTO usp_outbox_streams'))state.writes++;
    else if(sql.startsWith('UPDATE usp_outbox_streams')){state.writes++;rows=[{sequence:String(++state.sequence)}];}
    else if(sql.startsWith('INSERT INTO usp_outbox(')){state.writes++;state.events++;}
    else assert.fail('Unexpected sufficiency control SQL: '+sql);
    return {rows:structuredClone(rows),rowCount:rows.length};
  }} as PoolClient;
  const mesh={objTools:()=>{state.tools++;if(state.unavailable)throw new AppError(503,'OBJ_TOOL_CHANGED','controlled unavailable profile');},
    gltfTools:()=>{state.tools++;if(state.unavailable)throw new AppError(503,'GLTF_TOOL_CHANGED','controlled unavailable profile');},
    read:(objectKey:string,size:number,digest:string,budget:any)=>readFusionObject(objectKey,size,digest,budget,async()=>{
      assert.equal(objectKey,key);state.reads++;if(state.revokeDuringRead)current.archived=true;
      if(state.driftDuringRead)job.result_ref.sha256='a'.repeat(64);
      return {body:Readable.from([bytes]),etag:'control'};
    })},
    service=new IngestionSufficiencyService({transaction:async(action:any,bounds:any)=>{assert(Number.isFinite(bounds.deadlineAt));assert(bounds.signal instanceof AbortSignal);return action(client);},mesh} as any),
    request={requestKey:id(1),expectedCaseRevision:input.caseRevision,expectedSourceRevision:input.sourceRevision,sourceSha256:input.sourceSha256,
      tasks:['retain_evidence','inspect_native_context','context_2d','building_massing','spatial_analysis']};
  return {service,client,mesh,result,bytes,hash,nativeBytes,original,source,job,state,current,request,input};
}
function save(name:string,value:unknown){const root=process.env.ULPIN_MESH_SUFFICIENCY_PROOF_DIR;if(root)
  writeFileSync(root+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}

test('exact complete and partial OBJ metadata evaluate/read/replay through existing sufficiency while spatial tasks remain unqualified',()=>local('obj-protocol-control',async()=>{
  for(const name of ['no_material.obj','missing_material_file.obj']){
    const f=fixture(name),result=await f.service.evaluate(f.input.caseId,f.input.sourceId,f.request);assert(SufficiencyResultSchema.safeParse(result).success);
    assert.equal(result.questions.length,0);assert.deepEqual(result.decisions.map(d=>d.outcome),['complete','complete','park','reject_for_3d','park']);
    const native=result.decisions[1].processing!;assert.equal(native.nativeStatus,f.result.summary.status);assert.equal(native.mesh!.kind,'obj');
    assert.deepEqual(native.mesh!.metadata!.summary,f.result.summary);assert.equal(native.mesh!.acceptedFence,1);assert.equal(native.resultSha256,f.hash);
    assert.equal(native.mesh!.coverage,'accepted_result_metadata_only; native_artifact_not_read');assert.equal(native.modelStatus,null);
    assert.equal(native.mesh!.metadata!.summary.analyticEligible,false);assert.equal(native.mesh!.metadata!.summary.learningLabels,false);
    if(name==='missing_material_file.obj')assert.equal((native.mesh!.metadata!.summary as any).missingCompanionDeclarationCount,10);
    const writes=f.state.writes;assert.deepEqual(await f.service.evaluate(f.input.caseId,f.input.sourceId,f.request),result);assert.equal(f.state.writes,writes);
    const needs=await f.service.needsInput(f.input.caseId);assert(NeedsInputSchema.safeParse(needs).success);assert.equal(needs.questions.length,0);
    assert.deepEqual(needs.decisions.map(d=>d.outcome),result.decisions.map(d=>d.outcome));assert.equal(f.state.writes,writes);
    const before=structuredClone(result);f.job.result_ref.sha256='a'.repeat(64);f.job.completion_sha256='a'.repeat(64);f.state.unavailable=true;
    const stale=await f.service.needsInput(f.input.caseId);assert(stale.decisions.every(d=>d.availability==='stale'));assert.equal(f.state.writes,writes);
    await assert.rejects(()=>f.service.evaluate(f.input.caseId,f.input.sourceId,f.request),(e:any)=>e.status===409);assert.equal(f.state.writes,writes);
    assert.deepEqual(result,before);save(name+'.controlled-journey.json',{qualification:'Exact retained accepted input/result/native/original; in-memory source/case/SQL/storage/tool admission controls, not live installation.',
      result,needs,stale,accepted:f.result,retainedResultSha256:f.hash,nativeSha256:sha256(f.nativeBytes),sourceSha256:sha256(f.original),writesBeforeAndAfterStale:[writes,f.state.writes],reads:f.state.reads,events:f.state.events,nativeRuns:0,liveWrites:0});
  }
}));

test('mesh originals survive unavailable processing; protected markers and final access/result changes refuse; existing policies stay intact',()=>local('obj-protocol-control',async()=>{
  const f=fixture();f.state.unavailable=true;
  const unavailable=await f.service.evaluate(f.input.caseId,f.input.sourceId,f.request);
  assert.equal(unavailable.decisions[0].outcome,'complete');assert.equal(unavailable.decisions[1].nextAction,'configure_reader');assert.equal(f.state.reads,0);
  for(const [state,logical,next] of [['queued','pending','wait_for_extraction'],['running','running','wait_for_extraction'],['failed','failed','retry_extraction']] as const){
    f.job.status=state;f.job.logical_state=logical;
    const value=await f.service.evaluate(f.input.caseId,f.input.sourceId,{...f.request,requestKey:id(f.state.writes+10)});
    assert.equal(value.questions.length,0);assert.equal(value.decisions[0].outcome,'complete');assert.equal(value.decisions[1].nextAction,next);
  }
  for(const change of ['revokeDuringRead','driftDuringRead'] as const){const denied=fixture();denied.state[change]=true;
    await assert.rejects(()=>denied.service.evaluate(denied.input.caseId,denied.input.sourceId,denied.request),(e:any)=>e.status===(change==='revokeDuringRead'?403:409));
    assert.equal(denied.state.writes,0);}
  const marker=fixture();marker.source.inspection.objOriginal=null;
  await assert.rejects(()=>sufficiencyCaseTx(marker.client,marker.input.caseId),(e:any)=>e.status===403);assert.equal(marker.state.reads,0);
  const original=f.result.input,policy={row:{id:original.sourceId,revision:1,profile:'geojson-manual-v1',manual:{geometryTypes:['Polygon']}},supported:true,latest:true,
    recipe:null,exactRecipe:false,features:[],allQualified:false,projectedAccepted:false,scope:{packageBodies:[]},document:null,mesh:null} as any;
  assert.equal(assessSufficiency(policy,'context_2d').nextAction,'review_mapping');assert.equal(assessSufficiency(policy,'retain_evidence').outcome,'complete');
  assert.equal(assessSufficiency({...policy,document:{processing:{state:'needs_ocr',modelStatus:null}}},'spatial_analysis').nextAction,'run_ocr');
  save('denials-and-controls.json',{qualification:'SQL/storage/tool/status/policy controls',unavailable,pendingRunningFailed:'original complete, inspect parks without questions',
    revokedAccess:'403 zero writes',changedResult:'409 zero writes',nullProtectedMarker:'403 before private read',documentAndVectorPolicy:'unchanged targeted controls'});
}));

test('retained glTF identity mismatch is honestly stale while the original remains useful',()=>local('gltf-protocol-control',async()=>{
  const f=fixture('Box.gltf','gltf'),result=await f.service.evaluate(f.input.caseId,f.input.sourceId,f.request);
  assert.equal(result.decisions[0].outcome,'complete');assert.equal(result.decisions[1].processing!.state,'stale');
  assert.equal(result.decisions[1].availability,'stale');assert.equal(f.state.reads,0);assert.equal(f.state.tools,0);
  save('gltf-stale-original.json',{qualification:'Exact retained glTF input/result identity is stale under the measured current raw reader; no alias/envelope manufacture/native rerun.',result,retainedInput:f.input,retainedResultSha256:f.hash,nativeSha256:sha256(f.nativeBytes),sourceSha256:sha256(f.original)});
}));

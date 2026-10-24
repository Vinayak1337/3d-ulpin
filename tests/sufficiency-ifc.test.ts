import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import type {PoolClient} from 'pg';
import {IFCOriginalSchema,IFCSummarySchema} from '../packages/contracts/src/usp/ifc-ingestion';
import {SufficiencyResultSchema,NeedsInputSchema,SufficiencyProcessingSchema} from '../packages/contracts/src/usp/sufficiency';
import {IngestionSufficiencyService} from '../packages/server/src/modules/usp/ingestion/sufficiency';
import {sufficiencyCaseTx} from '../packages/server/src/modules/usp/ingestion/sufficiency-context';
import {sufficiencyIFCOriginalTx} from '../packages/server/src/modules/usp/ingestion/sufficiency-ifc';
import {assessSufficiency} from '../packages/server/src/modules/usp/ingestion/sufficiency-policy';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// No accepted IFC input/result envelope was retained by IFC-02/FUSION-IFC-01.
// This check never fabricates one. Unchanged real originals/native metadata are
// used with disclosed in-memory source/case/SQL controls; no live writes/reader.
const root='E:/BhuAayam-data/task-data/desktop-ifc-native',id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function local(work:()=>Promise<void>){const previous=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='ifc-sufficiency-control';try{await work();}finally{
    if(previous===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=previous;}}
function save(name:string,value:unknown){const proof=process.env.ULPIN_IFC_SUFFICIENCY_PROOF_DIR;
  if(proof)writeFileSync(proof+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
function fixture(){
  const original=readFileSync(root+'/originals/ifc2x3-building-architecture.ifc');
  assert.equal(original.length,92542);assert.equal(sha256(original),'c4db65ba847f6b369a95d6c54fa11f4750cbe6d59f021934e8923d8d578e5885');
  const current={id:id(1),revision:1,archived:false,frame:null,context:null,site_id:null},binding=ingestionBinding(current.id),
    marker=IFCOriginalSchema.parse({version:'ifc-native/1',subject:binding.subject,accessSha256:binding.access,
      sha256:sha256(original),bytes:original.length,receivedAt:'2026-10-01T00:00:00Z',lineageState:'caller_declared',
      lineage:{issuer:null,originalUrl:null,acquiredAt:null,permissionReference:null,geography:null,
        limitations:['in-memory receipt authority; unchanged test_only certification original']}}),
    source:any={id:id(2),case_id:current.id,family_id:id(2),revision:1,sha256:marker.sha256,profile:'ifc-native-v1',
      bytes:original.length,object_key:`sources/${id(2)}/${marker.sha256}`,status:'received',inspection:{ifcOriginal:marker}},
    state={writes:0,privateReads:0,tools:0,events:0,sequence:0,scopeReads:0,denyFinal:false,operations:new Map<string,any>(),calls:[] as string[]};
  const client={query:async(sql:string,args:any[]=[])=>{
    state.calls.push(sql);let rows:any[]=[];
    if(sql.includes('pg_advisory_xact_lock')||sql.startsWith('SELECT id FROM sources')||sql.startsWith('SELECT id FROM jobs')||sql.startsWith('SELECT job_id FROM usp_job_')){}
    else if(sql.includes('SELECT id,revision,archived,site_id,current_snapshot_id')){
      state.scopeReads++;if(state.denyFinal&&state.scopeReads===2)current.archived=true;
      rows=[{id:current.id,revision:current.revision,archived:current.archived,site_id:current.site_id,current_snapshot_id:null,
        frame_sha:fingerprint(current.frame),context_sha:fingerprint(current.context)}];
    }else if(sql.includes('SELECT id,revision,archived,frame,context,site_id FROM cases'))rows=[current];
    else if(sql.startsWith('SELECT revision FROM cases'))rows=[{revision:current.revision}];
    else if(sql.includes('SELECT max(revision)'))rows=[{revision:source.revision}];
    else if(sql.includes('FROM sources')&&sql.includes('ORDER BY id LIMIT 257'))rows=[{...source,owner:binding.subject,inspection_sha:fingerprint(source.inspection),object_sha:fingerprint(source.object_key)}];
    else if(sql.includes('FROM sources')&&sql.includes('has_parts'))rows=[{...source,manual:null,projected:null,document_original:null,has_parts:false}];
    else if(sql.includes('FROM sources'))rows=[source];
    else if(sql.includes('FROM jobs')||sql.includes('FROM usp_mapping_recipes')||sql.includes('FROM import_packages')||sql.includes('FROM map_areas')||sql.includes('FROM registry_case_feature_mappings')||sql.includes('FROM physical_features')){}
    else if(sql.includes('FROM usp_ingestion_questions'))rows=sql.includes('count(*)')?[{n:0}]:[];
    else if(sql.includes('SELECT payload_hash,result FROM operations'))rows=state.operations.has(args[1])?[state.operations.get(args[1])]:[];
    else if(sql.includes('SELECT result FROM operations'))rows=[...state.operations.values()].reverse();
    else if(sql.startsWith('INSERT INTO operations')){state.operations.set(args[1],{payload_hash:args[3],result:args[4]});state.writes++;}
    else if(sql.startsWith('INSERT INTO usp_outbox_streams'))state.writes++;
    else if(sql.startsWith('UPDATE usp_outbox_streams')){state.writes++;rows=[{sequence:String(++state.sequence)}];}
    else if(sql.startsWith('INSERT INTO usp_outbox(')){state.writes++;state.events++;}
    else assert.fail('Unexpected IFC sufficiency SQL: '+sql);
    return {rows:structuredClone(rows),rowCount:rows.length};
  }} as PoolClient;
  const service=new IngestionSufficiencyService({transaction:async(action:any,bounds:any)=>{
    assert(Number.isFinite(bounds.deadlineAt));assert(bounds.signal instanceof AbortSignal);return action(client);
  },ifc:{read:async()=>{state.privateReads++;assert.fail('No accepted IFC envelope: private read forbidden.');},
    tools:()=>{state.tools++;assert.fail('Original retention does not require a configured tool.');}}} as any),
    request={requestKey:id(3),expectedCaseRevision:1,expectedSourceRevision:1,sourceSha256:marker.sha256,
      tasks:['retain_evidence','inspect_native_context','context_2d','building_massing','spatial_analysis']};
  return {service,client,current,source,marker,state,request};
}

test('retained IFC original evaluates, reads and replays without extraction/tools; spatial tasks stay unqualified',()=>local(async()=>{
  const f=fixture(),before=structuredClone(f.source),result=await f.service.evaluate(f.current.id,f.source.id,f.request);
  assert(SufficiencyResultSchema.safeParse(result).success);assert.equal(result.questions.length,0);
  assert.deepEqual(result.decisions.map(d=>d.outcome),['complete','park','park','reject_for_3d','park']);
  const processing=result.decisions[1].processing!;assert.equal(processing.state,'pending');assert.equal(processing.jobId,null);
  assert.equal(processing.nativeStatus,null);assert.equal(processing.modelStatus,null);assert.equal(processing.mesh,undefined);
  assert.equal(processing.ifc!.summary,null);assert.equal(processing.ifc!.tools,'not_checked');
  assert.equal(processing.ifc!.sourceUnits,'native_artifact_not_read');assert.equal(processing.ifc!.coverage,'accepted_result_metadata_only; native_artifact_not_read');
  assert.equal(result.decisions[1].nextAction,'process_source');
  const writes=f.state.writes;assert.deepEqual(await f.service.evaluate(f.current.id,f.source.id,f.request),result);
  const needs=await f.service.needsInput(f.current.id);assert(NeedsInputSchema.safeParse(needs).success);
  assert.deepEqual(needs.decisions,result.decisions);assert.equal(f.state.writes,writes);assert.deepEqual(f.source,before);
  assert.equal(f.state.privateReads,0);assert.equal(f.state.tools,0);
  f.current.revision++;const stale=await f.service.needsInput(f.current.id);assert(stale.decisions.every(d=>d.availability==='stale'));
  await assert.rejects(()=>f.service.evaluate(f.current.id,f.source.id,f.request),(e:any)=>e.status===409);assert.equal(f.state.writes,writes);
  save('retention-read-replay.json',{qualification:'Real unchanged original; disclosed SQL/source/case controls, no accepted input/result envelope or live writes.',
    result,needs,stale,writes,events:f.state.events,privateReads:f.state.privateReads,tools:f.state.tools,sourceSha256:f.source.sha256});
}));

test('malformed/copied/ambiguous captured and current IFC authorities and final access recapture refuse before writes',()=>local(async()=>{
  const f=fixture();
  for(const marker of [null,false,0,'',{}]){
    f.source.inspection={ifcOriginal:marker};await assert.rejects(()=>sufficiencyCaseTx(f.client,f.current.id),(e:any)=>e.status===403);
  }
  f.source.inspection={ifcOriginal:f.marker};
  for(const extra of [{objOriginal:null},{gltfOriginal:{}},{documentOriginal:null},{copiedFrom:null}]){
    const captured={...f.source,inspection:{...f.source.inspection,...extra}};
    await assert.rejects(()=>sufficiencyIFCOriginalTx(f.client,captured),(e:any)=>e.status===403);
    f.source.inspection=captured.inspection;await assert.rejects(()=>sufficiencyCaseTx(f.client,f.current.id),(e:any)=>e.status===403);
    f.source.inspection={ifcOriginal:f.marker};
  }
  await assert.rejects(()=>sufficiencyIFCOriginalTx(f.client,{...f.source,profile:'plan-pdf-v1',inspection:{}}),(e:any)=>e.status===409);
  f.source.inspection.ifcOriginal={...f.marker,subject:'revoked'};
  await assert.rejects(()=>f.service.evaluate(f.current.id,f.source.id,f.request),(e:any)=>e.status===403);
  const final=fixture();final.state.denyFinal=true;
  await assert.rejects(()=>final.service.evaluate(final.current.id,final.source.id,final.request),(e:any)=>e.status===403);
  assert.equal(final.state.writes,0);assert.equal(final.state.privateReads,0);assert.equal(f.state.writes,0);
  save('authority-denials.json',{malformedNullCapturedCurrent:'refused',copiedAmbiguous:'403',capturedLegacyCurrentIFC:'409',
    revokedSubject:'403',finalArchivedCase:'403 zero writes',privateReads:0});
}));

test('metadata contract preserves retained producer counts/caveats and policy states; document/mesh controls remain compatible',()=>local(async()=>{
  const bytes=readFileSync(root+'/outputs/final/ifc2x3.json');assert.equal(sha256(bytes),'66dcfb321cac47b605ffed87beaf060b50b1203a151b738fe446b6251d003d3a');
  const native=JSON.parse(bytes.toString('utf8')),count=(type:string)=>native.records.filter((record:any)=>record.entityType===type).length,
    summary=IFCSummarySchema.parse({schemaVersion:native.schemaVersion,sourceSha256:native.source.sha256,sourceBytes:native.source.bytes,
      schema:native.source.schema,entityCount:native.counts.sourceEntities,recordCount:native.counts.projectedRecords,
      buildingCount:count('IfcBuilding'),storeyCount:count('IfcBuildingStorey'),spaceCount:count('IfcSpace'),
      georeferenceState:native.georeference.state,inspectionFrame:'source_local',metadataOnly:true,geometry:'unsupported',
      globalPlacement:'not_qualified',unitConversionApplied:false,storeysAreLegalUnits:false,rights:'not_assessed'}),
    policy={row:{id:id(2),revision:1,profile:'ifc-native-v1'},supported:true,latest:true,recipe:null,exactRecipe:false,
      features:[],allQualified:false,projectedAccepted:false,scope:{packageBodies:[]},document:null,mesh:null} as any;
  const processing=(state:string,metadata:typeof summary|null=null)=>SufficiencyProcessingSchema.parse({state,jobId:null,resultSha256:null,
    nativeStatus:null,modelStatus:null,ifc:{inputSha256:null,readerSha256:null,acceptedFence:null,tools:'not_checked',code:null,summary:metadata,
      sourceUnits:'native_artifact_not_read',coverage:'accepted_result_metadata_only; native_artifact_not_read'}});
  // Policy/schema control only; this is deliberately NOT a canonical accepted-result journey.
  assert.equal(assessSufficiency({...policy,ifc:{processing:processing('inspected_metadata',summary)}},'inspect_native_context').outcome,'complete');
  for(const [state,next] of [['unavailable','configure_reader'],['stale','retry_extraction'],['failed','retry_extraction'],['running','process_source']] as const){
    const ctx={...policy,ifc:{processing:processing(state)}};
    assert.equal(assessSufficiency(ctx,'retain_evidence').outcome,'complete');assert.equal(assessSufficiency(ctx,'inspect_native_context').nextAction,next);
  }
  const doc={...policy,ifc:null,document:{processing:{state:'needs_ocr',modelStatus:null}}};assert.equal(assessSufficiency(doc,'spatial_analysis').nextAction,'run_ocr');
  const mesh={...policy,ifc:null,mesh:{processing:{state:'pending',jobId:null}}};assert.equal(assessSufficiency(mesh,'context_2d').nextAction,'review_conversion');
  assert.equal(assessSufficiency({...policy,ifc:null,row:{...policy.row,profile:'geojson-manual-v1',manual:{geometryTypes:['Polygon']}}},'context_2d').nextAction,'review_mapping');
  save('metadata-policy-controls.json',{qualification:'Producer metadata/schema/policy control only; no fabricated current IFC input/result.',summary,
    sourceUnits:'native_artifact_not_read',acceptedResultJourney:'unqualified: exact accepted input/result envelope not retained'});
}));

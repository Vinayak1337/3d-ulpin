import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import type { ImportPackage } from '@ulpin/contracts';
import type { OfficerAiRun } from '../../apps/web/lib/officer-ai-types';
import { ingestArea, attachDocument, areaContext, getPackage } from '../../apps/web/lib/server/areas';
import { migrateOfficerAi, officerAiRoutes } from '../../apps/web/lib/server/officer-ai';
import { query, transaction, pool } from '../../apps/web/lib/server/db';
import { removeOrphan } from '../../apps/web/lib/server/storage';

// All sources and all model responses in this test are explicitly synthetic.
// The provider is mocked in-process, never contacted with a test credential.
const id=randomUUID(),name=`Synthetic AI integration ${id}`,originalFetch=globalThis.fetch;
const oldKey=process.env.NOUS_API_KEY,oldModel=process.env.NOUS_MODEL;
const evidence:{checks:string[];kind:string;actualInferenceRuns:number;cleaned?:boolean;areaId?:string}={checks:[],kind:'Scoped synthetic DB/API test with mocked Nous transport; not an inference accuracy benchmark.',actualInferenceRuns:0};
let pkg:ImportPackage|undefined,providerCalls=0,catalogCalls=0,repairNext=false,imagesSeen=0;
let mockGeometry:{value:unknown;quote:string;frame:string}|undefined;
const pass=(message:string)=>{evidence.checks.push(message);console.log(`PASS ${message}`);};
async function route<T>(path:string,body?:unknown):Promise<T>{
 const response=await officerAiRoutes(new Request(`http://localhost/api/v1/${path}`,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined}),path.split('/'));
 assert(response);assert(response.ok);return response.json();
}
function png(){
 const crc=(b:Buffer)=>{let c=0xffffffff;for(const x of b){c^=x;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 const chunk=(type:string,data:Buffer)=>{const t=Buffer.from(type),length=Buffer.alloc(4),check=Buffer.alloc(4);length.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([length,t,data,check]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(2,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,255,255,255,255,255,255,0,255,255,255,255,255,255]))),chunk('IEND',Buffer.alloc(0))]);
}
try {
 await migrateOfficerAi();
 pkg=await ingestArea({bytes:Buffer.from(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{id:'SYNTHETIC'},geometry:{type:'Polygon',coordinates:[[[77,28],[77.0001,28],[77.0001,28.0001],[77,28.0001],[77,28]]]}}]})),filename:'synthetic-ai-footprint.geojson',format:'geojson',namespace:`synthetic-ai:${id}`,name,mapping:{idField:'id',kind:'building'},worldStatus:'synthetic'});
 evidence.areaId=pkg.areaId;
 pkg=await attachDocument(pkg.id,pkg.revision,{bytes:Buffer.from(`Synthetic reference document. Building ${pkg.features[0].sourceKey}. Floor count 3. No actual survey measurement.`),name:'synthetic-ai-reference.txt',format:'text',entityIds:[pkg.features[0].id]});
 const part=pkg.parts.find(p=>p.text.includes('Floor count'))!;
 const input=()=>({expectedRevision:pkg!.revision,partIds:[part.id],entityIds:[pkg!.features[0].id],requestKey:randomUUID()});
 const path=`import-packages/${pkg.id}/ai-extractions`;
 delete process.env.NOUS_API_KEY;delete process.env.NOUS_MODEL;
 const blockedInput=input(),blocked=await route<OfficerAiRun>(path,blockedInput);
 assert.equal(blocked.state,'blocked');assert.equal(blocked.calls.length,0);assert.match(blocked.message!,/NOUS_API_KEY/);
 assert.equal((await route<OfficerAiRun>(path,blockedInput)).id,blocked.id);
 pass('Missing-key attempt is persisted, idempotent and performs zero inference calls.');
 globalThis.fetch=(async(url,init)=>{
  const address=String(url);
  if(!address.startsWith('https://inference-api.nousresearch.com/'))return originalFetch(url,init);
  assert.equal(init?.redirect,'error');
  if(address.endsWith('/models')){catalogCalls++;return Response.json({data:[{id:'synthetic-test:free',pricing:{prompt:'0',completion:'0'},supported_parameters:['response_format','structured_outputs'],architecture:{input_modalities:['text','image']}}]});}
  assert(address.endsWith('/chat/completions'));providerCalls++;
  const body=JSON.parse(String(init?.body));assert.equal(body.model,'synthetic-test:free');assert.equal(body.tools,undefined);
  const content=body.messages[1].content;
  if(Array.isArray(content))imagesSeen+=content.filter((c:any)=>c.type==='image_url').length;
  const source=JSON.parse(Array.isArray(content)?content[0].text:content);
  const selected=source.selectedParts[0];
  const output={candidates:[{entityId:pkg!.features[0].id,subject:mockGeometry?'synthetic-space':'building',property:mockGeometry?'space.geometry':'building.floorCount',value:mockGeometry?.value??(repairNext?999:3),unit:mockGeometry?'m':'count',...(mockGeometry?{referenceFrameId:mockGeometry.frame}:{}),citations:[{partId:selected.id,quote:mockGeometry?.quote??'Floor count 3'}],rationale:'Synthetic transport response for rejection/apply tests.'}],questions:[]};
  const matchingIdentifier=source.authorizedContext.entities[0].identifiers.find((identifier:string)=>selected.text.includes(identifier));
  Object.assign(output,{suggestions:selected.text?[{kind:'source_role',partId:selected.id,role:'reference',quote:selected.text.slice(0,1000),rationale:'Synthetic source role test.'},...(matchingIdentifier?[{kind:'entity_association',partId:selected.id,entityId:pkg!.features[0].id,matchedIdentifier:matchingIdentifier,quote:selected.text.slice(0,1000),rationale:'Explicit synthetic building identifier in source.'}]:[])]:[]});
  repairNext=false;
  return Response.json({id:`synthetic-response-${providerCalls}`,choices:[{message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:50,completion_tokens:25}});
 }) as typeof fetch;
 process.env.NOUS_API_KEY='synthetic-test-transport-only';
 const first=await route<OfficerAiRun>(path,input());assert.equal(first.state,'succeeded');assert.equal(first.candidates.length,1);assert.equal(providerCalls,1);assert.equal(first.candidates[0].worldStatus,'synthetic');assert.equal(first.calls[0].outputTokens,25);
 pass('Mocked free-route output creates an unresolved source-linked candidate with usage/hash provenance.');
 const second=await route<OfficerAiRun>(path,input());assert.equal(second.cached,true);assert.equal(second.cachedFromRunId,first.id);assert.equal(providerCalls,1);
 delete process.env.NOUS_API_KEY;const beforeCatalog=catalogCalls;
 assert.equal((await route<OfficerAiRun>(path,{...input(),mode:'cached'})).cached,true);assert.equal(catalogCalls,beforeCatalog);
 pass('Exact revision/source cache reopens offline without catalog or inference calls.');
 const stored=await route<OfficerAiRun>(`${path}/${first.id}`);assert.equal(stored.suggestions?.length,2);assert.equal(stored.suggestions?.[0].evidenceState,'unresolved');assert.equal(stored.suggestions?.[0].partId,part.id);assert.equal(stored.suggestions?.[1].entityId,pkg.features[0].id);assert.deepEqual(second.suggestions,first.suggestions);assert.deepEqual((await getPackage(pkg.id)).parts,pkg.parts);assert.equal((await getPackage(pkg.id)).factCandidates.length,pkg.factCandidates.length);
 pass('Role and entity-association proposals persist/reopen/cache with exact source locators and never change source associations or facts.');
 const before=await areaContext(pkg.areaId);
 pkg=await route<ImportPackage>(`${path}/${first.id}/apply`,{expectedRevision:pkg.revision,candidateIds:[first.candidates[0].id]});
 assert.equal(pkg.factCandidates.filter(c=>c.method==='ai_extraction').length,1);assert.equal(pkg.selectedClaimIds?.length??0,0);
 assert.deepEqual((await areaContext(pkg.areaId)).features,before.features);
 assert.equal((await route<ImportPackage>(`${path}/${first.id}/apply`,{expectedRevision:first.packageRevision,candidateIds:[first.candidates[0].id]})).revision,pkg.revision);
 await assert.rejects(route(`${path}/${second.id}/apply`,{expectedRevision:second.packageRevision,candidateIds:[second.candidates[0].id]}),/changed|revision/i);
 pass('Apply changes draft facts only, is retry-safe, and refuses a stale cached run after a human/draft revision.');
 process.env.NOUS_API_KEY='synthetic-test-transport-only';repairNext=true;
 const repaired=await route<OfficerAiRun>(path,input());assert.equal(repaired.calls.length,2);assert.equal(repaired.candidates[0].value,3);
 pass('One malformed/unsupported output gets exactly one repair; unsupported numeric guesses do not survive.');
 pkg=await attachDocument(pkg.id,pkg.revision,{bytes:png(),name:'synthetic-white-pixel-test.png',format:'png',entityIds:[pkg.features[0].id]});
 const imagePart=pkg.parts.find(p=>p.sourceRevisionId===pkg!.sourceRevisionIds.at(-1))!;
 const imageRun=await route<OfficerAiRun>(path,{...input(),partIds:[imagePart.id],imageRegions:[{partId:imagePart.id,region:{x:0,y:0,width:.5,height:1}}],imageContentApproved:true});
 assert.equal(imageRun.derivatives?.length,1,JSON.stringify({state:imageRun.state,message:imageRun.message}));assert.equal(imageRun.derivatives![0].width,1);assert.equal(imageRun.derivatives![0].height,2);assert.equal(imagesSeen,1);
 const derivativeResponse=await officerAiRoutes(new Request(`http://localhost/api/v1/${path}/${imageRun.id}/derivatives/${imagePart.id}`),`${path}/${imageRun.id}/derivatives/${imagePart.id}`.split('/'));
 assert(derivativeResponse?.ok);const bytes=new Uint8Array(await derivativeResponse.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),imageRun.derivatives![0].sha256);
 assert.equal(imageRun.candidates[0].evidence[0].region?.width,.5);assert.match(imageRun.candidates[0].rationale,/Unverified image transcription/);
 pass('Actual private PNG crop, crop bytes/hash/region persistence and reopening work; mocked image transcription stays explicitly unverified.');
 const frame=(await query('SELECT frame FROM registry_sites WHERE id=$1',[pkg.areaId])).rows[0].frame.id;
 const shape={type:'Polygon',coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[2,2],[2,4],[4,4],[4,2],[2,2]]]};
 mockGeometry={value:shape,quote:`frame: ${frame}; unit: m; ${JSON.stringify(shape)}`,frame};
 pkg=await attachDocument(pkg.id,pkg.revision,{bytes:Buffer.from(mockGeometry.quote),name:'synthetic-measured-outline.txt',format:'text',entityIds:[pkg.features[0].id]});
 let geometryPart=pkg.parts.find(p=>p.sourceRevisionId===pkg!.sourceRevisionIds.at(-1))!;
 const geometryRun=await route<OfficerAiRun>(path,{...input(),partIds:[geometryPart.id]});assert.equal(geometryRun.state,'succeeded');assert.deepEqual(geometryRun.candidates[0].value,shape);
 pkg=await route<ImportPackage>(`${path}/${geometryRun.id}/apply`,{expectedRevision:pkg.revision,candidateIds:[geometryRun.candidates[0].id]});assert.deepEqual(pkg.factCandidates.find(f=>f.property==='space.geometry')?.value,shape);
 pass('Measured source geometry passes native topology, retains courtyard and frame, and applies only as an unresolved draft outline.');
 const invalid={type:'Polygon',coordinates:[shape.coordinates[0],[[20,20],[20,22],[22,22],[22,20],[20,20]]]};
 mockGeometry={value:invalid,quote:`frame: ${frame}; unit: m; ${JSON.stringify(invalid)}`,frame};
 pkg=await attachDocument(pkg.id,pkg.revision,{bytes:Buffer.from(mockGeometry.quote),name:'synthetic-invalid-hole.txt',format:'text',entityIds:[pkg.features[0].id]});
 geometryPart=pkg.parts.find(p=>p.sourceRevisionId===pkg!.sourceRevisionIds.at(-1))!;
 const invalidRun=await route<OfficerAiRun>(path,{...input(),partIds:[geometryPart.id]});assert.equal(invalidRun.state,'needs_input');assert.equal(invalidRun.candidates.length,0);assert.equal(invalidRun.calls.length,2);assert(invalidRun.validationErrors.some(e=>e.includes('native topology')));
 pass('A quoted but topologically invalid outside-hole polygon fails PostGIS validation and the bounded repair leaves no accepted geometry.');
 assert.equal((await areaContext(pkg.areaId)).features.length,0);
 pass('No current physical observation was created by the entire AI integration test.');
} finally {
 globalThis.fetch=originalFetch;if(oldKey)process.env.NOUS_API_KEY=oldKey;else delete process.env.NOUS_API_KEY;if(oldModel)process.env.NOUS_MODEL=oldModel;else delete process.env.NOUS_MODEL;
 if(pkg){
  const keys=(await query('SELECT object_key FROM sources WHERE case_id IN (SELECT id FROM cases WHERE site_id=$1)',[pkg.areaId])).rows.map(r=>r.object_key);
  await transaction(async client=>{
   const areaId=pkg!.areaId;
   for(const sql of [
    'DELETE FROM external_identifiers WHERE feature_id IN (SELECT id FROM physical_features WHERE area_id=$1)',
    'DELETE FROM source_feature_links WHERE area_id=$1',
    'DELETE FROM physical_features WHERE area_id=$1',
    'DELETE FROM import_package_revisions WHERE package_id IN (SELECT id FROM import_packages WHERE area_id=$1)',
    'DELETE FROM import_packages WHERE area_id=$1',
    'DELETE FROM area_check_runs WHERE area_id=$1',
    'DELETE FROM area_memberships WHERE area_id=$1',
    'DELETE FROM registry_records WHERE site_id=$1',
    'DELETE FROM sources WHERE case_id IN (SELECT id FROM cases WHERE site_id=$1)',
    'DELETE FROM cases WHERE site_id=$1',
    'DELETE FROM map_areas WHERE id=$1',
    'DELETE FROM registry_sites WHERE id=$1',
   ])await client.query(sql,[areaId]);
  });
  for(const key of keys)await removeOrphan(key);
  assert.equal((await query('SELECT id FROM map_areas WHERE id=$1',[pkg.areaId])).rowCount,0);evidence.cleaned=true;
 }
 await mkdir('docs/evidence',{recursive:true});await writeFile('docs/evidence/ai-integration.json',JSON.stringify({...evidence,verifiedAt:new Date().toISOString()},null,2)+'\n');await pool().end();
}

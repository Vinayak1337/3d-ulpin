/** Import bounded public geometry and a separately labelled fictional registry.
 * Every mutation uses the running application's validation/review API. Existing
 * areas are never reset. Private local state allows explicit, safe resumption.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const source=resolve(process.argv[2]||resolve(root,'fixtures/google-uttam'));
const stage=process.argv[3]||'all';
assert(['all','context','details','residents'].includes(stage));
const runtime=resolve(root,'.runtime/google-uttam');
const statePath=resolve(runtime,'installed.json');
const base=process.env.ULPIN_TEST_BASE_URL||'http://127.0.0.1:3000';
assert.equal(new URL(base).hostname,'127.0.0.1','This integration is for the explicitly selected local app');
await mkdir(runtime,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
const spec=await json(resolve(source,'synthetic-interior-spec.json'));
const selection=await json(resolve(source,'selection-report.json'));
const state=existsSync(statePath)?await json(statePath):{version:1,createdAt:new Date().toISOString(),source,packages:{},buildings:{},requests:{},completed:[]};
assert.equal(state.source,source,'Existing import is bound to different source files');
const save=async()=>writeFile(statePath,JSON.stringify(state,null,2)+'\n');
const reason='Explicitly authored fictional Uttam Nagar scenario. No real resident, surveyed interior, approval, land title or public road reservation is asserted. Public source outlines are retained separately.';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function api(path,body,method=body===undefined?'GET':'POST'){
 const response=await fetch(base+'/api/v1'+path,{method,headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
 const text=await response.text();let value;try{value=JSON.parse(text)}catch{throw Error(`${method} ${path}: HTTP ${response.status} non-JSON response`)}
 if(!response.ok)throw Error(`${method} ${path}: HTTP ${response.status}: ${JSON.stringify(value).slice(0,2500)}`);
 return value;
}
async function requestKey(name){if(!state.requests[name]){state.requests[name]=randomUUID();await save();}return state.requests[name];}
async function current(areaId){return api(`/areas/${areaId}/context`);}
async function layer(key,file,kind,synthetic,areaId,extra={}){
 const bytes=await readFile(resolve(source,file)),sha=hash(bytes);
 const previous=state.packages[key];
 if(previous)assert.equal(previous.sha256,sha,'Input changed for '+key);
 let pkg;
 if(previous)pkg=await api(`/import-packages/${previous.id}`);
 else{
  const form=new FormData();
  form.set('file',new Blob([bytes],{type:'application/geo+json'}),file);
  form.set('format','geojson');form.set('sourceCrs','EPSG:4326');
  form.set('namespace',`google-uttam-20260917:${key}`);
  form.set('name',synthetic?'Google Uttam Nagar | FICTIONAL 3D registry':'Google Uttam Nagar | public footprints and roads');
  form.set('worldStatus',synthetic?'synthetic':'observed');
  const mapped={idField:'source_id',nameField:'name',kind,geometryRole:kind==='building'?'observed_roof_projection':'unknown',identifierFields:kind==='building'?['full_plus_code','confidence','google_area_m2','google_tile','google_csv_row','source_notice','reference_source_id','attribution','license']:['osm_way_id','highway','width','lanes','source_notice','assumed_width_m','expected_target_overlap_m2','attribution','license'],...extra};
  form.set('mapping',JSON.stringify(mapped));
  if(areaId){form.set('areaId',areaId);form.set('expectedAreaRevision',String((await current(areaId)).area.revision));}
  const response=await fetch(base+'/api/v1/import-packages',{method:'POST',body:form,signal:AbortSignal.timeout(120000)});
  pkg=await response.json();if(!response.ok)throw Error(`${file}: ${JSON.stringify(pkg)}`);
  state.packages[key]={id:pkg.id,areaId:pkg.areaId,sha256:sha,file};await save();
 }
 if(pkg.state==='COMMITTED'){console.log('PRESERVE committed '+key);return pkg;}
 for(const q of [...pkg.questions].filter(q=>!q.answer)){
  assert.equal(q.property,'building.exteriorHeight','Unexpected unresolved question requires human review');
  pkg=await api(`/import-packages/${pkg.id}/answers`,{expectedRevision:pkg.revision,questionId:q.id,answer:{choice:'keep_2d',reason:'The public source contains no measured building height. Keep the original footprint and explicitly unknown height.'}});
 }
 pkg=await api(`/import-packages/${pkg.id}/review`,{expectedRevision:pkg.revision});
 const acknowledgment=synthetic?reason:'Google Open Buildings V3 model detections and OpenStreetMap road centrelines only. Unknown heights, interiors, road widths, ground occupation and land ownership remain unknown; geometric intersections do not determine illegality.';
 pkg=await api(`/import-packages/${pkg.id}/commit`,{expectedRevision:pkg.revision,acknowledgement:acknowledgment});
 assert.equal(pkg.state,'COMMITTED');console.log(`IMPORTED ${key}: ${pkg.features.length} features to ${pkg.areaId}`);await save();return pkg;
}
async function document(pkg,buildingId,name,format,bytes){
 const entry=state.buildings[buildingId];entry.documents??={};const sha=hash(bytes);
 if(entry.documents[name]){
  assert.equal(entry.documents[name].sha256,sha,'Authored document changed: '+name);
  return api(`/import-packages/${pkg.id}`);
 }
 const form=new FormData();form.set('file',new Blob([bytes]),name);form.set('format',format);form.set('expectedRevision',String(pkg.revision));form.set('entityIds',JSON.stringify([buildingId]));
 const response=await fetch(base+`/api/v1/import-packages/${pkg.id}/documents`,{method:'POST',body:form,signal:AbortSignal.timeout(120000)});
 const next=await response.json();if(!response.ok)throw Error('Document '+name+': '+JSON.stringify(next));
 const added=next.sourceRevisionIds.filter(id=>!pkg.sourceRevisionIds.includes(id));assert.equal(added.length,1);
 entry.documents[name]={sha256:sha,sourceId:added[0]};await save();return next;
}
function schedule(detail,reference,frame){
 const rows=['alias,lower,upper,unit,benchmark,label,level,footprint_wkt,frame'];
 const occupants=[];
 for(let floor=0;floor<detail.floors;floor++)for(const room of detail.rooms){
  assert.equal(room.utm_geometry.type,'Polygon');
  const ring=room.utm_geometry.coordinates[0].map(([x,y])=>[x-reference.origin[0],y-reference.origin[1]]);
  const wkt='POLYGON (('+ring.map(p=>p.map(v=>v.toFixed(8)).join(' ')).join(', ')+'))';
  const alias=`UN-${detail.key}-${floor}-${room.alias}`;
  const resident=room.alias==='COMMON'?`DEMO residents of UN-${detail.key} floor ${floor} (fictional shared access)`:`DEMO Resident ${detail.key}${floor}${room.alias.slice(1)} (fictional occupant)`;
  const name=room.alias==='COMMON'?`DEMO shared access ${detail.key}-${floor}`:`DEMO room ${detail.key}-${floor}-${room.alias}`;
  rows.push(`${alias},${floor*3},${(floor+1)*3},m,${detail.benchmark},${name},DEMO Floor ${floor},"${wkt}",${frame}`);
  occupants.push({alias,name,party:resident,common:room.alias==='COMMON',floor,areaM2:room.area_m2,classification:'fictional_demo',rightType:'shared_use'});
 }
 return {csv:Buffer.from(rows.join('\n')+'\n'),occupants};
}
async function prepareBuilding(detail){
 const context=await current(state.demoAreaId);
 const feature=context.features.find(f=>f.sourceKey===detail.source_id);assert(feature,'Missing synthetic building '+detail.key);assert.equal(feature.worldStatus,'synthetic');
 const buildingId=feature.id;state.buildings[buildingId]??={key:detail.key,sourceId:detail.source_id,documents:{}};await save();
 const entry=state.buildings[buildingId];
 const dossier=await api(`/buildings/${buildingId}/dossier`);
 if(dossier.records.some(r=>r.kind==='space')){
  assert(entry.recorded,'An existing untracked interior must not be overwritten');console.log('PRESERVE detailed '+detail.key);return;
 }
 const prep=await api(`/buildings/${buildingId}/preparation-cases`,{expectedRevision:feature.revision,requestKey:await requestKey('prep-'+detail.key)});
 entry.preparation=prep;await save();
 let pkg=await api(`/import-packages/${prep.packageId}`);
 const generated=schedule(detail,context.area.reference,prep.placement.targetFrame);
 entry.occupants=generated.occupants;await save();
 await writeFile(resolve(runtime,`UN-${detail.key}-DEMO-levels.csv`),generated.csv);
 pkg=await document(pkg,buildingId,`UN-${detail.key}-DEMO-levels.csv`,'csv',generated.csv);
 const text=['FICTIONAL ROOM AND OCCUPANT REGISTER',reason,`Synthetic building UN-${detail.key}; assumed ${detail.floors} floors at 3 metres each.`,`Google reference: ${detail.reference_source_id}`,"No genuine street address, owner identity, resident identity or registration number is supplied.","All entries below are invented shared-use demo allocations, not ownership determinations.",...generated.occupants.map((o,index)=>`${index+1}. ${o.alias} | ${o.party} | ${o.common?'common access':'demo residential use'} | floor ${o.floor}`)].join('\n');
 await writeFile(resolve(runtime,`UN-${detail.key}-FICTIONAL-residents.txt`),text);
 pkg=await document(pkg,buildingId,`UN-${detail.key}-FICTIONAL-residents.txt`,'text',Buffer.from(text));
 pkg=await document(pkg,buildingId,`UN-${detail.key}-SYNTHETIC-plan.png`,'png',await readFile(resolve(source,`UN-${detail.key}-SYNTHETIC-plan.png`)));
 for(const fact of [...pkg.factCandidates])if(!pkg.selectedClaimIds?.includes(fact.id))pkg=await api(`/import-packages/${pkg.id}/resolve-fact`,{expectedRevision:pkg.revision,claimId:fact.id,reason});
 const latestPrep=(await api(`/buildings/${buildingId}/dossier`)).preparations.find(p=>p.packageId===pkg.id)||prep;
 await api(`/import-packages/${pkg.id}/placement`,{expectedRevision:latestPrep.revision,sourceFrame:prep.placement.targetFrame,verticalReference:detail.benchmark,verticalOffset:0,evidence:pkg.factCandidates[0].evidence,reason});
 pkg=await api(`/import-packages/${pkg.id}`);
 await api(`/import-packages/${pkg.id}/prepare-details`,{expectedRevision:pkg.revision});
 let built;
 for(let i=0;i<180;i++){
  built=await api(`/cases/${prep.caseId}`);
  if(built.model?.revision===built.case.revision)break;
  if(built.jobs[0]?.status==='failed')throw Error('Worker failed: '+JSON.stringify(built.jobs[0]));
  await pause(500);
 }
 assert.equal(built.model?.revision,built.case.revision,'Computed model timed out');assert.equal(built.model.units.length,generated.occupants.length);
 const review=await api(`/buildings/${buildingId}/detail-review`,{expectedRevision:built.case.revision});
 const blocking=review.findings.filter(f=>f.severity==='error');assert.equal(blocking.length,0,JSON.stringify(blocking));
 await api(`/registry-reviews/${review.id}/commit`,{acknowledgement:reason});
 entry.recorded={at:new Date().toISOString(),reviewId:review.id,spaces:generated.occupants.length};await save();
 console.log(`RECORDED synthetic UN-${detail.key}: ${detail.floors} floors, ${generated.occupants.length} spaces through actual worker and registry review`);
}
function bodyOnly(record){
 const {id,siteId,identifier,revision,...body}=record;
 if(body.geometry){const {area,height,volume,...geometry}=body.geometry;body.geometry=geometry;}
 return body;
}
async function residents(){
 for(const [buildingId,entry] of Object.entries(state.buildings)){
  assert(entry.recorded,'Prepare the synthetic geometry before resident allocation');
  let dossier=await api(`/buildings/${buildingId}/dossier`);
  const sourceId=entry.documents[`UN-${entry.key}-FICTIONAL-residents.txt`].sourceId;
  const sourcePackage=await api(`/import-packages/${entry.preparation.packageId}`);
  const retainedPart=sourcePackage.parts.find(part=>part.sourceRevisionId===sourceId);
  assert(retainedPart,'Fictional occupant schedule has no retained source part');
  for(const occupant of entry.occupants){
   dossier=await api(`/buildings/${buildingId}/dossier`);
   const record=dossier.records.find(r=>r.alias===occupant.alias);assert(record,'Missing recorded room '+occupant.alias);assert.equal(record.synthetic,true);
   if(record.rights.some(r=>r.party===occupant.party&&r.evidence.sourceId===sourceId)){continue;}
   assert.equal(record.rights.length,0,'Preserve independently edited rights');
   let draft=await api(`/sites/${record.siteId}/drafts`,{recordId:record.id,requestKey:await requestKey('resident-'+occupant.alias)});
   const body={...bodyOnly(record),use:occupant.common?'common':'apartment',rights:[{party:occupant.party,type:'shared_use',evidence:{sourceId,locator:`${retainedPart.locator}: ${occupant.alias}. Fictional shared-use allocation only; no real resident or ownership.`}}]};
   draft=await api(`/registry-drafts/${draft.id}`,{expectedRevision:draft.revision,recordId:record.id,body},'PATCH');
   const site=await api(`/sites/${record.siteId}`);
   const review=await api(`/registry-drafts/${draft.id}/review`,{expectedRevision:draft.revision,expectedSiteRevision:site.site.revision});
   assert.equal(review.findings.filter(f=>f.severity==='error').length,0,JSON.stringify(review.findings));
   await api(`/registry-reviews/${review.id}/commit`,{acknowledgement:reason});
   entry.allocations??={};entry.allocations[record.id]={party:occupant.party,sourceId,reviewId:review.id};await save();
  }
  console.log(`FICTIONAL OCCUPANTS linked to ${entry.occupants.length} UN-${entry.key} room/common records`);
 }
}
try{
 const health=await api('/health');assert.equal(health.ok,true);assert.equal(health.dataMode,'repository');
 if(stage==='all'||stage==='context'){
  const real=await layer('public-buildings','01-google-building-footprints.geojson','building',false);
  state.realAreaId=real.areaId;await save();
  await layer('public-roads','02-osm-road-centrelines.geojson','road',false,state.realAreaId);
  const demo=await layer('demo-buildings','03-DEMO-building-envelopes.geojson','building',true,undefined,{heightField:'demo_height_m',heightUnit:'m',heightMeaning:'Invented demonstration exterior height; not measured',floorCountField:'demo_floors',levelReference:'DEMO-UTTAM-NAGAR'});
  state.demoAreaId=demo.areaId;await save();
  await layer('demo-roads','04-DEMO-road-corridors.geojson','road',true,state.demoAreaId);
  await layer('demo-crossing','05-DEMO-road-conflict.geojson','road',true,state.demoAreaId);
  for(const key of ['realAreaId','demoAreaId']){const context=await current(state[key]);const check=await api('/area-checks',{areaId:state[key],expectedRevision:context.area.revision});state[key+'Check']=check;await save();}
 }
 if(stage==='all'||stage==='details'){assert(state.demoAreaId);for(const detail of spec.details)await prepareBuilding(detail);}
 if(stage==='all'||stage==='residents')await residents();
 state.completed.push({stage,at:new Date().toISOString()});await save();
 console.log(JSON.stringify({result:'PASS',realAreaId:state.realAreaId,demoAreaId:state.demoAreaId,stage,selection:{buildings:selection.buildings,roads:selection.roads}},null,2));
}catch(error){state.lastError={at:new Date().toISOString(),stage,error:String(error)};await save();console.error(error);process.exitCode=1;}

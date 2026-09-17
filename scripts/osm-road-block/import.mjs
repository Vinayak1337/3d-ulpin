/** Reproduce the small OSM road-bounded block through the live import/review API.
 * The .runtime state prevents duplicate imports. A partial run is preserved for
 * inspection rather than silently replayed over edited records.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {projectRoot} from '../repo-env.mjs';
const root=projectRoot(),source=resolve(root,'fixtures/uttam-nagar');
const file=resolve(root,'.runtime/uttam-nagar-installed.json');
const base=process.env.ULPIN_TEST_BASE_URL||'http://127.0.0.1:3000';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname));
if(existsSync(file)){
 const prior=JSON.parse(await readFile(file,'utf8'));
 if(prior.result==='PASS'){
  console.log('Existing installed road-block scenario preserved.',JSON.stringify({realAreaId:prior.realAreaId,demoAreaId:prior.demoAreaId}));
  process.exit(0);
 }
 throw Error('A partial run exists at '+file+'. Inspect its requests and retained data before resuming; nothing was overwritten.');
}
const spec=JSON.parse(await readFile(resolve(source,'demo-plan-spec.json'),'utf8'));
const state={result:'RUNNING',createdAt:new Date().toISOString(),layers:{},properties:[],events:[]};
await mkdir(resolve(root,'.runtime'),{recursive:true});
const save=()=>writeFile(file,JSON.stringify(state,null,2));
await save();
const reason=spec.notice;
async function request(path,body,method=body===undefined?'GET':'POST'){
 const multipart=body instanceof FormData;
 const r=await fetch(base+'/api/v1'+path,{method,headers:body&&!multipart?{'Content-Type':'application/json'}:undefined,body:body===undefined?undefined:multipart?body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
 const value=await r.json();state.events.push({path,method,status:r.status,at:new Date().toISOString()});await save();
 if(!r.ok)throw Error(path+' '+JSON.stringify(value));return value;
}
async function layer(key,filename,kind,worldStatus,areaId,role='unknown',height){
 const form=new FormData();form.set('file',new Blob([await readFile(resolve(source,filename))]),filename);
 for(const [k,v] of Object.entries({format:'geojson',sourceCrs:'EPSG:4326',namespace:'uttam-nagar-20260917:'+key,name:worldStatus==='observed'?'Uttam Nagar - real OSM block':'Uttam Nagar - FICTIONAL registry and conflicts',worldStatus}))form.set(k,v);
 form.set('mapping',JSON.stringify({idField:'source_id',nameField:'name',kind,geometryRole:role,...(height?{heightField:'height_m',heightUnit:'m',heightMeaning:'Authored fictional height; not measured',levelReference:spec.benchmark,...(key==='demo-buildings'?{floorCountField:'floors'}:{})}:{})}));
 if(areaId){const c=await request(`/areas/${areaId}/context`);form.set('areaId',areaId);form.set('expectedAreaRevision',String(c.area.revision));}
 let p=await request('/import-packages',form);state.layers[key]=p.id;await save();
 for(const q of p.questions.filter(q=>!q.answer))p=await request(`/import-packages/${p.id}/answers`,{expectedRevision:p.revision,questionId:q.id,answer:{choice:'keep_2d',reason:'Height not supplied by this source. Retained as unknown.'}});
 p=await request(`/import-packages/${p.id}/review`,{expectedRevision:p.revision});
 return request(`/import-packages/${p.id}/commit`,{expectedRevision:p.revision,acknowledgement:worldStatus==='observed'?'OpenStreetMap source geometry only; no title, parcel, occupancy or height inferred. © OpenStreetMap contributors, ODbL-1.0.':reason});
}
async function document(p,buildingId,name,format,text){
 const form=new FormData();form.set('file',new Blob([text]),name);form.set('format',format);form.set('expectedRevision',String(p.revision));form.set('entityIds',JSON.stringify([buildingId]));
 return request(`/import-packages/${p.id}/documents`,form);
}
const names=['Asha Verma','Rohan Mehta','Neha Saini','Kabir Batra','Meera Joshi','Arjun Malhotra','Isha Anand','Dev Kapoor','Tara Bansal','Nikhil Sethi','Pooja Arora','Varun Khanna','Ananya Rao','Kunal Tandon','Sana Mir','Aditya Sen','Kavya Nair','Rahul Dua'];
try{
 assert.equal((await request('/health')).ok,true);
 const real=await layer('real-buildings','uttam-nagar-buildings.geojson','building','observed');state.realAreaId=real.areaId;await save();
 await layer('real-roads','uttam-nagar-road-centrelines.geojson','road','observed',real.areaId);
 const demo=await layer('demo-buildings','demo-buildings.geojson','building','synthetic',undefined,'observed_ground_occupation',true);state.demoAreaId=demo.areaId;await save();
 for(const [key,name,kind,role,height] of [['demo-roads','demo-road-widths.geojson','road','road_surface'],['demo-parcels','demo-parcels.geojson','parcel','recorded_parcel'],['demo-conflict-road','demo-conflict-road.geojson','road','public_road_land'],['demo-conflict-shed','demo-conflict-shed.geojson','building','observed_ground_occupation',true]])await layer(key,name,kind,'synthetic',demo.areaId,role,height);
 const context=await request(`/areas/${demo.areaId}/context`);
 for(const plan of spec.plans){
  const building=context.features.find(f=>f.sourceKey===plan.demo_key),parcel=context.features.find(f=>f.sourceKey===`demo-parcel-${String(plan.demo_number).padStart(2,'0')}`);assert(building&&parcel);
  await request('/property-associations',{fromId:building.id,toId:parcel.id,relationship:'occupies_parcel',status:'confirmed',expectedRevision:0,expectedFromRevision:building.revision,expectedToRevision:parcel.revision,evidence:[...building.evidence,...parcel.evidence],reason});
  const prep=await request(`/buildings/${building.id}/preparation-cases`,{expectedRevision:building.revision,requestKey:randomUUID()});
  const entry={key:plan.demo_key,buildingId:building.id,prep,residents:[],complete:false};state.properties.push(entry);await save();
  let csv='alias,lower,upper,unit,benchmark,label,level,footprint_wkt,frame\n',person=0;
  for(let floor=0;floor<3;floor++)for(const room of plan.rooms){
   const alias=`UN${plan.demo_number}-${floor}-${room.suffix}`,wkt='POLYGON (('+room.projected_ring.map(([x,y])=>[x-context.area.reference.origin[0],y-context.area.reference.origin[1]].map(v=>v.toFixed(6)).join(' ')).join(', ')+'))';
   csv+=`${alias},${floor*3},${(floor+1)*3},m,${spec.benchmark},DEMO ${room.name},${floor===0?'Ground':'Floor '+floor},"${wkt}",${prep.placement.targetFrame}\n`;
   entry.residents.push({alias,floor,party:room.common?`Fictional shared household ${plan.demo_number}`:`Fictional: ${names[(plan.demo_number-1)*6+person++]}`,common:room.common});
  }
  const label=`DEMO-UN-P${String(plan.demo_number).padStart(2,'0')}`;
  const text=reason+'\nFICTIONAL parcel schedule: '+label+'\n'+entry.residents.map((r,i)=>`Row ${i+1}: ${r.alias} | ${r.party} | Fictional shared-use allocation, not a real person or ownership right.`).join('\n');
  let pkg=await request(`/import-packages/${prep.packageId}`);
  pkg=await document(pkg,building.id,`residence-${plan.demo_number}-fictional-spaces.csv`,'csv',csv);
  pkg=await document(pkg,building.id,`residence-${plan.demo_number}-fictional-residents.txt`,'text',text);
  for(const f of [...pkg.factCandidates])if(!pkg.selectedClaimIds?.includes(f.id))pkg=await request(`/import-packages/${pkg.id}/resolve-fact`,{expectedRevision:pkg.revision,claimId:f.id,reason});
  await request(`/import-packages/${pkg.id}/placement`,{expectedRevision:prep.revision,sourceFrame:prep.placement.targetFrame,verticalReference:spec.benchmark,verticalOffset:0,evidence:pkg.factCandidates[0].evidence,reason});
  pkg=await request(`/import-packages/${pkg.id}`);await request(`/import-packages/${pkg.id}/prepare-details`,{expectedRevision:pkg.revision});
  let d;for(let i=0;i<120;i++){d=await request(`/cases/${prep.caseId}`);if(d.model?.revision===d.case.revision)break;await new Promise(r=>setTimeout(r,500));}
  assert.equal(d.model?.units.length,9);const rev=await request(`/buildings/${building.id}/detail-review`,{expectedRevision:d.case.revision});await request(`/registry-reviews/${rev.id}/commit`,{acknowledgement:reason});
  const dossier=await request(`/buildings/${building.id}/dossier`),siteId=dossier.records.find(r=>r.kind==='space').siteId;
  const evidenceCase=await request(`/sites/${siteId}/workspace`,{});
  const native='alias,lower,upper,unit,benchmark,method,fictional_party,notice\n'+entry.residents.map(r=>`${r.alias},${r.floor*3},${(r.floor+1)*3},m,${spec.benchmark},authored_synthetic_demo,${r.party},Fictional; not a real resident or registered right`).join('\n')+'\n';
  const nativeName=`residence-${plan.demo_number}-native-fictional-resident-schedule.csv`,form=new FormData();form.set('file',new Blob([native]),nativeName);form.set('profile','levels-csv-v1');await request(`/cases/${evidenceCase.id}/sources`,form);
  let src;for(let i=0;i<120;i++){const c=await request(`/cases/${evidenceCase.id}`);src=c.sources.find(s=>s.name===nativeName);if(src?.status==='ready')break;await new Promise(r=>setTimeout(r,500));}assert.equal(src?.status,'ready');entry.nativeResidentSource=src.id;
  for(const [i,resident] of entry.residents.entries()){
   const record=dossier.records.find(r=>r.kind==='space'&&r.alias===resident.alias);assert(record);
   let draft=await request(`/sites/${siteId}/drafts`,{recordId:record.id,requestKey:randomUUID()});
   const {id,siteId:unused,identifier,revision,...body}=draft.records[0];if(body.geometry){const {area,height,volume,...g}=body.geometry;body.geometry=g;}
   body.synthetic=true;body.use=resident.common?'common':'apartment';body.rights=[{party:resident.party,type:'shared_use',evidence:{sourceId:src.id,locator:`csv row ${i+2}; explicitly fictional use allocation`}}];
   draft=await request(`/registry-drafts/${draft.id}`,{expectedRevision:draft.revision,recordId:record.id,body},'PATCH');
   const site=await request(`/sites/${siteId}`),review=await request(`/registry-drafts/${draft.id}/review`,{expectedRevision:draft.revision,expectedSiteRevision:site.site.revision});await request(`/registry-reviews/${review.id}/commit`,{acknowledgement:reason});
  }
  const textSource=dossier.sources.find(s=>s.name===`residence-${plan.demo_number}-fictional-residents.txt`);assert(textSource);
  await request('/external-identifiers',{featureId:parcel.id,expectedRevision:parcel.revision,scheme:'demo_ulpin',value:label,issuer:'Fictional Uttam Nagar teaching schedule - not a government issuer',sourceId:textSource.id,locator:'Fictional parcel schedule: '+label});entry.complete=true;await save();
 }
 for(const id of [state.realAreaId,state.demoAreaId]){const c=await request(`/areas/${id}/context`);await request('/area-checks',{areaId:id,expectedRevision:c.area.revision});}
 state.result='PASS';state.finishedAt=new Date().toISOString();await save();console.log('Imported',state.realAreaId,state.demoAreaId);
}catch(error){state.result='FAIL';state.error=String(error);await save();throw error;}

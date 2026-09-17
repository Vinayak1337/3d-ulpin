import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {mkdir} from "node:fs/promises";
const project=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const runtime=resolve(project,".runtime/uttam-nagar-study");
await mkdir(runtime,{recursive:true});
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
const dir=resolve(process.env.UTTAM_DATA_DIR || resolve(project,"fixtures/uttam-nagar")),base=(process.env.ULPIN_TEST_BASE_URL || "http://127.0.0.1:3000") + "/api/v1";
const statePath=runtime+'/scenario-installed.json';
const state=existsSync(statePath)?JSON.parse(await readFile(statePath,'utf8')):{startedAt:new Date().toISOString(),layers:{},details:{}};
const plan=JSON.parse(await readFile(dir+'/scenario/interior-plan.json','utf8'));
const name='Uttam Nagar | FICTIONAL rooms and conflicts | OSM-derived';
const reason='Explicit synthetic fixture: OSM-derived outlines only. All heights, road widths, parcels, floors, rooms, occupants and proposed conflicts are invented for testing. No real ownership, actual residents, cadastral evidence or official ULPIN claimed.';
const save=()=>writeFile(statePath,JSON.stringify(state,null,2));
async function api(path,body,method){
 const r=await fetch(base+path,{method:method||(body?'POST':'GET'),headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});
 const data=await r.json();if(!r.ok)throw Error(path+' '+r.status+' '+JSON.stringify(data));return data;
}
async function upload(path,form){const r=await fetch(base+path,{method:'POST',body:form,signal:AbortSignal.timeout(120000)});const d=await r.json();if(!r.ok)throw Error(path+' '+r.status+' '+JSON.stringify(d));return d;}
async function attach(pkg,buildingId,filename,format,bytes){
 const f=new FormData();f.set('file',new Blob([bytes]),filename);f.set('format',format);f.set('expectedRevision',String(pkg.revision));f.set('entityIds',JSON.stringify([buildingId]));
 return upload('/import-packages/'+pkg.id+'/documents',f);
}
const stage=process.argv[2]||'layers';
try{
 assert((await api('/health')).ok);
 if(stage==='layers'){
  for(const [kind,file]of [['building','demo-buildings.geojson'],['road','demo-road-widths.geojson'],['parcel','demo-parcels.geojson']]){
   let pkg;
   if(state.layers[kind]?.id)pkg=await api('/import-packages/'+state.layers[kind].id);
   else{
    if(!state.areaId&&(await api('/areas')).some(a=>a.name===name))throw Error('Matching area exists outside checkpoint; inspect rather than duplicate');
    const f=new FormData();f.set('file',new Blob([await readFile(dir+'/scenario/'+file)]),file);f.set('format','geojson');f.set('namespace','uttam-nagar-fictional-20260917:'+kind);f.set('name',name);f.set('worldStatus','synthetic');
    f.set('mapping',JSON.stringify({idField:'id',nameField:'name',kind,geometryRole:kind==='parcel'?'recorded_parcel':kind==='road'?'public_road_land':'approved_building_outline',...(kind==='building'?{heightField:'height',heightUnit:'m',floorCountField:'floors',heightMeaning:'Invented height in an explicitly fictional test copy'}:{}),levelReference:'BM-UTTAM-FICTIONAL',identifierFields:['attribution','license','provenance','source_osm_id','source_url']}));
    if(state.areaId){const c=await api('/areas/'+state.areaId+'/context');f.set('areaId',state.areaId);f.set('expectedAreaRevision',String(c.area.revision));}
    pkg=await upload('/import-packages',f);state.areaId=pkg.areaId;state.layers[kind]={id:pkg.id,file};await save();
   }
   if(pkg.state!=='COMMITTED'){
    assert(!pkg.questions.some(q=>!q.answer),'Unexpected unresolved synthetic input');
    pkg=await api('/import-packages/'+pkg.id+'/review',{expectedRevision:pkg.revision});
    pkg=await api('/import-packages/'+pkg.id+'/commit',{expectedRevision:pkg.revision,acknowledgement:reason});
   }
   state.layers[kind]={...state.layers[kind],state:pkg.state,count:pkg.features.length};await save();console.log('RECORDED synthetic',kind,pkg.features.length);
  }
  const c=await api('/areas/'+state.areaId+'/context');state.siteId=c.area.siteId;
  for(const b of plan.buildings){
   const feature=c.features.find(f=>f.sourceKey===b.demo_source_id),parcel=c.features.find(f=>f.sourceKey==='demo-parcel-'+b.key);
   assert(feature&&parcel);state.details[b.key]||={};state.details[b.key].buildingId=feature.id;state.details[b.key].parcelId=parcel.id;
   const dossier=await api('/buildings/'+feature.id+'/dossier');
   if(!dossier.parcels.some(p=>p.feature.id===parcel.id&&p.status==='confirmed'))await api('/property-associations',{fromId:feature.id,toId:parcel.id,relationship:'occupies_parcel',status:'confirmed',expectedRevision:0,expectedFromRevision:feature.revision,expectedToRevision:parcel.revision,evidence:[...feature.evidence,...parcel.evidence],reason});
  }
  state.layersComplete=true;await save();console.log('SCENARIO AREA',state.areaId);
 }
 if(stage==='interiors'){
  assert(state.layersComplete,'Import layers first');
  const context=await api('/areas/'+state.areaId+'/context'),origin=context.area.reference.origin;
  for(const b of plan.buildings){
   const entry=state.details[b.key];assert(entry?.buildingId);
   if(entry.complete){console.log('PRESERVED completed building',b.key);continue;}
   const building=context.features.find(f=>f.id===entry.buildingId);
   let prep=entry.preparation;
   if(!prep){prep=await api('/buildings/'+building.id+'/preparation-cases',{expectedRevision:building.revision,requestKey:randomUUID()});entry.preparation=prep;await save();}
   let pkg=await api('/import-packages/'+prep.packageId);
   const occupants=plan.residents.filter(r=>r.building===b.key);
   let csv='alias,lower,upper,unit,benchmark,label,level,footprint_wkt,frame\n';
   for(const person of occupants){
    const room=b.rooms.find(r=>r.suffix===person.room),coords=room.absolutePolygon.coordinates[0].map(([x,y])=>[x-origin[0],y-origin[1]]);
    const wkt='POLYGON (('+coords.map(p=>p.map(v=>v.toFixed(6)).join(' ')).join(', ')+'))';
    csv+=`${person.alias},${person.lower.toFixed(2)},${person.upper.toFixed(2)},m,BM-UTTAM-FICTIONAL,${room.label},${person.floor===0?'Ground':'Floor '+person.floor},"${wkt}",${prep.placement.targetFrame}\n`;
   }
   const txt=['FICTIONAL OCCUPANCY SCHEDULE - GENERATED TEST DATA, NOT ACTUAL RESIDENTS',reason,'Each person and common-use allocation below is invented. No ownership claim is made.',...occupants.map(p=>`${p.alias} | ${p.party} | fictional shared use only | assumed levels ${p.lower} to ${p.upper} m`),'Demo parcel identifier: DEMO-UN-P0'+('ABC'.indexOf(b.key)+1)+'; invented parcel around the scenario footprint.'].join('\n');
   const attachments=[['DEMO-'+b.key+'-spaces.csv','csv',Buffer.from(csv)],['DEMO-'+b.key+'-occupants.txt','text',Buffer.from(txt)],['DEMO-'+b.key+'-floor-plan.png','png',await readFile(dir+'/scenario/DEMO-'+b.key+'-floor-plan.png')]];
   entry.documents||={};
   for(const [filename,format,bytes]of attachments){
    await writeFile(runtime+'/'+filename,bytes);
    if(entry.documents[filename])continue;
    const before=new Set(pkg.sourceRevisionIds);pkg=await attach(pkg,building.id,filename,format,bytes);
    const id=pkg.sourceRevisionIds.find(id=>!before.has(id));assert(id,'New retained original source ID missing');
    entry.documents[filename]={id,sha256:createHash('sha256').update(bytes).digest('hex')};await save();
   }
   const occupantSource=entry.documents['DEMO-'+b.key+'-occupants.txt'].id;
   const dossier=await api('/buildings/'+building.id+'/dossier');
   if(!dossier.parcelIdentifiers?.some(p=>p.value==='DEMO-UN-P0'+('ABC'.indexOf(b.key)+1)))await api('/external-identifiers',{featureId:entry.parcelId,expectedRevision:1,scheme:'demo_ulpin',value:'DEMO-UN-P0'+('ABC'.indexOf(b.key)+1),issuer:'Uttam Nagar invented training schedule',sourceId:occupantSource,locator:'Final line: fictional parcel identifier; no official issuance'});
   for(const fact of [...pkg.factCandidates])if(!pkg.selectedClaimIds?.includes(fact.id))pkg=await api('/import-packages/'+pkg.id+'/resolve-fact',{expectedRevision:pkg.revision,claimId:fact.id,reason});
   if(!entry.placed){await api('/import-packages/'+pkg.id+'/placement',{expectedRevision:prep.revision,sourceFrame:prep.placement.targetFrame,verticalReference:'BM-UTTAM-FICTIONAL',verticalOffset:0,evidence:pkg.factCandidates[0].evidence,reason});entry.placed=true;await save();}
   pkg=await api('/import-packages/'+pkg.id);
   if(!entry.built){await api('/import-packages/'+pkg.id+'/prepare-details',{expectedRevision:pkg.revision});entry.buildRequested=true;await save();}
   let detail;
   for(let i=0;i<120;i++){
    detail=await api('/cases/'+prep.caseId);
    if(detail.model?.revision===detail.case.revision)break;
    if(detail.jobs[0]?.status==='failed')throw Error('Worker failed '+JSON.stringify(detail.jobs[0]));
    await new Promise(r=>setTimeout(r,1000));
   }
   assert.equal(detail.model?.revision,detail.case.revision,'Worker did not build current revision');assert.equal(detail.model.units.length,12);entry.built=true;await save();
   let review;
   if(!entry.draftId){review=await api('/buildings/'+building.id+'/detail-review',{expectedRevision:detail.case.revision});entry.draftId=review.draftId;await save();}
   let draft=await api('/registry-drafts/'+entry.draftId);
   if(draft.status==='recorded'){entry.complete=true;await save();continue;}
   for(const record of draft.records.filter(r=>r.kind==='space')){
    const person=occupants.find(p=>p.alias===record.alias);assert(person,'Unknown room alias '+record.alias);
    if(record.rights.some(r=>r.party===person.party))continue;
    const {id,siteId,identifier,revision,...body}=record;
    if(body.geometry){const {area,height,volume,...spec}=body.geometry;body.geometry=spec;}
    body.use=person.common?'common':'unspecified';
    body.rights=[{party:person.party,type:'shared_use',evidence:{sourceId:occupantSource,locator:'line '+(4+occupants.indexOf(person))+': '+person.alias+'; entirely fictional occupant/shared-use example'}}];
    draft=await api('/registry-drafts/'+draft.id,{expectedRevision:draft.revision,recordId:id,body},'PATCH');
   }
   const site=await api('/sites/'+state.siteId);
   review=await api('/registry-drafts/'+draft.id+'/review',{expectedRevision:draft.revision,expectedSiteRevision:site.site.revision});
   await writeFile(runtime+'/DEMO-'+b.key+'-registry-review.json',JSON.stringify(review,null,2));
   assert(!review.findings.some(f=>f.severity==='error'),'Blocking registry findings '+JSON.stringify(review.findings));
   await api('/registry-reviews/'+review.id+'/commit',{acknowledgement:reason});
   entry.complete=true;entry.reviewId=review.id;entry.spaces=12;entry.fictionalIndividuals=9;await save();console.log('RECORDED Building',b.key,'3 floors / 12 spaces / 9 fictional occupants');
  }
  const c=await api('/areas/'+state.areaId+'/context');
  const check=await api('/area-checks',{areaId:state.areaId,expectedRevision:c.area.revision});
  state.checkId=check.id;state.finishedAt=new Date().toISOString();state.result='PASS';await save();
  await writeFile(runtime+'/scenario-check.json',JSON.stringify(check,null,2));
  await writeFile(runtime+'/scenario-context.json',JSON.stringify(await api('/areas/'+state.areaId+'/context'),null,2));
  console.log('SCENARIO COMPLETE',state.areaId,'findings',check.findings.length);
 }
}catch(e){state.lastError=String(e);await save();console.error(e);process.exitCode=1;}

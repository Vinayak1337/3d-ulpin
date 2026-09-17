import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {mkdir} from "node:fs/promises";
const project=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const runtime=resolve(project,".runtime/uttam-nagar-study");
await mkdir(runtime,{recursive:true});
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
const dir=resolve(process.env.UTTAM_DATA_DIR || resolve(project,"fixtures/uttam-nagar"));
const base=(process.env.ULPIN_TEST_BASE_URL || "http://127.0.0.1:3000") + "/api/v1";
const statePath=runtime+'/reference-installed.json';
const state=existsSync(statePath)?JSON.parse(await readFile(statePath,'utf8')):{startedAt:new Date().toISOString(),layers:{}};
const save=()=>writeFile(statePath,JSON.stringify(state,null,2));
async function api(path,body,method){
 const r=await fetch(base+path,{method:method||(body?'POST':'GET'),headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});
 const data=await r.json();if(!r.ok)throw Error(path+' '+r.status+' '+JSON.stringify(data));return data;
}
const name='Uttam Nagar | OSM reference | no ownership data';
const acknowledgement='OpenStreetMap community geometry, ODbL. Not cadastral parcels or legal ownership evidence. Heights, interiors and occupants are unknown. Road lines do not establish road-land width. Analyst-selected study window, not an official block boundary.';
try{
 const health=await api('/health');assert(health.ok&&health.dataMode==='repository');
 for(const [kind,file]of [['building','uttam-nagar-buildings.geojson'],['road','uttam-nagar-roads.geojson']]){
  let pkg;
  if(state.layers[kind]?.id){pkg=await api('/import-packages/'+state.layers[kind].id);}
  else{
   const areas=await api('/areas');
   if(!state.areaId&&areas.some(a=>a.name===name))throw Error('An area with this name already exists outside this checkpoint; inspect rather than duplicate.');
   const form=new FormData();
   form.set('file',new Blob([await readFile(dir+'/prepared/'+file)]),file);
   form.set('format','geojson');form.set('namespace','uttam-nagar-osm-20260917:'+kind);form.set('name',name);form.set('worldStatus','observed');
   form.set('mapping',JSON.stringify({idField:'osm_id',nameField:'name',kind,geometryRole:'unknown',identifierFields:['attribution','license','source_url','provenance']}));
   if(state.areaId){const c=await api('/areas/'+state.areaId+'/context');form.set('areaId',state.areaId);form.set('expectedAreaRevision',String(c.area.revision));}
   const r=await fetch(base+'/import-packages',{method:'POST',body:form,signal:AbortSignal.timeout(120000)});pkg=await r.json();
   if(!r.ok)throw Error('Ingest '+kind+' '+r.status+' '+JSON.stringify(pkg));
   state.areaId=pkg.areaId;state.layers[kind]={id:pkg.id,file};await save();
  }
  if(pkg.state==='COMMITTED'){console.log('PRESERVED',kind,pkg.id);continue;}
  for(const q of pkg.questions.filter(q=>!q.answer)){
   assert(q.kind==='missing_height'||q.property?.includes('height'),'Unexpected question '+JSON.stringify(q));
   pkg=await api('/import-packages/'+pkg.id+'/answers',{expectedRevision:pkg.revision,questionId:q.id,answer:{choice:'keep_2d',reason:'The downloaded OSM source supplies no measured height. Retain the original footprint in 2D; do not infer any floors or height.'}});
  }
  pkg=await api('/import-packages/'+pkg.id+'/review',{expectedRevision:pkg.revision});
  pkg=await api('/import-packages/'+pkg.id+'/commit',{expectedRevision:pkg.revision,acknowledgement});
  state.layers[kind]={...state.layers[kind],state:pkg.state,features:pkg.features.length};await save();
  console.log('RECORDED',kind,pkg.features.length,pkg.state,state.areaId);
 }
 const c=await api('/areas/'+state.areaId+'/context');
 assert.equal(c.features.filter(f=>f.kind==='building').length,113);assert.equal(c.features.filter(f=>f.kind==='road').length,35);
 assert(c.features.every(f=>f.worldStatus==='observed'));
 assert(c.features.filter(f=>f.kind==='building').every(f=>f.height.value===null),'No height should have been invented');
 const check=await api('/area-checks',{areaId:state.areaId,expectedRevision:c.area.revision});
 state.result='PASS';state.finishedAt=new Date().toISOString();state.siteId=c.area.siteId;state.check={id:check.id,findings:check.findings.length};
 await writeFile(runtime+'/reference-context.json',JSON.stringify(await api('/areas/'+state.areaId+'/context'),null,2));
 await writeFile(runtime+'/reference-check.json',JSON.stringify(check,null,2));await save();
 console.log('REFERENCE PASS',JSON.stringify({areaId:state.areaId,features:c.features.length,check:state.check}));
}catch(e){state.lastError=String(e);await save();console.error(e);process.exitCode=1;}

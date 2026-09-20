/** Actual source-led private inference. New fictional workspace; originals retained.
 * Checkpointed so retries reuse workspace, uploads, batch and footprint draft. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
const base='http://127.0.0.1:3000',out='docs/evidence/t066/workflow';
await mkdir(out,{recursive:true});
const prior=JSON.parse(await readFile('docs/evidence/t061/workflow/state.json','utf8'));
const fixtures=JSON.parse(await readFile('.runtime/t066-fixtures/manifest.json','utf8'));
const path=out+'/state.json';
const state:any=await readFile(path,'utf8').then(JSON.parse).catch(()=>({requestKey:randomUUID(),areaId:prior.preparation.areaId,attachments:{},checks:[],scope:'New explicitly fictional source-only workflow in retained T061 demonstration block. Published raster and attribution retained; calibration is authored synthetic test evidence, not survey coordinates.'}));
const save=()=>writeFile(path,JSON.stringify(state,null,2)+'\n');
const pass=async(name:string,details={})=>{state.checks=state.checks.filter((v:any)=>v.name!==name);state.checks.push({name,passed:true,...details});console.log('PASS '+name);await save();};
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function api(p:string,value?:any,status=200){const r=await fetch(base+'/api/v1'+p,{method:value===undefined?'GET':'POST',headers:value===undefined||value instanceof FormData?undefined:{'Content-Type':'application/json'},body:value===undefined?undefined:value instanceof FormData?value:JSON.stringify(value),signal:AbortSignal.timeout(120000)});const text=await r.text();let result:any;try{result=JSON.parse(text)}catch{throw Error(p+': '+text.slice(0,300))}assert.equal(r.status,status,p+': '+JSON.stringify(result).slice(0,700));return result;}
try {
 if(!state.initialArea){const a=await api('/areas/'+state.areaId+'/context');state.initialArea={revision:a.area.revision,featureIds:a.features.map((f:any)=>f.id).sort()};await save();}
 if(!state.workspace){state.workspace=await api('/source-workspaces',{requestKey:state.requestKey,areaId:state.areaId,expectedAreaRevision:state.initialArea.revision,name:'T066 fictional source-led review '+state.requestKey.slice(0,8),worldStatus:'synthetic'},201);await save();}
 let pkg=await api('/import-packages/'+state.workspace.id);assert.equal(pkg.features.length,0);assert(pkg.sourceWorkspace);state.caseId=pkg.sourceWorkspace.caseId;await save();
 const resumed=await api('/source-workspaces?caseId='+state.caseId);assert.equal(resumed.id,pkg.id);const context=await api('/areas/'+state.areaId+'/context');assert.deepEqual(context.features.map((f:any)=>f.id).sort(),state.initialArea.featureIds);
 await pass('Source-only workspace is persisted and resumable without creating or choosing a property');
 for(const key of ['building','buildingAttribution']){
  const fixture=fixtures.files.find((f:any)=>f.key===key),bytes=await readFile(fixture.file),name=fixture.file.split('/').at(-1)!;
  assert.equal(hash(bytes),fixture.sha256);
  if(!state.attachments[key]){pkg=await api('/import-packages/'+pkg.id);const detail=await api('/cases/'+state.caseId);const old=detail.sources.find((s:any)=>s.name===name&&s.sha256===fixture.sha256);
   if(old){state.attachments[key]={sourceRevisionId:old.id,sha256:fixture.sha256,name};}
   else{const form=new FormData();form.set('file',new Blob([new Uint8Array(bytes)]),name);form.set('format',key==='building'?'png':'text');form.set('expectedRevision',String(pkg.revision));const updated=await api('/import-packages/'+pkg.id+'/source-documents',form,201);const sourceId=updated.sourceRevisionIds.find((id:string)=>!pkg.sourceRevisionIds.includes(id));assert(sourceId);state.attachments[key]={sourceRevisionId:sourceId,sha256:fixture.sha256,name};pkg=updated;}await save();}
  const original=await fetch(base+'/api/v1/sources/'+state.attachments[key].sourceRevisionId+'/file');assert.equal(original.status,200);assert.equal(hash(new Uint8Array(await original.arrayBuffer())),fixture.sha256);
 }
 pkg=await api('/import-packages/'+pkg.id);assert.equal(pkg.features.length,0);assert(pkg.parts.every((p:any)=>!p.entityIds.length));await pass('PNG and text attribution upload consistently without property association; byte-identical originals retained');
 const part=pkg.parts.find((p:any)=>p.sourceRevisionId===state.attachments.building.sourceRevisionId);assert(part);
 if(!state.batch){const input={packageId:pkg.id,expectedRevision:pkg.revision,requestKey:state.batchKey||randomUUID(),items:[{sourceRevisionId:part.sourceRevisionId,partId:part.id,page:1,task:'building'}]};state.batchKey=input.requestKey;await save();state.batch=await api('/spatial-ml/batches',input,201);await save();}
 let batch;const until=Date.now()+300000;let last='';while(Date.now()<until){batch=await api('/spatial-ml/batches/'+state.batch.id);const status=batch.items.map((i:any)=>i.state).join(',');if(status!==last){console.log('Private inference: '+status);last=status;}if(batch.items.every((i:any)=>!['queued','running'].includes(i.state)))break;await new Promise(r=>setTimeout(r,1500));}
 const item=batch.items[0];assert.equal(item.state,'succeeded',JSON.stringify(item).slice(0,600));assert(item.result.components.length>0);assert.equal(item.sourceSha256,state.attachments.building.sha256);const raster=await fetch(base+item.result.raster.url);assert.equal(hash(new Uint8Array(await raster.arrayBuffer())),item.result.raster.sha256);state.itemId=item.id;await writeFile(out+'/batch.json',JSON.stringify(batch,null,2)+'\n');await pass('Actual local building model runs from source-only workspace and retains exact raster/model receipt',{components:item.result.components.length});
 const component=item.result.components.find((c:any)=>/building/i.test(c.className));assert(component);const width=item.result.raster.width;
 if(!state.draftInput){const current=await api('/areas/'+state.areaId+'/context');state.draftInput={requestKey:randomUUID(),expectedRevision:pkg.revision,expectedAreaRevision:current.area.revision,selections:[{componentId:component.id,subject:'T066 fictional imagery building'}],calibration:{rasterSha256:item.result.raster.sha256,imagePoints:[[0,0],[width,0]],worldPoints:[[100,100],[140,100]],frame:pkg.sourceWorkspace.frame.id,reason:'T066 authored fictional test controls: image width represents 40 metres in the retained named frame. Published imagery is not survey evidence for this fictional block.'}};await save();}
 const draft=await api('/spatial-ml/items/'+item.id+'/footprint-drafts',state.draftInput);assert.equal(draft.package.features.length,1);const feature=draft.package.features[0];assert.equal(feature.worldStatus,'synthetic');assert.equal(feature.height.value,null);assert.notEqual(draft.package.state,'COMMITTED');const replay=await api('/spatial-ml/items/'+item.id+'/footprint-drafts',state.draftInput);assert.equal(replay.package.id,draft.package.id);assert.deepEqual(replay.package.features,draft.package.features);
 const flatten=(v:any):number[][]=>typeof v[0]==='number'?[v]:v.flatMap(flatten);const precision=(pts:number[][])=>[...new Set(pts.map(p=>p.map(v=>v.toFixed(5)).join(',')))].sort();
 const expected=flatten(component.geometry.coordinates).map(([x,y])=>[100+x*40/width,100-y*40/width]);assert.deepEqual(precision(flatten(feature.geometry.coordinates)),precision(expected));state.draftPackageId=draft.package.id;state.featureId=feature.id;await save();await writeFile(out+'/draft.json',JSON.stringify(draft,null,2)+'\n');await pass('Reviewed controls preserve actual model contour in an ordinary unrecorded draft; repeat request keeps identity and unknown height');
 const wrong={...state.draftInput,requestKey:randomUUID(),calibration:{...state.draftInput.calibration,frame:'T066-wrong-frame'}};await api('/spatial-ml/items/'+item.id+'/footprint-drafts',wrong,422);await pass('Wrong named frame is rejected before any footprint is recorded');
 state.result='PASS';delete state.failure;await save();
}catch(e){state.result='FAIL';state.failure=String(e);await save();throw e;}

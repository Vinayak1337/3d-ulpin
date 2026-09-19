import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {district,getBuilding} from '../apps/web/features/studio/data/district';
import {rectangleDifference} from '../apps/web/features/studio/data/display-geometry';
import {buildArchitecture} from '../apps/web/features/studio/scene/architecture';
import {loadStudioDraft,saveStudioDraft,studioDraftKey,type StudioDraft} from '../apps/web/features/studio/data/workspace-draft';
import {validatePreparedProperty,verifyPreparedProperty} from '../apps/web/features/studio/data/verify-property-source';
import {readStudioRoute} from '../apps/web/features/studio/routing';
import {sourceKind} from '../apps/web/features/officer/register/model';
import type {StudioSourceManifest} from '../apps/web/features/studio/data/source-types';

const b=getBuilding(district.defaultBuildingId);
const square={x:0,z:0,width:10,depth:10};
const area=(patches:ReturnType<typeof rectangleDifference>)=>patches.reduce((sum,p)=>sum+p.width*p.depth,0);
test('parcel display covers north, south, east and west without double-counting corner patches',()=>{
 for(const other of [{...square,z:2},{...square,z:-2},{...square,x:2},{...square,x:-2}])assert.equal(area(rectangleDifference(square,other)),20);
 const patches=rectangleDifference(square,{x:2,z:2,width:8,depth:8});assert.equal(area(patches),51);
 for(let i=0;i<patches.length;i++)for(let j=i+1;j<patches.length;j++){
  const a=patches[i],c=patches[j];assert(Math.min(a.x+a.width/2,c.x+c.width/2)<=Math.max(a.x-a.width/2,c.x-c.width/2)||Math.min(a.z+a.depth/2,c.z+c.depth/2)<=Math.max(a.z-a.depth/2,c.z-c.depth/2));
 }
 assert.equal(area(rectangleDifference(b,b.parcel)),32);
 assert.equal(area(rectangleDifference(square,{...square,x:30})),100);
 assert.deepEqual(rectangleDifference(square,{...square,width:20,depth:20}),[]);
});
test('shared exterior and exploded envelope are deterministic display geometry, not source mutations',()=>{
 const original=JSON.stringify(b),normal=buildArchitecture([b]),exploded=buildArchitecture([b],{cutaway:true,spacing:6.5});
 assert.deepEqual(buildArchitecture([b]),normal);assert.equal(JSON.stringify(b),original);
 assert(normal.body.length>0);assert.equal(exploded.body.length,0);
 assert(Object.values(exploded).flat().every(p=>p.s.every(v=>v>0)&&p.p.every(Number.isFinite)&&p.owner===b.id));
 assert(Math.max(...Object.values(exploded).flat().map(p=>p.p[1]))>b.height);
 assert.equal(JSON.stringify(b),original);
});
const makeStorage=()=>{const data=new Map<string,string>();return {data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};};
const draft=(floor=0):StudioDraft=>({schemaVersion:'studio-local-draft/1',buildingId:b.id,floor,unitId:b.units.find(u=>u.floor===floor)!.id,sourceHash:'a'.repeat(64),revision:0,notes:`Notes for ${floor}`,status:'draft',tool:'distance',points:[[0,0],[3,4]],calibration:1,updatedAt:'2026-09-19T00:00:00Z'});
test('floor drafts do not overwrite each other and retain independent revisions',()=>{
 const storage=makeStorage(),ground=saveStudioDraft(storage,draft(0)),first=saveStudioDraft(storage,draft(1));
 assert.equal(loadStudioDraft(storage,b.id,0)?.notes,'Notes for 0');assert.equal(loadStudioDraft(storage,b.id,1)?.notes,'Notes for 1');
 assert.equal(ground.revision,1);assert.equal(first.revision,1);
 assert.throws(()=>saveStudioDraft(storage,draft(0)),/another tab/);
 assert.equal(storage.data.size,2);
});
test('old building-scoped draft is read on its own floor only and retained during migration',()=>{
 const storage=makeStorage(),legacy={...draft(1),revision:4},key='ulpin:studio-local-draft:v1:'+b.id;
 storage.setItem(key,JSON.stringify(legacy));assert.equal(loadStudioDraft(storage,b.id,0),null);
 assert.equal(loadStudioDraft(storage,b.id,1)?.revision,4);
 const updated=saveStudioDraft(storage,{...legacy,notes:'Kept on first floor'});assert.equal(updated.revision,5);
 assert.equal(storage.getItem(key),JSON.stringify(legacy));assert(storage.getItem(studioDraftKey(b.id,1)));
});
test('source revision mismatch, crossed area, incomplete measure and foreign unit cannot be queued',()=>{
 const storage=makeStorage(),saved=saveStudioDraft(storage,draft());
 assert.throws(()=>saveStudioDraft(storage,{...saved,sourceHash:'b'.repeat(64)}),/different source/);
 assert.throws(()=>saveStudioDraft(storage,{...saved,status:'ready_for_review',tool:'area',points:[[0,0],[3,3],[0,3],[3,0]]}),/crosses|boundary/);
 assert.throws(()=>saveStudioDraft(storage,{...saved,status:'ready_for_review',points:[[0,0]]}),/unfinished/);
 assert.throws(()=>saveStudioDraft(storage,{...saved,unitId:b.units.find(u=>u.floor===1)!.id}),/draft floor/);
 assert.equal(loadStudioDraft(storage,b.id,0)?.revision,1);
});
test('source validation tests real property/plan/occupancy links and rejects altered bytes',async()=>{
 const root='fixtures/studio/reference-v2',raw=await readFile(root+'/records.json'),manifest=JSON.parse(await readFile(root+'/manifest.json','utf8')) as StudioSourceManifest;
 const result=validatePreparedProperty(b,JSON.parse(raw.toString()),manifest);
 assert.deepEqual([result.floors,result.units,result.documents],[5,10,18]);
 const fakeFetch=(async()=>new Response(new Uint8Array(raw))) as typeof fetch;
 assert.equal((await verifyPreparedProperty(b,manifest,fakeFetch)).sha256,manifest.datasetSha256);
 const damagedFetch=(async()=>new Response('changed bytes')) as typeof fetch;
 await assert.rejects(()=>verifyPreparedProperty(b,manifest,damagedFetch),/checksum/);
 assert.throws(()=>validatePreparedProperty({...b,owner:'Different person'},JSON.parse(raw.toString()),manifest),/differs/);
 const incomplete={...manifest,documents:manifest.documents.filter(d=>d.id!=='plan-BLD-0413-F1')};assert.throws(()=>validatePreparedProperty(b,JSON.parse(raw.toString()),incomplete),/unique prepared plan/);
});
for(const query of ['selection=all','selection=','explode=yes','unit=','mode=','doc=','tab='])test(`malformed state ${query} is unavailable rather than silently normalized`,()=>assert(readStudioRoute('/studio/map/BLD-0413?'+query,district).error));
test('image floor plans are drawings before generic image-photo classification',()=>{
 const plan={name:'A-floor-2.png',profile:'plan-png-v1'} as Parameters<typeof sourceKind>[0];
 const photo={name:'site-inspection-east.jpg',profile:'photo-jpeg-v1'} as Parameters<typeof sourceKind>[0];
 assert.equal(sourceKind(plan),'Plans & drawings');assert.equal(sourceKind(photo),'Photos');
});

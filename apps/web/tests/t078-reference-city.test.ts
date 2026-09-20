import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeReferencePackage} from '../features/spatial/reference-import/browser';
import {deriveSpatialChecks} from '../features/spatial/reference-runtime/spatial-checks.js';
import {buildArchitecture} from '../features/spatial/reference-runtime/architecture.js';
import {createSceneRecords} from '../features/spatial/reference-runtime/records.js';
import * as THREE from 'three';
test('reference reconstruction imports source-only and computes focal road/parcel conflicts',async()=>{
 const bytes=new Uint8Array(await readFile('apps/web/public/reference/showcase-anchor.zip'));
 const receipt=await normalizeReferencePackage('showcase-anchor.zip',bytes);
 assert.ok(!receipt.receipt.files.has('normalized.json'));
 const scene=deriveSpatialChecks(receipt.render.scene),records=createSceneRecords(scene);
 assert.equal(scene.objects.filter((o:any)=>o.type==='building').length,49);
 assert.equal(records.search('DEMO-3D-ANCHOR-B01:1')[0].floorId,'B01-F1');
 const issues=scene.issues.filter((i:any)=>i.objectIds?.includes('B01'));
 assert.ok(issues.some((i:any)=>i.code==='ROAD_OVERLAP'));
 assert.ok(issues.some((i:any)=>i.code==='OUTSIDE_PARCEL'));
 assert.ok(records.residents('B01-F1').length);
 const geometries=new Map(scene.geometries.map((g:any)=>[g.id,g]));
 const architecture=buildArchitecture({buildings:scene.objects.filter((o:any)=>o.type==='building'),geometryFor:(o:any)=>geometries.get(o?.geometryId),floorsFor:(id:string)=>records.floors(id),sceneDecoration:scene.sceneDecoration,clippingPlane:null});
 let before=0,after=0;
 for(const entry of architecture.entries.values()){
  const oldBounds=new THREE.Box3();entry.segments.forEach((s:any)=>{oldBounds.expandByObject(s.group);s.group.traverse((o:any)=>{if(o.isMesh)before++;});});
  const batch=entry.blockBatch;assert.ok(batch);batch.group.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(batch.group);
  assert.ok(oldBounds.min.distanceTo(bounds.min)<.001);assert.ok(oldBounds.max.distanceTo(bounds.max)<.001);
  batch.group.traverse((o:any)=>{if(o.isMesh){after++;assert.equal(o.userData.objectId,entry.object.id);}});
 }
 assert.ok(after<before*.5,`${before} → ${after} exterior draw batches`);
 console.log(JSON.stringify({buildings:49,exteriorDrawBatchesBefore:before,exteriorDrawBatchesAfter:after,reduction:Math.round((1-after/before)*100)+'%'}));
 architecture.dispose();
});

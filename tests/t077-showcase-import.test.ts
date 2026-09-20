import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeReferencePackage} from '../apps/web/features/spatial/reference-import/browser';
import {createSceneRecords} from '../apps/web/features/spatial/reference-runtime/records.js';
for(const profile of ['dense','reference'])test(`source-only ${profile} ZIP extracts canonical identities and floor residents end to end`,async()=>{
 const filename=`showcase-${profile}.zip`,original=new Uint8Array(await readFile(`apps/web/public/reference/${filename}`));
 const result=await normalizeReferencePackage(filename,original);
 assert.deepEqual(result.receipt.originalBytes,original);assert.ok(result.receipt.extraction);assert.ok(![...result.receipt.files.keys()].some(p=>p.endsWith('normalized.json')));
 const records=createSceneRecords(result.render.scene),buildings=result.render.scene.objects.filter(o=>o.type==='building');
 for(const building of buildings){
  const identity=records.identity(building.id)!;assert.ok(identity.threeDId);assert.ok(identity.twoDIds.length);assert.equal(records.search(identity.threeDId!)[0].buildingId,building.id);
  assert.ok(records.search(identity.twoDIds[0].value).some(r=>r.buildingId===building.id));
  const floors=records.floors(building.id);assert.ok(floors.length);
  for(const floor of floors){const id=records.identity(floor.id)!.threeDId!;assert.ok(id.startsWith(identity.threeDId+':'));assert.equal(records.search(id)[0].floorId,floor.id);}
 }
 const residents=buildings.flatMap(b=>records.residents(b.id));assert.ok(residents.length>0);assert.ok(residents.every(p=>p.classification==='synthetic'&&p.sourceRecordId));
 assert.ok(result.render.scene.objects.some(o=>o.type==='space'&&o.geometryId===null));
 assert.equal(result.canonical.input.schemaVersion,'ulpin-spatial/2');
});

test('known height with unknown base stays a display-only extrusion and no analytical interval',async()=>{
 const bytes=new Uint8Array(await readFile('design/reference-map-v5/data/independent-arrangements.json'));
 const raw=JSON.parse(new TextDecoder().decode(bytes));const shape=raw.geometries.find((g:any)=>g.objectId==='upper-benchmark-house');shape.baseElevationM=null;
 const r=await normalizeReferencePackage('unreferenced.json',new TextEncoder().encode(JSON.stringify(raw)));
 const display=r.render.scene.geometries.find(g=>g.objectId==='upper-benchmark-house')!;
 assert.equal(display.heightM,12);assert.equal(display.baseElevationM,null);assert.ok(r.render.diagnostics.some(d=>d.code==='DISPLAY_UNREFERENCED_HEIGHT'));
 const profile=r.canonical.input.geometry.representations.find(g=>g.entity.id==='upper-benchmark-house')!.geometry;assert.equal(profile.profile,'prism');if(profile.profile==='prism')assert.equal(profile.interval,null);
});

for(const mode of ['master','normalized'])test(`provided ${mode} source ZIP extracts actual supplied shapes, identities and unknowns`,async()=>{
 const name=`provided-${mode}.zip`,bytes=new Uint8Array(await readFile(`apps/web/public/reference/${name}`));
 const result=await normalizeReferencePackage(name,bytes),scene=result.render.scene,records=createSceneRecords(scene);
 assert.deepEqual(result.receipt.originalBytes,bytes);assert.equal(result.receipt.extraction?.profile,'ulpin-provided-source/1');
 assert.equal(scene.objects.filter(o=>o.type==='building').length,32);assert.equal(scene.objects.filter(o=>o.type==='parcel').length,31);
 const floors=records.floors('SV-B-029');assert.equal(floors.length,5);assert.ok(floors.every(f=>f.geometryId===null));
 assert.equal(records.search('DEMO-3D-SV-B-029:1')[0].floorId,'SV-B-029/floor/F01');
 assert.equal(records.residents('SV-B-029').length,0);assert.equal(records.identity('SV-B-029')?.twoDIds.length,0);
 const building=scene.objects.find(o=>o.id==='SV-B-029')!,geometry=scene.geometries.find(g=>g.id===building.geometryId)!;
 assert.equal(geometry.baseElevationM,null);assert.ok(geometry.heightM!==null&&geometry.heightM>0);
 assert.ok(scene.geometries.some(g=>g.type==='LineString'));
});

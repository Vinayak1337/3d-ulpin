import test from 'node:test';
import assert from 'node:assert/strict';
import {district,computeFindings,exportGeoJSON} from '../apps/web/features/studio/data/district';
import {getFloorLayout} from '../apps/web/features/studio/data/floorLayout';
import {loadStudioDraft,saveStudioDraft,studioMeasurement,type StudioDraft} from '../apps/web/features/studio/data/workspace-draft';
const hero=district.buildings.find(b=>b.id===district.defaultBuildingId)!;
test('synthetic reference has independently expected full neighbourhood and hero quantities',()=>{
 assert.equal(district.buildings.length,62);assert.equal(hero.width*hero.depth,288);assert.equal(hero.height,16);assert.equal(hero.width*hero.depth*hero.height,4608);
 assert.deepEqual(computeFindings(hero).map(f=>[f.type,f.value]),[['Parcel',32],['Road',16],['Utility',1.8]]);
 assert.equal(district.buildings.reduce((n,b)=>n+b.units.length,0),478);
 assert.equal(new Set(district.buildings.flatMap(b=>b.units.map(u=>u.id))).size,478);
});
test('parcel and building GIS exports are distinct data rather than renamed duplicates',()=>{
 const parcels=exportGeoJSON('parcels'),buildings=exportGeoJSON('buildings'),p=parcels.features.find(f=>f.properties.building_id===hero.id)!,b=buildings.features.find(f=>f.id===hero.id)!;
 assert.equal(p.id,hero.parcelId);assert.notDeepEqual(p.geometry,b.geometry);assert.equal(b.properties.footprint_m2,288);assert.equal(p.properties.parcel_area_m2,506.25);
});
test('unit plan, register and source room-net area use the same reusable layout',()=>{
 for(const b of district.buildings)for(let floor=0;floor<b.floors;floor++){const layout=getFloorLayout(b,floor);assert.equal(layout.units.length,2);for(const u of layout.units){assert.equal(u.unit.floor,floor);assert(u.unit.area<u.boundary.width*u.boundary.depth);assert(u.rooms.every(r=>r.width>0&&r.depth>0));}}
});
test('measurements have independent distance, area and perimeter expectations',()=>{
 assert.deepEqual(studioMeasurement([[0,0],[3,4]],'distance'),{value:5,unit:'m'});
 assert.deepEqual(studioMeasurement([[0,0],[10,0],[10,8],[0,8]],'area'),{value:80,unit:'m²'});
 assert.deepEqual(studioMeasurement([[0,0],[10,0],[10,8],[0,8]],'perimeter'),{value:36,unit:'m'});
 assert.equal(studioMeasurement([[0,0],[10,0],[10,8],[0,8]],'area',2)?.value,320);
 assert.throws(()=>studioMeasurement([[0,0],[10,8],[0,8],[10,0]],'area'));
 assert.throws(()=>studioMeasurement([[0,0],[NaN,4]],'distance'));
 assert.equal(studioMeasurement([[0,0]],'distance'),null);
});
test('local drafts persist exact source and unit metadata and reject stale writes',()=>{
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
 const input:StudioDraft={schemaVersion:'studio-local-draft/1',buildingId:hero.id,revision:0,sourceHash:'a'.repeat(64),floor:0,unitId:hero.units[0].id,tool:'distance',points:[[0,0],[3,4]],calibration:1,notes:'Local fixture check',status:'draft',updatedAt:'2026-09-19T00:00:00Z'};
 const saved=saveStudioDraft(storage,input);assert.equal(saved.revision,1);assert.deepEqual(loadStudioDraft(storage,hero.id,0),saved);assert.throws(()=>saveStudioDraft(storage,input),/another tab/);
 const review=saveStudioDraft(storage,{...saved,status:'ready_for_review'});assert.equal(review.revision,2);assert.equal(review.status,'ready_for_review');
});

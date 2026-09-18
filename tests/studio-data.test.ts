import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {district,computeFindings,exportGeoJSON,STUDIO_DATA_VERSION} from '../apps/web/features/studio/data/district';
import {getFloorLayout} from '../apps/web/features/studio/data/floorLayout';
import {validateCoreSnapshotInput,measureCoreCatalog,buildCoreSnapshot} from '../packages/contracts/src';
import {handleStudioSource} from '../apps/web/lib/server/studio-sources';
import {loadStudioDraft,saveStudioDraft,studioMeasurement,type StudioDraft} from '../apps/web/features/studio/data/workspace-draft';
const require=createRequire(new URL('../apps/web/package.json',import.meta.url)),{unzipSync}=require('fflate');
const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const root='fixtures/studio/reference-v2',hero=district.buildings.find(b=>b.id===district.defaultBuildingId)!;
test('synthetic reference has independently expected full neighbourhood and hero quantities',()=>{
 assert.equal(district.buildings.length,62);assert.equal(hero.width*hero.depth,288);assert.equal(hero.height,16);assert.equal(hero.width*hero.depth*hero.height,4608);
 assert.deepEqual(computeFindings(hero).map(f=>[f.type,f.value]),[['Parcel',32],['Road',16],['Utility',1.8]]);
 assert.equal(district.buildings.reduce((n,b)=>n+b.units.length,0),478);
 assert.equal(new Set(district.buildings.flatMap(b=>b.units.map(u=>u.id))).size,478);
});
test('prepared native geometry, document manifest and runtime dataset agree',async()=>{
 const manifest=JSON.parse(await readFile(root+'/manifest.json','utf8')),raw=await readFile(root+'/records.json');
 assert.equal(manifest.datasetVersion,STUDIO_DATA_VERSION);assert.equal(manifest.datasetSha256,sha(raw));
 assert.deepEqual(JSON.parse(raw.toString()).district,district);
 assert.equal(manifest.documents.length,903);
 const core=JSON.parse(await readFile(root+'/normalized-core.json','utf8'));validateCoreSnapshotInput(core.input);
 const snapshot=await buildCoreSnapshot(core.input);assert.equal(snapshot.manifest.inputDigest,manifest.coreInputDigest);
 const q=measureCoreCatalog(snapshot.geometry,core.input.identity,core.input.sources,core.input.frames).find(q=>q.representation.ref.id===hero.id)!;
 assert.equal(q.horizontalArea.value,288);assert.equal(q.prismVolume.value,4608);assert.equal(snapshot.geometry.representations.length,872);
});
test('every prepared PDF and every source asset has verified original bytes',async()=>{
 const manifest=JSON.parse(await readFile(root+'/manifest.json','utf8')),zip=await readFile(root+'/source-bundle.zip'),files=unzipSync(zip);
 const ids=new Set<string>();
 for(const d of manifest.documents){assert(!ids.has(d.id));ids.add(d.id);const b=files['documents/'+d.filename];assert(b);assert.equal(b.length,d.bytes);assert.equal(sha(b),d.sha256);assert.equal(Buffer.from(b).subarray(0,5).toString(),'%PDF-');assert(d.pages>0);assert(d.filename.startsWith('DEMO-'));}
 for(const a of manifest.assets){const b=await readFile(root+'/'+a.file);assert.equal(b.length,a.bytes);assert.equal(sha(b),a.sha256);}
});
test('parcel and building GIS exports are distinct data rather than renamed duplicates',()=>{
 const parcels=exportGeoJSON('parcels'),buildings=exportGeoJSON('buildings'),p=parcels.features.find(f=>f.properties.building_id===hero.id)!,b=buildings.features.find(f=>f.id===hero.id)!;
 assert.equal(p.id,hero.parcelId);assert.notDeepEqual(p.geometry,b.geometry);assert.equal(b.properties.footprint_m2,288);assert.equal(p.properties.parcel_area_m2,506.25);
});
test('unit plan, register and source room-net area use the same reusable layout',()=>{
 for(const b of district.buildings)for(let floor=0;floor<b.floors;floor++){const layout=getFloorLayout(b,floor);assert.equal(layout.units.length,2);for(const u of layout.units){assert.equal(u.unit.floor,floor);assert(u.unit.area<u.boundary.width*u.boundary.depth);assert(u.rooms.every(r=>r.width>0&&r.depth>0));}}
});
test('source API returns only allowlisted byte-verified documents and preserves unknown references',async()=>{
 const r=await handleStudioSource(new Request('http://localhost/api/v1/studio/sources/documents/plan-BLD-0413-F0'),['documents','plan-BLD-0413-F0']);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/pdf');const bytes=new Uint8Array(await r.arrayBuffer());assert.equal(r.headers.get('etag'),`"${sha(bytes)}"`);
 for(const parts of [['documents','missing'],['assets','../../.env'],['unknown'],['documents','../../../']])assert.equal((await handleStudioSource(new Request('http://localhost/source'),parts)).status,404);
 assert.equal((await handleStudioSource(new Request('http://localhost/source?path=../../.env'),['manifest.json'])).status,404);
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

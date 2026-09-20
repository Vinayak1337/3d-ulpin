import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {normalizeSourceFiles} from '../apps/web/features/spatial/reference-import/source-normalizer';
import {adaptReferenceScene} from '../apps/web/features/spatial/reference-import/adapter';

async function packageFiles(profile='reference'){
 const path=`design/reference-map-v5/data/source-showcase-${profile}`;
 return new Map(await Promise.all((await readdir(path)).map(async name=>[name,new Uint8Array(await readFile(`${path}/${name}`))] as const)));
}
async function editFile(files:Map<string,Uint8Array>,path:string,edit:(text:string)=>string){
 const bytes=new TextEncoder().encode(edit(new TextDecoder().decode(files.get(path))));files.set(path,bytes);
 const manifest=JSON.parse(new TextDecoder().decode(files.get('source-manifest.json')));
 const item=manifest.files.find((item:{path:string})=>item.path===path);item.bytes=bytes.length;item.sha256=createHash('sha256').update(bytes).digest('hex');
 files.set('source-manifest.json',new TextEncoder().encode(JSON.stringify(manifest)));
}

test('two source-style datasets normalize with same schema, no normalized.json, and every building has linked demo IDs/floors',async()=>{
 for(const [profile,count] of [['dense',82],['reference',28]] as const){
  const files=await packageFiles(profile),before=Array.from(files,([path,bytes])=>[path,createHash('sha256').update(bytes).digest('hex')]);
  assert.equal(files.has('normalized.json'),false);
  const result=await normalizeSourceFiles(files),canonical=await adaptReferenceScene(result.normalizedText);
  assert.equal(canonical.input.schemaVersion,'ulpin-spatial/2');assert.equal(canonical.snapshot.manifest.state,'candidate');
  const buildings=result.scene.objects.filter(object=>object.type==='building');assert.equal(buildings.length,count);
  for(const building of buildings){
   assert.match(String(building.attributes.internal3dId),/^DEMO-3D-/);assert.match(String(building.attributes.parcel2dDemoId),/^DEMO-2D-/);
   const floorIds=result.scene.relations.filter(relation=>relation.fromId===building.id).map(relation=>relation.toId);
   const floors=result.scene.objects.filter(object=>object.type==='floor'&&floorIds.includes(object.id));assert.ok(floors.length>0);
   for(const floor of floors)assert.equal(floor.attributes.internal3dId,`${building.attributes.internal3dId}:${floor.attributes.level}`);
  }
  assert.ok(result.scene.identifierAssertions.every(assertion=>assertion.status==='fictional'));
  assert.deepEqual(Array.from(files,([path,bytes])=>[path,createHash('sha256').update(bytes).digest('hex')]),before);
  for(const source of result.scene.sources){const path=String(source.originalUri).replace(/^dataset\//,'');assert.deepEqual(result.originals.get(path),files.get(path));}
 }
});

test('schedule claims never manufacture unit geometry or ownership',async()=>{
 const result=await normalizeSourceFiles(await packageFiles());
 const scheduleOnly=result.scene.objects.filter(object=>object.type==='space'&&object.attributes.geometryEvidence==='schedule_only');
 assert.ok(scheduleOnly.length>50);assert.ok(scheduleOnly.every(object=>object.geometryId===null));
 const supplied=result.scene.objects.find(object=>object.id==='B01-F0-U1');assert.ok(supplied?.geometryId,'supplied authored unit remains geometric');
 const residentTargets=result.scene.objects.filter(object=>Array.isArray(object.attributes.occupants));assert.ok(residentTargets.length>0);
 for(const target of residentTargets){
  assert.ok(['floor','space'].includes(target.type));
  for(const resident of target.attributes.occupants as {role:string;classification:string;name:string;sourceRecordId:string}[]){
   assert.equal(resident.role,'resident');assert.equal(resident.classification,'synthetic');assert.match(resident.name,/^Fictional Resident /);assert.ok(result.scene.sourceRecords.some(record=>record.id===resident.sourceRecordId));
  }
 }
 assert.equal(result.scene.rights.length,0);
});

test('source floor geometry and footprints preserve original source rings and revisions',async()=>{
 const original=JSON.parse(await readFile('design/reference-map-v5/data/reference-scene.json','utf8'));
 const result=await normalizeSourceFiles(await packageFiles('dense'));
 for(const geometry of original.geometries){
  const normalized=result.scene.geometries.find(candidate=>candidate.id===geometry.id);
  assert.ok(normalized,`Original geometry ${geometry.id} retained`);
  assert.deepEqual(normalized.coordinates,geometry.coordinates);assert.equal(normalized.version,geometry.version);assert.equal(normalized.baseElevationM,geometry.baseElevationM);assert.equal(normalized.heightM,geometry.heightM);
 }
});

test('corrupted bytes and unrelated CRS declarations are rejected before deriving canonical geometry',async()=>{
 const corrupt=await packageFiles();corrupt.get('buildings.geojson')![20]^=1;
 await assert.rejects(normalizeSourceFiles(corrupt),/fingerprint/);
 const otherFrame=await packageFiles();await editFile(otherFrame,'buildings.geojson',text=>{const value=JSON.parse(text);value.crs.properties.name='EPSG:4326';return JSON.stringify(value);});
 await assert.rejects(normalizeSourceFiles(otherFrame),/named local frame/);
});

test('ambiguous duplicate CSV headers and resident parent mismatch fail without silently assigning occupants',async()=>{
 const duplicate=await packageFiles();await editFile(duplicate,'floor-schedule.csv',text=>text.replace('record_id,building_id,','record_id,record_id,'));
 await assert.rejects(normalizeSourceFiles(duplicate),/duplicate-column/);
 const mismatch=await packageFiles();await editFile(mismatch,'fictional-residents.csv',text=>text.replace(',B01,B01-F0,',',B02,B01-F0,'));
 await assert.rejects(normalizeSourceFiles(mismatch),/location mismatch/);
});

test('resident source may target an explicitly supplied floor without inventing a unit',async()=>{
 const files=await packageFiles();
 await editFile(files,'fictional-residents.csv',text=>text.replace(',B01-F0,B01-F0-U1,',',B01-F0,,'));
 const result=await normalizeSourceFiles(files),floor=result.scene.objects.find(object=>object.id==='B01-F0')!;
 assert.ok(Array.isArray(floor.attributes.occupants));assert.equal((floor.attributes.occupants as unknown[]).length,1);
});

test('blank quantities stay unknown; booleans/arrays cannot become measured zero',async()=>{
 const files=await packageFiles();
 await editFile(files,'buildings.geojson',text=>{const json=JSON.parse(text);json.features[0].properties.height_m='   ';return JSON.stringify(json);});
 const result=await normalizeSourceFiles(files);assert.equal(result.scene.geometries.find(g=>g.objectId==='B01')?.heightM,null);
 for(const bad of [false,[],{}]){await editFile(files,'buildings.geojson',text=>{const json=JSON.parse(text);json.features[0].properties.base_elevation_m=bad;return JSON.stringify(json);});await assert.rejects(normalizeSourceFiles(files),/Invalid numeric/);}
});
test('multi-parcel associations keep all 2D assertions without arbitrary last parcel identity',async()=>{
 const files=await packageFiles();
 await editFile(files,'buildings.geojson',text=>{const json=JSON.parse(text);json.features[0].properties.parcel_ids=['P01','P02'];return JSON.stringify(json);});
 const result=await normalizeSourceFiles(files),building=result.scene.objects.find(o=>o.id==='B01')!;
 assert.equal(building.attributes.parcel2dDemoId,undefined);assert.equal((building.attributes.parcel2dIds as string[]).length,2);
 assert.equal(result.scene.relations.filter(r=>r.toId==='B01').length,2);
});
test('slash-containing identity pairs retain distinct links and canonical-valid relation IDs',async()=>{
 const files=await packageFiles();
 await editFile(files,'parcels.geojson',text=>{const json=JSON.parse(text),base=json.features[0];json.features.push({...base,id:'P/A',properties:{...base.properties,parcel_id:'P/A',geometry_id:'test-geometry-P-A'}},{...base,id:'P',properties:{...base.properties,parcel_id:'P',geometry_id:'test-geometry-P'}});return JSON.stringify(json);});
 await editFile(files,'buildings.geojson',text=>{const json=JSON.parse(text),base=json.features[0];json.features.push({...base,id:'B',properties:{...base.properties,building_id:'B',geometry_id:'test-geometry-B',internal_3d_id:'TEST-B',parcel_ids:['P/A']}},{...base,id:'A/B',properties:{...base.properties,building_id:'A/B',geometry_id:'test-geometry-A-B',internal_3d_id:'TEST-A-B',parcel_ids:['P']}});return JSON.stringify(json);});
 const result=await normalizeSourceFiles(files);
 assert.ok(result.scene.relations.some(r=>r.fromId==='P/A'&&r.toId==='B'));assert.ok(result.scene.relations.some(r=>r.fromId==='P'&&r.toId==='A/B'));
 await adaptReferenceScene(result.normalizedText);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProvidedDatasetFiles} from '../apps/web/features/spatial/reference-import/source-adapters';
import {adaptReferenceScene} from '../apps/web/features/spatial/reference-import/adapter';
const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
const frame='LOCAL-SHIV-VIHAR-DEMO',datum='local assumed mean sea level';
const open=[[1,1],[9,1],[9,8],[1,8]],closed=[...open,open[0]];
function fixture(){
 const master={scene_id:'NEW-SOURCE-BLOCK',scene_name:'Independent supplied-format example',scene_version:'1.0.0',design_note:'Synthetic fixture matching inspected field names, not a surveyed site.',coordinate_reference_system:{name:frame,units:'metres',axes:{X:'Easting',Y:'Northing',Z:'elevation'},horizontal_extent:[0,0,40,40],vertical_reference:datum},parcels:[{id:'plot-one',geometry:[[0,0],[12,0],[12,12],[0,12]],building_ids:['house-one']},{id:'plot-two',geometry:[[15,0],[27,0],[27,12],[15,12]],building_ids:['house-two']}],buildings:[{id:'house-one',parcel_id:'plot-one',footprint:open,height_m:12,floors:4,usage:'residential'},{id:'house-two',parcel_id:'plot-two',footprint:open.map(([x,y])=>[x+15,y]),height_m:9,floors:3,usage:'residential'}],roads:[{id:'street',centerline:[[0,15],[35,15]],width_m:6}],lanes:[{id:'lane',centerline:[[12,0],[12,15]],width_m:3}],utility_features:{drains:[{id:'drain',type:'drain',centerline:[[0,16],[35,16]],width_m:.4}],poles:[{id:'pole',type:'pole',location:[12,16,101]}],other:[]},terrain:{elevation_range_m:[98,104]},open_areas:[{id:'vacant-private',type:'vacant_plot',geometry:open}]};
 const geometry=(coordinates:number[][][],type='Polygon')=>({type,coordinates,coordinateFrame:frame,horizontalUnit:'metre',verticalUnit:'metre'});
 const normalized=(schema:string,records:unknown[])=>({schema,coordinateFrame:frame,horizontalUnit:'metre',records});
 return new Map<string,Uint8Array>([
  ['provided-source-manifest.json',encode({schemaVersion:'ulpin-provided-source/1',mode:'normalized',classification:'synthetic'})],
  ['MASTER_SCENE.json',encode(master)],
  ['normalized/parcels.json',encode(normalized('canonical.parcels.v1',master.parcels.map(p=>({canonicalParcelId:p.id,geometry:geometry([[...p.geometry,p.geometry[0]]]),sourceParcelIdentifiers:[p.id]}))))],
  ['normalized/buildings.json',encode(normalized('canonical.buildings.v1',master.buildings.map(b=>({canonicalBuildingId:b.id,canonicalParcelIds:[b.parcel_id],geometry:geometry([[...b.footprint,b.footprint[0]]]),heightM:b.height_m,floorCount:b.floors,useType:b.usage,sourceRevisionId:'1.0.0'}))))],
  ['normalized/roads.json',encode(normalized('canonical.roads.v1',[{roadId:'street',widthM:6,geometry:{...geometry([]),'type':'LineString',coordinates:[[0,15],[35,15]]}}]))],
  ['normalized/floor_spaces.json',encode(normalized('canonical.floor-spaces.v1',master.buildings.map(b=>({buildingId:b.id,floorId:'F00',floorName:'Ground Floor',level:0,unitId:'GF-S01',unitType:'retail_shop',areaSqM:25,geometryReference:{type:'source_footprint_within_plan',buildingFootprint:b.footprint,coordinateFrame:frame,note:'No unit polygon source exists.'}}))))],
 ]);
}

test('actual MASTER field profile retains exact originals, closes implicit rings only, and preserves null vertical placement',async()=>{
 const files=fixture(),before=structuredClone(files),result=await normalizeProvidedDatasetFiles(files,{mode:'master'});
 assert.deepEqual(files,before);for(const [path,bytes] of files)if(path!=='provided-source-manifest.json')assert.deepEqual(result.originals.get(path),bytes);
 assert.equal(result.originals.has('provided-source-manifest.json'),false);
 const house=result.scene.geometries.find(g=>g.objectId==='house-one')!;assert.deepEqual(house.coordinates,[closed]);assert.equal(house.baseElevationM,null);assert.equal(house.heightM,12);
 assert.equal(result.scene.frames[0].verticalDatum,datum);
 const road=result.scene.geometries.find(g=>g.objectId==='street')!;assert.equal(road.type,'LineString');assert.deepEqual(road.coordinates,[[0,15],[35,15]]);
 assert.equal(result.scene.objects.some(o=>o.id==='vacant-private'),false,'a vacant private plot is not relabelled public land');
 const canonical=await adaptReferenceScene(result.normalizedText);const buildingRep=canonical.input.geometry.representations.find(r=>r.entity.id==='house-one')!;
 assert.equal(buildingRep.geometry.profile,'prism');if(buildingRep.geometry.profile==='prism')assert.equal(buildingRep.geometry.interval,null);
});

test('observed normalized JSON profile keeps floor/unit source identity scoped by building and does not reuse building outline as unit geometry',async()=>{
 const result=await normalizeProvidedDatasetFiles(fixture());
 assert.equal(result.scene.objects.filter(o=>o.type==='floor').length,2);assert.equal(result.scene.objects.filter(o=>o.type==='space').length,2);
 for(const id of ['house-one','house-two']){
  const floor=result.scene.objects.find(o=>o.id===`${id}/floor/F00`)!,unit=result.scene.objects.find(o=>o.id===`${id}/unit/GF-S01`)!;
  assert.equal(floor.geometryId,null);assert.equal(unit.geometryId,null);assert.equal(unit.attributes.sourceUnitId,'GF-S01');assert.equal(unit.attributes.statedAreaM2,25);
  assert.equal(floor.attributes.internal3dId,`DEMO-3D-${id}:0`);assert.equal(unit.attributes.occupants,undefined);
 }
 assert.ok(result.scene.identifierAssertions.every(i=>i.issuer==='app_demo_identifier'&&i.status==='fictional'&&i.provenance.notExtracted));
 assert.equal(result.scene.identifierAssertions.some(i=>i.scheme==='2d_ulpin'),false);
 await adaptReferenceScene(result.normalizedText);
});

test('normalized frame mismatch and nonnumeric source height are rejected, not coerced',async()=>{
 const files=fixture(),wrong=JSON.parse(new TextDecoder().decode(files.get('normalized/buildings.json')));wrong.coordinateFrame='unrelated-local-frame';files.set('normalized/buildings.json',encode(wrong));
 await assert.rejects(normalizeProvidedDatasetFiles(files),/frame mismatch/);
 const another=fixture(),master=JSON.parse(new TextDecoder().decode(another.get('MASTER_SCENE.json')));master.buildings[0].height_m='12';another.set('MASTER_SCENE.json',encode(master));
 await assert.rejects(normalizeProvidedDatasetFiles(another,{mode:'master'}));
});

test('master-only input does not infer floor records or elevations from building floor count/terrain range',async()=>{
 const files=fixture();files.delete('normalized/floor_spaces.json');
 const result=await normalizeProvidedDatasetFiles(files,{mode:'master'});
 assert.equal(result.scene.objects.filter(o=>o.type==='floor').length,0);
 assert.ok(result.scene.geometries.every(g=>g.baseElevationM===null));
 assert.ok(result.diagnostics.some(d=>d.code==='BUILDING_BASE_UNKNOWN'));
 assert.equal(result.scene.rights.length,0);
});


test('slash-containing source identities cannot alias containment IDs and repeated schedule evidence is merged',async()=>{
 const files=fixture(),master=JSON.parse(new TextDecoder().decode(files.get('MASTER_SCENE.json')));
 master.parcels[0].id='a';master.parcels[0].building_ids=['b/c'];master.buildings[0].id='b/c';master.buildings[0].parcel_id='a';
 master.parcels[1].id='a/b';master.parcels[1].building_ids=['c'];master.buildings[1].id='c';master.buildings[1].parcel_id='a/b';
 files.set('MASTER_SCENE.json',encode(master));files.delete('normalized/floor_spaces.json');
 const result=await normalizeProvidedDatasetFiles(files,{mode:'master'});
 assert.equal(result.scene.relations.length,2);assert.equal(new Set(result.scene.relations.map(r=>r.id)).size,2);
 await adaptReferenceScene(result.normalizedText);
 const repeated=fixture(),schedule=JSON.parse(new TextDecoder().decode(repeated.get('normalized/floor_spaces.json')));
 schedule.records.push({...schedule.records[0],unitId:'GF-S02'});repeated.set('normalized/floor_spaces.json',encode(schedule));
 const normalized=await normalizeProvidedDatasetFiles(repeated);
 const floorLink=normalized.scene.relations.find(r=>r.fromId==='house-one'&&r.toId==='house-one/floor/F00')!;
 assert.equal(floorLink.sourceRecordIds.length,2);
});

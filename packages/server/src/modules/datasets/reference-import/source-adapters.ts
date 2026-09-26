import {z} from 'zod';

const id=z.string().min(1).max(256),numeric=z.number().finite(),ring=z.array(z.tuple([numeric,numeric])).min(3).max(256),line=z.array(z.tuple([numeric,numeric])).min(2).max(1000);
const masterSchema=z.object({
 scene_id:id,scene_name:z.string().min(1),scene_version:z.literal('1.0.0'),design_note:z.string(),
 coordinate_reference_system:z.object({name:id,units:z.literal('metres'),axes:z.object({X:z.literal('Easting'),Y:z.literal('Northing'),Z:z.literal('elevation')}),horizontal_extent:z.tuple([numeric,numeric,numeric,numeric]),vertical_reference:z.string().min(1)}).passthrough(),
 parcels:z.array(z.object({id,geometry:ring,building_ids:z.array(id),land_use:z.string().optional()}).passthrough()).max(1000),
 buildings:z.array(z.object({id,parcel_id:id,footprint:ring,height_m:numeric.nonnegative().nullable(),floors:numeric.int().nonnegative(),usage:z.string().optional()}).passthrough()).max(1000),
 roads:z.array(z.object({id,name:z.string().optional(),centerline:line,width_m:numeric.positive()}).passthrough()).max(1000),
 lanes:z.array(z.object({id,centerline:line,width_m:numeric.positive()}).passthrough()).optional(),
 utility_features:z.object({drains:z.array(z.object({id,centerline:line,width_m:numeric.positive()}).passthrough()).optional(),poles:z.array(z.object({id,location:z.tuple([numeric,numeric,numeric])}).passthrough()).optional(),other:z.array(z.object({id,location:z.tuple([numeric,numeric,numeric])}).passthrough()).optional()}).passthrough().optional(),
}).passthrough();
const collection=(schema:string)=>z.object({schema:z.literal(schema),coordinateFrame:id,horizontalUnit:z.literal('metre'),verticalUnit:z.literal('metre').optional(),records:z.array(z.record(z.string(),z.unknown())).max(1500)}).passthrough();
const sourceProfile=z.object({schemaVersion:z.literal('ulpin-provided-source/1'),mode:z.enum(['master','normalized']),classification:z.literal('synthetic')});
type Row=Record<string,unknown>;
interface ObjectRecord {id:string;type:string;label:string;systemId?:string;geometryId:string|null;sourceRecordIds:string[];attributes:Row}
interface GeometryRecord {id:string;objectId:string;version:number;frameId:string;verticalDatum:string;type:string;coordinates:unknown;baseElevationM:null;heightM:number|null;sourceRecordIds:string[]}
export interface ProvidedSourceDiagnostic {code:string;message:string;objectId?:string;path?:string}
const decode=new TextDecoder('utf-8',{fatal:true});
const sha256=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),n=>n.toString(16).padStart(2,'0')).join('');
const safePath=(path:string)=>!!path&&!path.startsWith('/')&&!path.includes('\\')&&!path.includes('\0')&&!path.split('/').some(part=>part==='..'||part==='.'||part.includes(':'));
const closed=(points:number[][])=>points[0][0]===points.at(-1)![0]&&points[0][1]===points.at(-1)![1]?structuredClone(points):[...structuredClone(points),[...points[0]]];

/** Observed Shiv Vihar source formats, with original bytes and unknown vertical placement retained. */
export async function normalizeProvidedDatasetFiles(files:ReadonlyMap<string,Uint8Array>,options?:{mode:'master'|'normalized'}){
 let mode=options?.mode;
 if(!mode){const manifest=files.get('provided-source-manifest.json');if(!manifest)throw new Error('Choose an explicit provided-source profile');mode=sourceProfile.parse(JSON.parse(decode.decode(manifest))).mode;}
 const masterBytes=files.get('MASTER_SCENE.json');if(!masterBytes)throw new Error('MASTER_SCENE.json supplies the named frame and original vertical-reference wording');
 const master=masterSchema.parse(JSON.parse(decode.decode(masterBytes)));
 if(!/^Synthetic\b/i.test(master.design_note))throw new Error('This observed source adapter only accepts explicitly synthetic MASTER_SCENE baselines');
 const originalMaster=JSON.parse(decode.decode(masterBytes)) as Row;
 const frame={id:master.coordinate_reference_system.name,name:master.coordinate_reference_system.name,kind:'local_cartesian' as const,horizontalUnit:'metre' as const,verticalUnit:'metre' as const,axisOrder:['east','north','up'] as ['east','north','up'],verticalDatum:master.coordinate_reference_system.vertical_reference};
 const objects=new Map<string,ObjectRecord>(),geometries:GeometryRecord[]=[],relations:{id:string;fromId:string;toId:string;kind:'contains';sourceRecordIds:string[]}[]=[],sourceRecords:Row[]=[],sources:Row[]=[],originals=new Map<string,Uint8Array>(),diagnostics:ProvidedSourceDiagnostic[]=[];
 let total=0;
 for(const [path,bytes] of files){
  if(!safePath(path))throw new Error('Unsafe source path');total+=bytes.length;if(total>30*1024*1024||files.size>100)throw new Error('Provided source package exceeds receipt limits');
  if(['manifest.json','provided-source-manifest.json'].includes(path))continue;
  originals.set(path,new Uint8Array(bytes));
  sources.push({id:`provided-source/${path}`,label:path,revision:master.scene_version,mimeType:path.endsWith('.json')?'application/json':'application/octet-stream',classification:'synthetic',representation:'original_file',originalUri:`dataset/${path}`,originalSha256:await sha256(bytes),byteSize:bytes.length,note:'Original supplied bytes; source-reported external assets were not fetched or promoted to verified evidence.'});
 }
 const source=(path:string)=>`provided-source/${path}`;
 function record(path:string,pointer:string,row:Row){const recordId=`provided-record/${path}/${pointer}`;sourceRecords.push({id:recordId,sourceId:source(path),sourceRevision:master.scene_version,locator:`${path}#/${pointer}`,attributes:structuredClone(row)});return recordId;}
 function add(idValue:string,type:string,label:string,raw:Row,recordId:string,shape?:{type:string;coordinates:unknown},height:number|null=null,extra:Row={}){
  id.parse(idValue);if(objects.has(idValue))throw new Error(`Duplicate provided identity: ${idValue}`);
  const geometryId=shape?`provided-geometry/${idValue}/v1`:null;
  const object={id:idValue,type,label,geometryId,sourceRecordIds:[recordId],attributes:{...structuredClone(raw),...extra,classification:'synthetic',verticalPlacement:'unknown'}};
  objects.set(idValue,object);
  if(shape)geometries.push({id:geometryId!,objectId:idValue,version:1,frameId:frame.id,verticalDatum:frame.verticalDatum,type:shape.type,coordinates:structuredClone(shape.coordinates),baseElevationM:null,heightM:height,sourceRecordIds:[recordId]});
  return object;
 }
 function link(parent:string,child:string,recordId:string){
  const existing=relations.find(relation=>relation.fromId===parent&&relation.toId===child);
  if(existing){if(!existing.sourceRecordIds.includes(recordId))existing.sourceRecordIds.push(recordId);return;}
  relations.push({id:'pending',fromId:parent,toId:child,kind:'contains',sourceRecordIds:[recordId]});
 }
 function readCollection(path:string,schema:string){
  const bytes=files.get(path);if(!bytes)throw new Error(`Missing supplied normalized file: ${path}`);
  const data=collection(schema).parse(JSON.parse(decode.decode(bytes)));
  if(data.coordinateFrame!==frame.name)throw new Error(`Source frame mismatch: ${path}`);
  return data.records;
 }
 function planar(row:Row,path:string){
  const geometry=z.object({type:z.enum(['Polygon','MultiPolygon','LineString']),coordinates:z.unknown(),coordinateFrame:id,horizontalUnit:z.literal('metre'),verticalUnit:z.literal('metre').optional()}).passthrough().parse(row.geometry);
  if(geometry.coordinateFrame!==frame.name)throw new Error(`Geometry frame mismatch: ${path}`);
  return {type:geometry.type,coordinates:geometry.coordinates};
 }
 if(mode==='master'){
  master.parcels.forEach((row,n)=>{const r=record('MASTER_SCENE.json',`parcels/${n}`,row);add(row.id,'parcel',row.id,row,r,{type:'Polygon',coordinates:[closed(row.geometry)]},null,{use:row.land_use,geometryEvidence:'supplied_master_ring'});});
  master.buildings.forEach((row,n)=>{const r=record('MASTER_SCENE.json',`buildings/${n}`,row);add(row.id,'building',row.id,row,r,{type:'Polygon',coordinates:[closed(row.footprint)]},row.height_m,{floorCount:row.floors,use:row.usage,reportedHeightM:row.height_m,geometryEvidence:'supplied_master_footprint'});link(row.parcel_id,row.id,r);});
  for(const key of ['roads','lanes'] as const)(master[key]??[]).forEach((row,n)=>{const r=record('MASTER_SCENE.json',`${key}/${n}`,row);add(row.id,'road',typeof row.name==='string'?row.name:row.id,row,r,{type:'LineString',coordinates:row.centerline},null,{widthM:row.width_m,geometryEvidence:'source_centerline_only'});});
  for(const key of ['drains','poles','other'] as const)(master.utility_features?.[key]??[]).forEach((row,n)=>{
   const r=record('MASTER_SCENE.json',`utility_features/${key}/${n}`,row),centerline='centerline' in row?row.centerline:null,location='location' in row?row.location:null;
   add(row.id,'utility',`${String(row.type??key)} · ${row.id}`,row,r,centerline?{type:'LineString',coordinates:centerline}:{type:'Point',coordinates:location},null,{geometryEvidence:centerline?'source_alignment':'source_point',utilityType:row.type??key});
  });
  diagnostics.push({code:'IMPLICIT_RING_CLOSURE',message:'MASTER_SCENE rings are explicitly described by the source as implicitly closed. The adapter appends only the first vertex; original bytes/vertex order remain unchanged.'});
 }else{
  readCollection('normalized/parcels.json','canonical.parcels.v1').forEach((row,n)=>{const r=record('normalized/parcels.json',`records/${n}`,row);add(id.parse(row.canonicalParcelId),'parcel',id.parse(row.canonicalParcelId),row,r,planar(row,'parcels'),null,{use:row.landUse,geometryEvidence:'supplied_normalized_polygon'});});
  readCollection('normalized/buildings.json','canonical.buildings.v1').forEach((row,n)=>{
   const r=record('normalized/buildings.json',`records/${n}`,row),buildingId=id.parse(row.canonicalBuildingId),height=row.heightM==null?null:numeric.nonnegative().parse(row.heightM);
   add(buildingId,'building',buildingId,row,r,planar(row,'buildings'),height,{floorCount:numeric.int().nonnegative().parse(row.floorCount),use:row.useType,reportedHeightM:height,geometryEvidence:'supplied_normalized_polygon'});
   for(const parcelId of z.array(id).parse(row.canonicalParcelIds))link(parcelId,buildingId,r);
  });
  readCollection('normalized/roads.json','canonical.roads.v1').forEach((row,n)=>{const r=record('normalized/roads.json',`records/${n}`,row);add(id.parse(row.roadId),'road',id.parse(row.roadId),row,r,planar(row,'roads'),null,{widthM:numeric.positive().parse(row.widthM),geometryEvidence:'source_centerline_only'});});
 }
 if(files.has('normalized/floor_spaces.json')){
  readCollection('normalized/floor_spaces.json','canonical.floor-spaces.v1').forEach((row,n)=>{
   const r=record('normalized/floor_spaces.json',`records/${n}`,row),buildingId=id.parse(row.buildingId),sourceFloorId=id.parse(row.floorId),sourceUnitId=id.parse(row.unitId),level=numeric.int().parse(row.level);
   if(objects.get(buildingId)?.type!=='building')throw new Error(`Schedule references missing building: ${buildingId}`);
   // Source floor IDs such as F00 are local to a building. Keep both the exact
   // source ID and a reversible compound internal identity; no ULPIN is issued.
   const component=(value:string)=>value.replaceAll('_','__').replaceAll('/','_s');
   const floorId=`${component(buildingId)}/floor/${component(sourceFloorId)}`,unitId=`${component(buildingId)}/unit/${component(sourceUnitId)}`;
   const existingFloor=objects.get(floorId);
   if(existingFloor){if(existingFloor.attributes.level!==level)throw new Error(`Conflicting supplied floor level: ${floorId}`);existingFloor.sourceRecordIds.push(r);}
   else add(floorId,'floor',typeof row.floorName==='string'?row.floorName:sourceFloorId,{buildingId,sourceFloorId,level},r,undefined,null,{geometryEvidence:'schedule_only'});
   link(buildingId,floorId,r);
   add(unitId,'space',`${sourceUnitId} · ${String(row.unitType??'unit')}`,row,r,undefined,null,{buildingId,floorId,sourceUnitId,sourceFloorId,level,unitType:row.unitType,statedAreaM2:row.areaSqM==null?null:numeric.nonnegative().parse(row.areaSqM),geometryEvidence:'schedule_only'});link(floorId,unitId,r);
  });
  diagnostics.push({code:'UNIT_POLYGONS_NOT_SUPPLIED',path:'normalized/floor_spaces.json',message:'The supplied geometryReference is the building footprint and explicitly states that no unit polygon source exists. Floor/space records remain geometry-null; stated areas remain schedule claims.'});
 }
 for(const relation of relations){relation.id=`provided-contains:${await sha256(new TextEncoder().encode(JSON.stringify([relation.fromId,relation.toId])))}`;if(!objects.has(relation.fromId)||!objects.has(relation.toId))throw new Error(`Missing provided relationship endpoint: ${relation.id}`);}
 diagnostics.push({code:'BUILDING_BASE_UNKNOWN',message:'Building heights were supplied but base elevations were not. Every canonical baseElevationM remains null; no measured volume, floor elevation or terrain alignment is inferred.'});
 diagnostics.push({code:'ROAD_CORRIDORS_NOT_SUPPLIED',message:'Roads/lanes are exact centerlines plus stated widths. No measured road polygon is fabricated by buffering or bounding boxes.'});
 diagnostics.push({code:'NO_IDENTITIES_OR_RESIDENTS_SUPPLIED',message:'Source object IDs are retained; no official 2D ULPIN, internal 3D ULPIN, ownership or resident schedule was present in these inspected files. DEMO internal identifiers are generated separately from stable source IDs and explicit supplied floor levels; they are not extracted or officially issued.'});
 const unmapped=['open_areas','vegetation_zones','parking_areas','community_structures','building_appurtenances','vehicles','terrain','constraints'];
 diagnostics.push({code:'UNMAPPED_SOURCE_SECTIONS',message:`Original MASTER_SCENE sections retained as receipt only: ${unmapped.join(', ')}. Open areas are not automatically classified as public ownership; terrain ranges are not a surface or per-building base.`});
 if(mode==='normalized')diagnostics.push({code:'MASTER_CONTEXT_ONLY',message:'Normalized mode uses supplied normalized geometry. MASTER roads/lanes/utilities are retained in the original receipt without merging duplicate representations.'});
 const identifierAssertions=[...objects.values()].filter(object=>object.type==='building'||object.type==='floor').map(object=>{
  const parent=object.type==='floor'?relations.find(relation=>relation.toId===object.id)?.fromId:null;
  const identifier=object.type==='building'?`DEMO-3D-${object.id}`:`DEMO-3D-${parent}:${object.attributes.level}`;
  object.systemId=identifier;object.attributes.internal3dId=identifier;object.attributes.identifierOrigin='generated_internal';
  return {id:`provided-internal-id/${object.id}`,objectId:object.id,scheme:'internal_3d',value:identifier,status:'fictional',issuer:'app_demo_identifier',sourceRecordIds:object.sourceRecordIds,provenance:{method:'deterministic_from_stable_source_building_id_and_explicit_floor_level',notExtracted:true,officialIssuance:false}};
 });
 const firstFloor=[...objects.values()].find(object=>object.type==='floor');
 const focalObjectId=(firstFloor?relations.find(relation=>relation.toId===firstFloor.id)?.fromId:undefined)??[...objects.values()].find(object=>object.type==='building')?.id;
 const scene={schemaVersion:'1.0.0' as const,metadata:{id:`${master.scene_id}:${mode}`,title:`${master.scene_name} · supplied synthetic ${mode}`,classification:'synthetic' as const,officialIssuance:false,extent:master.coordinate_reference_system.horizontal_extent,focalObjectId,sourceProfile:`shiv-vihar-${mode}/1`,sourceSceneId:master.scene_id,sourceSceneVersion:master.scene_version,sourceDatumText:frame.verticalDatum,importDiagnostics:diagnostics,sourceContext:originalMaster},frames:[frame],objects:[...objects.values()],geometries,relations,sources,sourceRecords,identifierAssertions,observations:[],lineage:[],batches:[],issues:[],rights:[]};
 return {scene,normalizedText:JSON.stringify(scene),originals,diagnostics,sourceManifest:{schemaVersion:'ulpin-provided-source/1',mode,classification:'synthetic'}};
}

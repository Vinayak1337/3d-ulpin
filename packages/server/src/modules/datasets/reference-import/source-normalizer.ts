import Papa from 'papaparse';
import {z} from 'zod';

const role=z.enum(['parcels','buildings','floors','spaces','roads','utilities','public_land','floor_schedule','residents','parties','rights','controls','evidence']);
const manifestSchema=z.object({
 schemaVersion:z.literal('ulpin-source-package/1'),classification:z.literal('synthetic'),
 metadata:z.object({id:z.string().min(1),title:z.string().min(1),classification:z.literal('synthetic')}).passthrough(),
 frame:z.object({id:z.string().min(1),name:z.string().min(1),kind:z.literal('local_cartesian'),horizontalUnit:z.literal('metre'),verticalUnit:z.literal('metre'),axisOrder:z.tuple([z.literal('east'),z.literal('north'),z.literal('up')]),verticalDatum:z.string().min(1)}).passthrough(),
 sourceRevision:z.string().min(1),
 files:z.array(z.object({path:z.string().min(1),role,bytes:z.number().int().nonnegative(),sha256:z.string().regex(/^[a-f0-9]{64}$/),mimeType:z.string().optional(),objectIds:z.array(z.string()).optional(),description:z.string().optional()})).min(1).max(90),
 sceneDecoration:z.unknown().optional(),
});
type RecordData=Record<string,unknown>;
interface SceneObject {id:string;type:string;label:string;systemId?:string;geometryId:string|null;sourceRecordIds:string[];attributes:RecordData}
interface SceneGeometry {id:string;objectId:string;version:number;frameId:string;verticalDatum:string;type:string;coordinates:unknown;baseElevationM:number|null;heightM:number|null;sourceRecordIds:string[];classification:'synthetic'}
interface SceneRelation {id:string;fromId:string;toId:string;kind:'contains';sourceRecordIds:string[]}
interface Identifier {id:string;objectId:string;scheme:'2d_ulpin'|'internal_3d';value:string;status:'fictional';sourceRecordIds:string[]}
export interface SourceNormalizationDiagnostic {code:string;objectId?:string;message:string}
const decode=new TextDecoder('utf-8',{fatal:true});
const safePath=(path:string)=>!!path&&!path.startsWith('/')&&!path.includes('\\')&&!path.split('/').some(p=>['.','..'].includes(p)||p.includes(':'));
const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),v=>v.toString(16).padStart(2,'0')).join('');
const str=(value:unknown)=>typeof value==='string'?value.trim():typeof value==='number'?String(value):'';
function number(value:unknown,label:string):number|null {if(value===null||value===undefined||typeof value==='string'&&!value.trim())return null;if(typeof value!=='number'&&typeof value!=='string')throw new Error(`Invalid numeric ${label}`);const n=typeof value==='number'?value:Number(value.trim());if(!Number.isFinite(n))throw new Error(`Invalid numeric ${label}`);return n;}
const value=(row:RecordData,...fields:string[])=>fields.map(field=>row[field]).find(item=>item!==undefined);
const idField:Record<z.infer<typeof role>,string>={parcels:'parcel_id',buildings:'building_id',floors:'floor_id',spaces:'unit_id',roads:'road_id',utilities:'utility_id',public_land:'open_area_id',floor_schedule:'unit_id',residents:'resident_id',parties:'party_id',rights:'right_id',controls:'point_id',evidence:'asset_id'};
const objectType:Record<string,string>={parcels:'parcel',buildings:'building',floors:'floor',spaces:'space',roads:'road',utilities:'utility',public_land:'open_area'};

/** Explicit local GeoJSON + CSV source profile. Receipt-only: no service writes or inferred unit polygons. */
export async function normalizeSourceFiles(files:ReadonlyMap<string,Uint8Array>){
 const rawManifest=files.get('source-manifest.json');if(!rawManifest)throw new Error('Source package needs source-manifest.json');
 const manifest=manifestSchema.parse(JSON.parse(decode.decode(rawManifest)));
 const paths=new Set<string>(),objects=new Map<string,SceneObject>(),geometries:SceneGeometry[]=[],relations:SceneRelation[]=[],identifiers:Identifier[]=[],diagnostics:SourceNormalizationDiagnostic[]=[];
 const sources:RecordData[]=[],sourceRecords:RecordData[]=[],originals=new Map<string,Uint8Array>();
 const pending:{from:string;to:string;record:string}[]=[];
 const sourceRows=new Map<string,{row:RecordData;record:string}[]>();
 let total=0;
 for(const item of manifest.files){
  if(!safePath(item.path)||paths.has(item.path))throw new Error('Duplicate or unsafe source path');paths.add(item.path);
  const bytes=files.get(item.path);if(!bytes||bytes.length!==item.bytes||await hash(bytes)!==item.sha256)throw new Error(`Source fingerprint mismatch: ${item.path}`);
  total+=bytes.length;if(total>30*1024*1024)throw new Error('Source profile exceeds 30 MB');originals.set(item.path,new Uint8Array(bytes));
  const sourceId=`source/${item.path}`;
  sources.push({id:sourceId,label:item.path,revision:manifest.sourceRevision,mimeType:item.mimeType??(item.path.endsWith('.csv')?'text/csv':'application/geo+json'),classification:'synthetic',representation:'original_file',originalUri:`dataset/${item.path}`,originalSha256:item.sha256,byteSize:bytes.length,frameId:manifest.frame.id,verticalDatum:manifest.frame.verticalDatum,role:item.role,processing:item.role==='evidence'?'retained':'normalized',note:item.description});
  if(item.role==='evidence'){
   sourceRecords.push({id:`record/${item.path}/asset`,sourceId,sourceRevision:manifest.sourceRevision,locator:item.path,attributes:{objectIds:item.objectIds??[],description:item.description??'Supporting original retained; no geometry extraction performed.'}});
   continue; // Binary evidence is fingerprinted and retained, never decoded as text.
  }
  const text=decode.decode(bytes),rows:{row:RecordData;record:string}[]=[];
  const addRecord=(row:RecordData,key:string,locator:string)=>{
   const record=`record/${item.path}/${key}`;
   if(sourceRecords.some(r=>r.id===record))throw new Error(`Duplicate source record: ${record}`);
   sourceRecords.push({id:record,sourceId,sourceRevision:manifest.sourceRevision,recordKey:key,locator,attributes:structuredClone(row)});
   rows.push({row,record});return record;
  };
  if(['floor_schedule','residents','parties','rights','controls'].includes(item.role)){
   const header=Papa.parse<string[]>(text,{preview:1}).data[0]??[];
   if(new Set(header).size!==header.length)throw new Error(`Malformed or duplicate-column CSV: ${item.path}`);
   const parsed=Papa.parse<Record<string,string>>(text,{header:true,skipEmptyLines:'greedy'});
   if(parsed.errors.length||parsed.meta.renamedHeaders&&Object.keys(parsed.meta.renamedHeaders).length)throw new Error(`Malformed or duplicate-column CSV: ${item.path}`);
   if(parsed.data.length>5000)throw new Error('Source CSV exceeds 5,000 rows');
   parsed.data.forEach((row,index)=>{const key=['record_id',idField[item.role],item.role==='floor_schedule'?'floor_id':'resident_id'].map(field=>str(row[field])).find(Boolean);if(!key)throw new Error(`Missing stable row identity in ${item.path}`);addRecord(row,key,`${item.path}#row=${index+2}`);});
  }else{
   const collection=JSON.parse(text) as {type?:string;crs?:{properties?:{name?:string}};features?:{type?:string;id?:unknown;properties?:RecordData;geometry?:{type?:string;coordinates?:unknown}|null}[]};
   if(collection.type!=='FeatureCollection'||!Array.isArray(collection.features)||collection.features.length>1500)throw new Error(`Unsupported GeoJSON collection: ${item.path}`);
   if(collection.crs?.properties?.name!==manifest.frame.name&&collection.crs?.properties?.name!==manifest.frame.id)throw new Error(`Declare the exact named local frame in ${item.path}; longitude/latitude is not inferred`);
   collection.features.forEach((feature,index)=>{
    if(feature.type!=='Feature'||!feature.properties)throw new Error(`Invalid feature in ${item.path}`);
    const properties=feature.properties,id=str(value(properties,idField[item.role],'object_id','id')??feature.id);if(!id)throw new Error(`Missing stable feature identity in ${item.path}`);
    if(objects.has(id))throw new Error(`Duplicate source object: ${id}`);
    const record=addRecord(feature as RecordData,id,`${item.path}#/features/${index}`),type=objectType[item.role];
    const internal3dId=str(value(properties,'internal_3d_id','internal3dId')),parcel2dDemoId=str(value(properties,'parcel_2d_demo_id','parcel2dDemoId'));
    const attrs:RecordData={...properties,classification:'synthetic',geometryEvidence:feature.geometry?'authored_source_geometry':'unavailable'};
    if(internal3dId)attrs.internal3dId=internal3dId;if(parcel2dDemoId)attrs.parcel2dDemoId=parcel2dDemoId;
    const floors=number(value(properties,'floor_count','floorCount'),`${id}.floor_count`);if(floors!==null)attrs.floorCount=floors;
    const level=number(value(properties,'level','floor_level'),`${id}.level`);if(level!==null)attrs.level=level;
    const diameter=number(value(properties,'diameter_m','diameterM'),`${id}.diameter`);if(diameter!==null)attrs.diameterM=diameter;
    const object:SceneObject={id,type,label:str(value(properties,'name','label'))||id,geometryId:null,sourceRecordIds:[record],attributes:attrs};if(internal3dId)object.systemId=internal3dId;
    objects.set(id,object);
    if(feature.geometry){
     if(!['Polygon','MultiPolygon','LineString'].includes(feature.geometry.type??''))throw new Error(`Unsupported source geometry: ${id}`);
     const geometryId=str(value(properties,'geometry_id'))||`geometry/${id}/v${str(value(properties,'geometry_revision'))||'1'}`;
     if(geometries.some(g=>g.id===geometryId))throw new Error(`Duplicate geometry identity: ${geometryId}`);
     const revision=number(value(properties,'geometry_revision'),`${id}.revision`)??1;if(!Number.isInteger(revision)||revision<1)throw new Error('Geometry revision must be positive integer');
     object.geometryId=geometryId;
     const datum=str(value(properties,'vertical_reference','verticalDatum'))||manifest.frame.verticalDatum;
     if(datum!==manifest.frame.verticalDatum)throw new Error(`Vertical reference differs on ${id}; reviewed alignment required`);
     geometries.push({id:geometryId,objectId:id,version:revision,frameId:manifest.frame.id,verticalDatum:datum,type:feature.geometry.type!,coordinates:structuredClone(feature.geometry.coordinates),baseElevationM:number(value(properties,'base_elevation_m','baseElevationM'),`${id}.base`),heightM:number(value(properties,'height_m','heightM'),`${id}.height`),sourceRecordIds:[record],classification:'synthetic'});
    }
    const parcelIds=value(properties,'parcel_ids','parcel_id');
    if(type==='building')for(const parcel of Array.isArray(parcelIds)?parcelIds:String(parcelIds??'').split('|').filter(Boolean))pending.push({from:String(parcel),to:id,record});
    if(type==='floor'){const building=str(value(properties,'building_id','buildingId'));if(!building)throw new Error(`Floor ${id} needs building_id`);pending.push({from:building,to:id,record});}
    if(type==='space'){const floor=str(value(properties,'floor_id','floorId'));if(!floor)throw new Error(`Unit ${id} needs floor_id`);pending.push({from:floor,to:id,record});}
    addIdentifiers(object,record);
   });
  }
  sourceRows.set(item.role,[...(sourceRows.get(item.role)??[]),...rows]);
 }
 function addIdentifiers(object:SceneObject,record:string){
  for(const [scheme,field] of [['2d_ulpin','parcel2dDemoId'],['internal_3d','internal3dId']] as const){
   // Only the parcel holds its 2D identifier assertion; linked copies on buildings are search metadata.
   if(scheme==='2d_ulpin'&&object.type!=='parcel')continue;
   const text=str(object.attributes[field]);if(!text)continue;
   const existing=identifiers.find(i=>i.objectId===object.id&&i.scheme===scheme);
   if(existing&&existing.value!==text)throw new Error(`Contradictory identifier for ${object.id}`);
   if(!existing)identifiers.push({id:`identifier/${object.id}/${scheme}`,objectId:object.id,scheme,value:text,status:'fictional',sourceRecordIds:[record]});
  }
 }
 for(const {row,record} of sourceRows.get('floor_schedule')??[]){
  const buildingId=str(value(row,'building_id','buildingId')),floorId=str(value(row,'floor_id','floorId')),unitId=str(value(row,'unit_id','unitId'));
  if(objects.get(buildingId)?.type!=='building'||!floorId)throw new Error(`Schedule ${record} has missing building/floor identity`);
  let floor=objects.get(floorId);
  if(floor&&floor.type!=='floor')throw new Error(`Schedule floor identity collides: ${floorId}`);
  if(!floor){floor={id:floorId,type:'floor',label:str(value(row,'floor_name','floorName'))||floorId,geometryId:null,sourceRecordIds:[],attributes:{geometryEvidence:'schedule_only',classification:'synthetic'}};objects.set(floorId,floor);diagnostics.push({code:'FLOOR_GEOMETRY_UNAVAILABLE',objectId:floorId,message:'Supplied schedule establishes floor identity only; no boundary was supplied.'});}
  floor.sourceRecordIds.push(record);
  const level=number(value(row,'level','floor_level'),`${floorId}.level`);if(level!==null){if(floor.attributes.level!==undefined&&floor.attributes.level!==level)throw new Error(`Contradictory floor level: ${floorId}`);floor.attributes.level=level;}
  const floorIdentifier=str(value(row,'floor_3d_id','floor3dId'));if(floorIdentifier){if(floor.attributes.internal3dId&&floor.attributes.internal3dId!==floorIdentifier)throw new Error(`Contradictory floor ID: ${floorId}`);floor.attributes.internal3dId=floorIdentifier;floor.systemId=floorIdentifier;}
  pending.push({from:buildingId,to:floorId,record});addIdentifiers(floor,record);
  if(unitId){
   let unit=objects.get(unitId);if(unit&&unit.type!=='space')throw new Error(`Schedule unit identity collides: ${unitId}`);
   if(!unit){unit={id:unitId,type:'space',label:str(value(row,'unit_name','unitName','unit_type','unitType'))||unitId,geometryId:null,sourceRecordIds:[],attributes:{geometryEvidence:'schedule_only',classification:'synthetic'}};objects.set(unitId,unit);diagnostics.push({code:'UNIT_GEOMETRY_UNAVAILABLE',objectId:unitId,message:'Schedule-only unit: stated area is not a measured polygon.'});}
   unit.sourceRecordIds.push(record);unit.attributes.statedAreaM2=number(value(row,'area_sq_m','areaSqM'),`${unitId}.area`);unit.attributes.unitType=str(value(row,'unit_type','unitType'))||null;
   const unitIdentifier=str(value(row,'unit_3d_id','unit3dId'));if(unitIdentifier){unit.attributes.internal3dId=unitIdentifier;unit.systemId=unitIdentifier;}
   pending.push({from:floorId,to:unitId,record});addIdentifiers(unit,record);
  }
 }
 const linked=new Map<string,SceneRelation>();
 for(const link of pending){
  if(!objects.has(link.from)||!objects.has(link.to))throw new Error(`Unknown source relationship: ${link.from} → ${link.to}`);
  const from=objects.get(link.from)!,to=objects.get(link.to)!;
  if(!(['parcel:building','building:floor','floor:space'].includes(`${from.type}:${to.type}`)))throw new Error(`Invalid source containment: ${link.from} → ${link.to}`);
  if(to.type==='floor'||to.type==='space'){const previous=relations.find(r=>r.toId===to.id);if(previous&&previous.fromId!==from.id)throw new Error(`Conflicting source parent: ${to.id}`);}
  const key=JSON.stringify([link.from,link.to]),existing=linked.get(key);if(existing){if(!existing.sourceRecordIds.includes(link.record))existing.sourceRecordIds.push(link.record);continue;}
  const relation:SceneRelation={id:`contains/${await hash(new TextEncoder().encode(key))}`,fromId:link.from,toId:link.to,kind:'contains',sourceRecordIds:[link.record]};linked.set(key,relation);relations.push(relation);
 }
 for(const building of objects.values()){if(building.type!=='building')continue;const ids=[...new Set(relations.filter(r=>r.toId===building.id&&objects.get(r.fromId)?.type==='parcel').map(r=>str(objects.get(r.fromId)?.attributes.parcel2dDemoId)).filter(Boolean))];building.attributes.parcel2dIds=ids;if(ids.length===1)building.attributes.parcel2dDemoId=ids[0];else delete building.attributes.parcel2dDemoId;}
 const residentIds=new Set<string>();
 for(const {row,record} of sourceRows.get('residents')??[]){
  const residentId=str(value(row,'resident_id','residentId')),name=str(value(row,'name','resident_name')),unitId=str(value(row,'unit_id','unitId')),floorId=str(value(row,'floor_id','floorId')),buildingId=str(value(row,'building_id','buildingId'));
  if(!residentId||!name||residentIds.has(residentId))throw new Error('Residents need unique stable IDs and supplied names');residentIds.add(residentId);
  if(str(row.classification)!=='synthetic'||str(row.role)!=='resident')throw new Error('This source profile requires explicitly fictional resident records, not ownership assertions');
  const target=objects.get(unitId||floorId);if(!target||!['floor','space'].includes(target.type))throw new Error(`Unknown resident floor/unit: ${residentId}`);
  const actualFloor=target.type==='floor'?target.id:relations.find(r=>r.toId===target.id)?.fromId;
  const actualBuilding=relations.find(r=>r.toId===actualFloor)?.fromId;
  if(floorId&&floorId!==actualFloor||!buildingId||buildingId!==actualBuilding)throw new Error(`Resident location mismatch: ${residentId}`);
  const occupants=(target.attributes.occupants??[]) as RecordData[];
  occupants.push({id:residentId,name,role:'resident',classification:'synthetic',sourceRecordId:record});target.attributes.occupants=occupants;target.sourceRecordIds.push(record);
 }
 // Evidence joins are explicit; a filename is never evidence of a property association.
 for(const item of manifest.files.filter(f=>f.role==='evidence'))for(const objectId of item.objectIds??[]){
  const object=objects.get(objectId);if(!object)throw new Error(`Unknown evidence target: ${objectId}`);
  object.sourceRecordIds.push(`record/${item.path}/asset`);
 }
 const parties=new Map<string,RecordData>();
 for(const {row,record} of sourceRows.get('parties')??[]){
  const id=str(row.party_id);if(!id||!str(row.name)||parties.has(id)||row.classification!=='synthetic')throw new Error('Parties require unique IDs, names and synthetic classification');
  parties.set(id,{id,name:str(row.name),classification:'synthetic',sourceRecordId:record});
 }
 const rights:RecordData[]=[],rightIds=new Set<string>();
 for(const {row,record} of sourceRows.get('rights')??[]){
  const id=str(row.right_id),target=objects.get(str(row.object_id)),party=parties.get(str(row.party_id)),document=str(row.document_path);
  if(!id||rightIds.has(id)||!target||!party||row.classification!=='synthetic'||!['ownership','lease','common_use','utility_easement'].includes(str(row.right_type)))throw new Error(`Invalid fictional right or reference: ${id}`);
  const evidence=manifest.files.find(f=>f.path===document&&f.role==='evidence');
  if(!evidence||!evidence.objectIds?.includes(target.id))throw new Error(`Right ${id} requires a document linked to its target`);
  rightIds.add(id);const right={id,objectId:target.id,partyId:party.id,partyName:party.name,type:str(row.right_type),documentPath:document,status:'unreviewed',classification:'synthetic',sourceRecordId:record,partySourceRecordId:party.sourceRecordId};
  rights.push(right);target.attributes.rights=[...(target.attributes.rights as RecordData[]??[]),right];target.sourceRecordIds.push(record,String(party.sourceRecordId));
 }
 const controls:RecordData[]=[];
 for(const {row,record} of sourceRows.get('controls')??[]){
  if(row.coordinate_frame!==manifest.frame.name||row.vertical_reference!==manifest.frame.verticalDatum)throw new Error(`Control frame requires alignment: ${row.point_id}`);
  const coordinates=['x','y','z'].map(key=>number(row[key],`${row.point_id}.${key}`));
  const accuracy=['horizontal_accuracy_m','vertical_accuracy_m'].map(key=>number(row[key],key));
  if(coordinates.some(v=>v===null)||accuracy.some(v=>v===null||v<0))throw new Error(`Invalid survey control: ${row.point_id}`);
  controls.push({...row,coordinates,sourceRecordId:record,classification:'synthetic'});
 }
 for(const object of objects.values())object.sourceRecordIds=[...new Set(object.sourceRecordIds)];
 const scene={schemaVersion:'1.0.0' as const,metadata:{...manifest.metadata,officialIssuance:false,sourceCoverage:manifest.files.map(f=>({path:f.path,role:f.role,state:f.role==='evidence'?'retained':'normalized',description:f.description??null})),controlPoints:controls},frames:[manifest.frame],objects:[...objects.values()],geometries,relations,sources,sourceRecords,identifierAssertions:identifiers,observations:[],lineage:[],batches:[],issues:[],rights,sceneDecoration:manifest.sceneDecoration};
 return {scene,normalizedText:JSON.stringify(scene),sourceManifest:manifest,diagnostics,originals};
}

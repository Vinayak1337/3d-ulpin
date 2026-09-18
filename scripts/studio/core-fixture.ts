import {buildCoreSnapshot,measureCoreCatalog} from '../../packages/contracts/src/spatial/core';
import {district,allFindings,STUDIO_DATA_VERSION} from '../../apps/web/features/studio/data/district';
import {getFloorLayout} from '../../apps/web/features/studio/data/floorLayout';
import type {Rect} from '../../apps/web/features/studio/types';
import type {PreparedDocument} from '../../apps/web/features/studio/data/source-types';
const ref=(namespace:string,id:string)=>({namespace,id});
const ver=(namespace:string,id:string)=>({ref:ref(namespace,id),revision:1});
const namespace='studio-reference-v2';
const ring=(r:Rect)=>[[r.x-r.width/2,r.z-r.depth/2],[r.x+r.width/2,r.z-r.depth/2],[r.x+r.width/2,r.z+r.depth/2],[r.x-r.width/2,r.z+r.depth/2],[r.x-r.width/2,r.z-r.depth/2]];
export function studioRawData(){
 const records:{id:string;kind:string;label:string;identifier:string;block:string;role:string;geometry:unknown;parent?:string;level?:string;netArea?:number}[]=[];
 const layouts:ReturnType<typeof getFloorLayout>[]=[];
 const prism=(r:Rect,lower:number,upper:number)=>({profile:'prism',footprint:{type:'Polygon',coordinates:[ring(r)]},interval:{lowerMetres:lower,upperMetres:upper,reference:ver('benchmark','studio-authored-grade')}});
 for(const b of district.buildings){
  records.push({id:b.parcelId,kind:'parcel',label:`Parcel for ${b.name}`,identifier:b.parcelId,block:b.blockId,role:'recorded_parcel',geometry:{profile:'planar',geometry:{type:'Polygon',coordinates:[ring(b.parcel)]}}});
  records.push({id:b.id,kind:'building',label:b.name,identifier:b.ulpin,block:b.blockId,role:'exterior',geometry:prism(b,0,b.height),parent:b.parcelId});
  for(let f=0;f<b.floors;f++){
   const id=`${b.id}/F${f}`,layout=getFloorLayout(b,f);layouts.push(layout);
   records.push({id,kind:'level',label:`${b.name} · ${f===0?'Ground floor':`Floor ${f}`}`,identifier:id,block:b.blockId,role:'floor_boundary',geometry:prism(b,f*b.floorHeight,(f+1)*b.floorHeight),parent:b.id});
   for(const u of layout.units){records.push({id:u.unit.id,kind:'space',label:`${b.name} · Unit ${u.unit.number}`,identifier:u.unit.id,block:b.blockId,role:'unit_boundary',geometry:prism({...u.boundary,x:b.x+u.boundary.x,z:b.z+u.boundary.z},f*b.floorHeight,(f+1)*b.floorHeight),parent:b.id,level:id,netArea:u.unit.area});}
  }
 }
 for(const r of district.roads)records.push({id:r.id,kind:'road',label:r.name,identifier:r.id,block:'shared-roads',role:'road_surface',geometry:{profile:'planar',geometry:{type:'Polygon',coordinates:[ring(r)]}}});
 for(const p of district.parks)records.push({id:p.id,kind:'public_land',label:p.name,identifier:p.id,block:'public-space',role:'public_land',geometry:{profile:'planar',geometry:{type:'Polygon',coordinates:[ring(p)]}}});
 for(const u of district.utilities)records.push({id:u.id,kind:'utility',label:`${u.kind} · ${u.id}`,identifier:u.id,block:'shared-utilities',role:'alignment',geometry:{profile:'planar',geometry:{type:'LineString',coordinates:u.points.map(([x,,z])=>[x,z])}}});
 return {schemaVersion:'studio-authored-source/2',datasetVersion:STUDIO_DATA_VERSION,synthetic:true,notice:'All properties, people, rights examples and documents are fictional. This is not a government register or a survey.',district,records,layouts,findings:allFindings};
}
export async function normalizeStudioFixture(raw:ReturnType<typeof studioRawData>,receipt:{sha256:string;bytes:number},documents:PreparedDocument[]){
 const world=ver('world','studio-reference-v2'),frame=ver('frame','studio-local-metres');
 const entities=raw.records.map(r=>({ref:ref(namespace,r.id),revision:1,kind:r.kind,label:r.label,identifiers:[{scheme:'prototype',issuer:'3D ULPIN synthetic Studio fixture',value:r.identifier,status:'prototype',historical:false}],memberships:[{collection:ref('authoring_area',r.block),role:'authoring'}],lifecycle:{state:'active'}}));
 const relations:unknown[]=[];
 for(const r of raw.records){if(r.parent)relations.push({id:`parent:${r.id}`,revision:1,kind:r.kind==='building'?'associated_parcel':'part_of',from:ref(namespace,r.id),to:ref(namespace,r.parent),note:'Explicit synthetic source association'});if(r.level)relations.push({id:`level:${r.id}`,revision:1,kind:'occupies_level',from:ref(namespace,r.id),to:ref(namespace,r.level),note:'Authored unit floor, not inferred'});}
 const source=(id:string,label:string,profile:string,assetId:string)=>({ref:ref('source_revision',id),revision:1,family:ref('source_family',id),familyOrdinal:1,label,profile,method:'synthetic',dataset:ver('dataset','studio-reference-v2'),assets:[ver('asset',assetId)],workflows:[],access:'public'});
 const asset=(id:string,sha256:string,bytes:number,mediaType:string)=>({ref:ref('asset',id),revision:1,kind:'original',mediaType,sha256,bytes,storage:{state:'registered',blobRef:ref('source_blob',id)},integrity:'metadata_only',access:'public',retention:{policy:'preserve_original',legalHold:null},parentAssets:[]});
 const parts:unknown[]=raw.records.map((r,i)=>({ref:ref('source_part',r.id),revision:1,source:ver('source_revision','studio-authored-records'),asset:ver('asset','studio-authored-records'),locators:[{kind:'json_pointer',pointer:`/records/${i}`}],access:'public'}));
 const sourceAssets=[asset('studio-authored-records',receipt.sha256,receipt.bytes,'application/json'),...documents.map(d=>asset(d.id,d.sha256,d.bytes,'application/pdf'))];
 const sources=[source('studio-authored-records','Prepared neighbourhood records and floor layouts','studio-authored/2','studio-authored-records'),...documents.map(d=>source(d.id,d.filename,'studio-pdf/1',d.id))];
 const links:unknown[]=[];
 for(const d of documents){parts.push({ref:ref('source_part','document:'+d.id),revision:1,source:ver('source_revision',d.id),asset:ver('asset',d.id),locators:[{kind:'whole_asset'}],access:'public'});links.push({ref:ref('evidence_link',d.id),revision:1,target:ref(namespace,d.kind==='lease'?d.unitId!:d.kind==='plan'?`${d.buildingId}/F${d.floor}`:d.buildingId),part:ver('source_part','document:'+d.id),purpose:'record',state:'active',inheritance:{kind:'direct'}});}
 const representations=raw.records.map(r=>({ref:ref('representation',r.id),revision:1,entity:ref(namespace,r.id),frame,role:r.role,geometry:r.geometry,sourceParts:[ver('source_part',r.id)]}));
 const reportedQuantities=raw.records.filter(r=>r.netArea!==undefined).map(r=>({ref:ref('reported_quantity','net:'+r.id),revision:1,entity:ref(namespace,r.id),definition:'net_floor_area',unit:'m2',amount:{state:'known',value:r.netArea},sourcePart:ver('source_part',r.id)}));
 const observations=raw.records.map(r=>({ref:ref('observation',r.id),revision:1,entity:ref(namespace,r.id),world,role:r.role,method:'synthetic',access:'public',sourceParts:[ver('source_part',r.id)],validity:{fromMs:null,toMs:null},payload:{kind:'geometry',representation:ver('representation',r.id)}}));
 const resolutions=raw.records.map(r=>({ref:ref('resolution',r.id),revision:1,entity:ref(namespace,r.id),world,role:r.role,candidates:[ver('observation',r.id)],selected:ver('observation',r.id),reason:'Explicitly selected authored fixture geometry'}));
 const compositions=raw.records.map(r=>({ref:ref('composition',r.id),revision:1,entity:ref(namespace,r.id),world,kind:'passthrough',geometry:ver('resolution',r.id)}));
 const input={schemaVersion:'ulpin-spatial/2',context:{world,asOfMs:null,scope:{id:'public-synthetic-studio',revision:1,ceiling:'public'}},worlds:[{...world,label:district.name,state:'synthetic'}],identity:{entities,relations},sources:{datasets:[{ref:ref('dataset','studio-reference-v2'),revision:1,label:district.name,classification:'synthetic',attribution:'Authored demonstration data',license:null,access:'public'}],assets:sourceAssets,sources,parts,links},frames:{frames:[{...frame,label:'Authored east/south planar metres',sourceCrs:null,kind:'engineering',horizontalUnit:'m',axes:['east','south'],verticalUnit:'m',verticalDirection:'up',vertical:{kind:'benchmark',reference:ver('benchmark','studio-authored-grade'),label:'Synthetic local grade, not surveyed terrain'}}],operations:[]},geometry:{representations,reportedQuantities},observations,resolutions,compositions};
 const snapshot=await buildCoreSnapshot(input);
 const quantities=measureCoreCatalog(snapshot.geometry,input.identity,input.sources,input.frames);
 return {input,snapshot,quantities};
}

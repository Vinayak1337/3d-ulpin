import {coreRefKey,enuToEcef,geometryPoints,measureCoreCatalog,metricTopologyIssue,SPATIAL_SCHEMA,validateSpatialSnapshot,type CoreRef,type SpatialEntity,type SpatialRepresentation,type SpatialGeometry,type SpatialSnapshot,type XY} from "@ulpin/contracts";
import type {normalizeLegacySpatialSlice} from "./core-legacy-adapter";

export type NormalizedNeighbourhood=Awaited<ReturnType<typeof normalizeLegacySpatialSlice>>;
export interface NeighbourhoodItem {
  id:string;canonicalRef:CoreRef;revision:number;label:string;kind:string;identifier:string;
  sourceRepresentationId:string;analyticalRepresentationId:string|null;
  height:number|null;heightState:string;horizontalArea:number|null;prismVolume:number|null;quantityReason:string|null;
  sourceCount:number;recordId:string|null;hasPlacedInteriors:boolean;renderStatus:"massing"|"footprint"|"alignment"|"surface";
}
export interface NeighbourhoodView {
  schemaVersion:"ulpin-neighbourhood-view/1";areaId:string;name:string;world:SpatialSnapshot["worldState"];readDigest:string;
  snapshot:SpatialSnapshot;items:NeighbourhoodItem[];sourceCount:number;documentCount:number;
  notices:string[];attributions:('google'|'osm')[];
}
export const DISPLAY_REFERENCE="relative-display-plane-not-surveyed-ground";
/** Ellipsoid surface -> the declared local display plane. Analytical records are untouched. */
export function displayProjector(longitude:number,latitude:number) {
  const frame={id:"display",kind:"engineering" as const,horizontalUnit:"m" as const,verticalUnit:"m" as const,axes:"east-north-up" as const,verticalReference:DISPLAY_REFERENCE,
    anchor:{longitude,latitude,ellipsoidHeight:0,provenance:"Relative neighbourhood display only; not a surveyed ground elevation"}};
  const m=enuToEcef(frame);
  return (point:XY):XY=>{
    if(point.length!==2||!point.every(Number.isFinite)||Math.abs(point[0])>180||Math.abs(point[1])>90)throw new Error("Invalid geographic display position");
    const l=point[0]*Math.PI/180,p=point[1]*Math.PI/180,n=6378137/Math.sqrt(1-0.0066943799901413165*Math.sin(p)**2);
    const v=[n*Math.cos(p)*Math.cos(l)-m[12],n*Math.cos(p)*Math.sin(l)-m[13],n*(1-0.0066943799901413165)*Math.sin(p)-m[14]];
    const local:XY=[v[0]*m[0]+v[1]*m[1]+v[2]*m[2],v[0]*m[4]+v[1]*m[5]+v[2]*m[6]];
    if(local.some(x=>!Number.isFinite(x)||Math.abs(x)>4500))throw new Error("Neighbourhood display exceeds its 4.5 km local profile");
    return local;
  };
}
function mapGeometry(g:SpatialGeometry,point:(p:XY)=>XY):SpatialGeometry {
  if(g.type==="Point")return {type:g.type,coordinates:point(g.coordinates)};
  if(g.type==="LineString")return {type:g.type,coordinates:g.coordinates.map(point)};
  if(g.type==="Polygon")return {type:g.type,coordinates:g.coordinates.map(r=>r.map(point))};
  return {type:g.type,coordinates:g.coordinates.map(p=>p.map(r=>r.map(point)))};
}

/** A renderer-only projection of a validated T009 read, not another canonical model. */
export function projectCoreNeighbourhood(data:NormalizedNeighbourhood):NeighbourhoodView {
  const core=data.input,world=core.worlds.find(w=>w.ref.id===core.context.world.ref.id)!.state;
  const physical=core.identity.entities.filter(e=>e.ref.namespace==="physical");
  const geographic=data.snapshot.geometry.representations.filter(r=>r.entity.namespace==="physical"&&r.frame?.ref.id==="legacy:CRS84"&&r.geometry.profile==="planar");
  const points=geographic.flatMap(r=>r.geometry.profile==="planar"?geometryPoints(r.geometry.geometry):[]);
  if(!points.length)throw new Error("No qualified geographic footprint is available for this neighbourhood");
  const extent=points.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
  if(extent[2]-extent[0]>0.1||extent[3]-extent[1]>0.1)throw new Error("Choose a bounded neighbourhood, not a district-wide render request");
  const longitude=(extent[0]+extent[2])/2,latitude=(extent[1]+extent[3])/2,project=displayProjector(longitude,latitude);
  const frameId=`display:${data.legacy.area.id}`,sourceId=`core-read:${data.readDigest}`,worldId=`core-view:${data.legacy.area.id}:${world}`;
  const entities:SpatialEntity[]=[],representations:SpatialRepresentation[]=[];
  const snapshot:SpatialSnapshot={schemaVersion:SPATIAL_SCHEMA,id:worldId,revision:data.legacy.area.revision,worldId,worldState:world,
    frames:[{id:frameId,kind:"engineering",horizontalUnit:"m",verticalUnit:"m",axes:"east-north-up",verticalReference:DISPLAY_REFERENCE,anchor:{longitude,latitude,ellipsoidHeight:0,provenance:"Relative display placement derived from supplied geographic geometry; no surveyed vertical datum claimed"}}],
    sources:[{id:sourceId,revision:1,label:"Version-pinned normalized property records",method:"derived"}],entities,representations,relations:[],attachments:[]};
  const measures=measureCoreCatalog(data.snapshot.geometry,core.identity,core.sources,core.frames);
  const items:NeighbourhoodItem[]=[],notices=new Set<string>(["Relative heights only · no surveyed terrain","Canonical measurements are independent of display meshes"]);
  for(const rep of geographic){
    const entity=physical.find(e=>coreRefKey(e.ref)===coreRefKey(rep.entity))!,saved=data.legacy.features.find(f=>f.ref.id===entity.ref.id)!;
    if(!["building","building_part","parcel","road","rail","utility","public_land","terrain","vegetation"].includes(entity.kind))continue;
    if(rep.geometry.profile!=="planar")continue;
    const geometry=mapGeometry(rep.geometry.geometry,project),id=coreRefKey(entity.ref);
    if(geometry.type==="Point"&&entity.kind!=="vegetation"){notices.add("Unqualified point assets remain in the original register");continue;}
    if(geometry.type==="LineString"&&!["road","rail","utility"].includes(entity.kind)){notices.add("Unsupported alignment type retained in the original record");continue;}
    const topology=metricTopologyIssue(geometry);if(topology){notices.add("Some source geometry needs review; its records were retained");continue;}
    const height=saved.height?.value,validHeight=typeof height==="number"&&Number.isFinite(height)&&height>=0&&height<=2000&&saved.height?.state!=="unknown"&&saved.height?.state!=="unresolved";
    const building=entity.kind==="building"||entity.kind==="building_part",line=geometry.type==="LineString";
    const lower=building?0.08:entity.kind==="parcel"?0.025:entity.kind==="public_land"?0.012:line?0.16:0.055;
    const upper=building&&validHeight?lower+height:lower;
    const rid=`display:${rep.ref.id}`,renderEntity:SpatialEntity={id,revision:entity.revision,worldId,kind:entity.kind as SpatialEntity['kind'],label:entity.label,identifiers:entity.identifiers.map(i=>({scheme:i.scheme,issuer:i.issuer,value:i.value,status:i.status==="prototype"?"prototype":"supplied"})),areaIds:[...new Set(entity.memberships.map(m=>coreRefKey(m.collection)))],representationIds:[rid]};
    entities.push(renderEntity);
    const floors=saved.floorCount,appearance=world==="synthetic"&&building&&validHeight&&floors&&floors<=100&&height/floors>=1?{facade:"schematic" as const,storeys:floors,roof:"flat" as const,envelopeOnly:true}:undefined;
    representations.push({id:rid,revision:rep.revision,entityId:id,frameId,role:"display_only",geometry,vertical:{lower,upper,reference:DISPLAY_REFERENCE},evidence:[{sourceId,sourceRevision:1,locator:{kind:"feature",value:rep.ref.id}}],...(appearance?{appearance}:{})});
    const analytical=data.snapshot.geometry.representations.find(r=>coreRefKey(r.entity)===id&&r.ref.id.includes(":local:")),q=analytical?measures.find(m=>m.representation.ref.id===analytical.ref.id):null;
    if(building&&!validHeight)notices.add("Unknown-height buildings are shown as footprints, not invented storeys");
    if(line)notices.add("Linework uses a diagram-width stroke; it does not establish physical width or burial depth");
    items.push({id,canonicalRef:entity.ref,revision:entity.revision,label:entity.label,kind:entity.kind,identifier:entity.identifiers[0]?.value??entity.ref.id,sourceRepresentationId:rep.ref.id,analyticalRepresentationId:analytical?.ref.id??null,height:validHeight?height:null,heightState:saved.height?.state??"unknown",horizontalArea:q?.horizontalArea.value??null,prismVolume:q?.prismVolume.value??null,quantityReason:q?.prismVolume.reasonCode??"NO_QUALIFIED_ANALYTICAL_REPRESENTATION",sourceCount:new Set(rep.sourceParts.map(p=>p.ref.id)).size,recordId:saved.recordId,hasPlacedInteriors:false,renderStatus:line?"alignment":building?validHeight&&height>0?"massing":"footprint":"surface"});
  }
  if(!items.length)throw new Error("This selection has no supported displayable geometry");
  const all=snapshot.representations.flatMap(r=>geometryPoints(r.geometry));
  const b=all.reduce((a,p)=>[Math.min(a[0],p[0]),Math.min(a[1],p[1]),Math.max(a[2],p[0]),Math.max(a[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
  const margin=Math.max(8,Math.min(40,Math.max(b[2]-b[0],b[3]-b[1])*.04)),groundId=`display-context:${data.legacy.area.id}`;
  const ring:XY[]=[[b[0]-margin,b[1]-margin],[b[2]+margin,b[1]-margin],[b[2]+margin,b[3]+margin],[b[0]-margin,b[3]+margin],[b[0]-margin,b[1]-margin]];
  entities.push({id:groundId,revision:1,worldId,kind:"terrain",label:"Display ground plane (not survey terrain)",identifiers:[],areaIds:[],representationIds:[groundId]});
  representations.push({id:groundId,revision:1,entityId:groundId,frameId,role:"display_only",geometry:{type:"Polygon",coordinates:[ring]},vertical:{lower:-.5,upper:-.02,reference:DISPLAY_REFERENCE},evidence:[]});
  validateSpatialSnapshot(snapshot);
  const namespaces=[...data.legacy.features.flatMap(f=>[f.datasetNamespace,f.attribution]),...core.sources.sources.map(s=>s.label)].join(" ").toLowerCase(),title=data.legacy.area.name.toLowerCase();
  const attributions:NeighbourhoodView['attributions']=[];if(namespaces.includes("google")||title.includes("google"))attributions.push("google");if(namespaces.includes("osm")||title.includes("osm")||namespaces.includes("openstreetmap"))attributions.push("osm");
  return {schemaVersion:"ulpin-neighbourhood-view/1",areaId:data.legacy.area.id,name:data.legacy.area.name,world,readDigest:data.readDigest,snapshot,items,sourceCount:data.legacy.sources.length,documentCount:core.sources.assets.filter(a=>a.mediaType==="application/pdf").length,notices:[...notices],attributions};
}

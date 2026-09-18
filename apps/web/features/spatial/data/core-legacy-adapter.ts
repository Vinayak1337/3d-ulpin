import {
  CORE_RELATION_POLICY,CoreEntitySchema,CorePlanarGeometrySchema,CoreRelationSchema,
  CoreRepresentationSchema,CoreGeometryProfileSchema,CoreSnapshotInputSchema,CoreContractError,
  buildCoreSnapshot,canonicalCoreText,coreFail,coreInputDigest,coreRefKey,isPreciseCoreLocator,
  parseCore,validateCoreGeometryCatalog,validateCoreIdentityGraph,
  type CoreEntity,type CoreFrame,type CoreGeometryCatalog,type CoreGeometryRoleSchema,
  type CoreIdentityGraph,type CoreObservation,type CoreRepresentation,type CoreResolution,type CoreComposition,
  type CoreRef,type CoreRevisionRef,type CoreRelation,type CoreSourcePart,
  type PhysicalFeature,type WorldState,type GeometryRole,
} from "@ulpin/contracts";
import type {z} from "zod";
import {LegacyCoreSources} from "./core-legacy-sources";
import {CORE_LEGACY_LIMITS,type CoreLegacyDiagnostic,type LegacyReadFeature,type LegacyRegistryRecord,type LegacySpatialReadSlice} from "./core-legacy-types";

type Role=z.infer<typeof CoreGeometryRoleSchema>;
const ref=<N extends string>(namespace:N,id:string)=>({namespace,id});
const version=<N extends string>(namespace:N,id:string,revision=1)=>({ref:ref(namespace,id),revision});
const roles:Record<GeometryRole,Role>={unknown:"unspecified",observed_ground_occupation:"ground_footprint",observed_roof_projection:"roof_projection",approved_building_outline:"design_outline",recorded_parcel:"recorded_parcel",public_road_land:"recorded_road_land",road_surface:"road_surface",public_land:"public_land",physical_utility:"alignment",documented_restriction:"restriction"};
const ordered=<T extends {ref:CoreRef}>(items:Iterable<T>):T[]=>[...items].sort((a,b)=>coreRefKey(a.ref)<coreRefKey(b.ref)?-1:1);
const byId=<T extends {id:string}>(items:readonly T[]):T[]=>[...items].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
const sourcePartVersion=(p:CoreSourcePart)=>version("source_part",p.ref.id,p.revision);
const unknownVertical=()=>({kind:"unknown" as const,reason:"No qualified named vertical reference is present in this legacy record"});
const namedVertical=(id:string,label:string)=>({kind:"benchmark" as const,reference:version("legacy_frame_benchmark",id),label});
const knownLabel=(value:string|null|undefined)=>!!value&&!/unknown|unresolved|not aligned|unverified/i.test(value);
const coordinateFrame=(id:string,label:string,sourceCrs:string|null,verticalLabel:string|null):CoreFrame=>({
  ref:ref("frame",id),revision:1,label,sourceCrs,kind:"engineering",horizontalUnit:"m",axes:["east","north"],verticalUnit:"m",verticalDirection:"up",
  vertical:knownLabel(verticalLabel)?namedVertical(id,verticalLabel!):unknownVertical(),
});

/**
 * Read-only legacy projection. Namespace/ID and authoritative revision are retained.
 * Original DB bodies and original bytes remain the authority for unmapped fields.
 */
export async function normalizeLegacySpatialSlice(slice:LegacySpatialReadSlice,world:WorldState) {
  if(slice.schemaVersion!=="ulpin-legacy-read/1")coreFail("LEGACY_PROFILE","Unsupported legacy read profile");
  if(!["observed","planned","hypothetical","synthetic"].includes(world))coreFail("LEGACY_WORLD","Explicit world required");
  if(slice.features.length>CORE_LEGACY_LIMITS.features||slice.records.length>CORE_LEGACY_LIMITS.records||slice.sources.length>CORE_LEGACY_LIMITS.sources||slice.sites.length>CORE_LEGACY_LIMITS.sites)coreFail("LEGACY_READ_LIMIT","Legacy area exceeds the qualified read profile; nothing was truncated");
  canonicalCoreText(slice);
  if(new TextEncoder().encode(JSON.stringify(slice)).length>CORE_LEGACY_LIMITS.inputBytes)coreFail("LEGACY_READ_BYTES","Input exceeds the bounded read profile");
  const diagnostics:CoreLegacyDiagnostic[]=[];
  const diagnose=(code:string,target:CoreRef,message:string)=>diagnostics.push({code,target,message});
  const entities=new Map<string,CoreEntity>(),frames=new Map<string,CoreFrame>();
  const geometry:CoreRepresentation[]=[],reportedQuantities:CoreGeometryCatalog["reportedQuantities"][number][]=[],relations:CoreRelation[]=[],observations:CoreObservation[]=[],resolutions:CoreResolution[]=[],compositions:CoreComposition[]=[];
  const worldRef=version("world",`legacy-world:${world}`),sources=new LegacyCoreSources(slice.sources,diagnostics);
  const sites=new Map(slice.sites.map(site=>[site.id,site]));
  const features=byId(slice.features.filter(feature=>feature.body.worldStatus===world)),records=byId(slice.records);
  const addEntity=(input:unknown)=>{
    const entity=parseCore(CoreEntitySchema,input),key=coreRefKey(entity.ref);
    if(entities.has(key))coreFail("LEGACY_DUPLICATE","Legacy source returned duplicate canonical entities");
    entities.set(key,entity);return entity;
  };
  const makeEntity=(target:CoreRef,revision:number,kind:CoreEntity["kind"],label:string,identifier:string,memberships:string[])=>addEntity({
    ref:target,revision,kind,label,identifiers:[{scheme:"legacy-prototype",issuer:"3d-ulpin",value:identifier,status:"prototype",historical:false}],
    memberships:[...new Set(memberships)].sort().map(id=>({collection:ref("authoring_area",id),role:"authoring"})),lifecycle:{state:"active"},
  });
  for(const entry of features){
    const f=entry.body;
    if(f.id!==entry.id||f.revision!==entry.revision||f.areaId!==entry.ownerAreaId)coreFail("LEGACY_RECORD_CONFLICT","Feature body and authoritative row identity/revision disagree");
    makeEntity(ref("physical",f.id),f.revision,f.kind,f.name,f.identifier,[entry.ownerAreaId,...entry.memberAreaIds]);
  }
  for(const record of records){
    if(!sites.has(record.siteId))coreFail("LEGACY_SITE_MISSING","Registry record has no exact site frame");
    const kind=record.kind==="floor"?"level":record.kind;
    const entity=makeEntity(ref("registry",record.id),record.revision,kind,record.name,record.identifier,
      record.siteId===slice.area.siteId?[slice.area.id]:[]);
    const identifiers=[...entity.identifiers];
    if(record.officialUlpin)identifiers.push({scheme:"ulpin-reference",issuer:"legacy-record-assertion",value:record.officialUlpin,status:"reported",historical:false});
    if(record.alias&&record.alias!==record.identifier)identifiers.push({scheme:"legacy-alias",issuer:"3d-ulpin",value:record.alias,status:"prototype",historical:false});
    entities.set(coreRefKey(entity.ref),parseCore(CoreEntitySchema,{...entity,identifiers}));
  }

  function addRelation(from:CoreRef,to:CoreRef,kind:CoreRelation["kind"],id:string,note:string,revision:number) {
    const a=entities.get(coreRefKey(from)),b=entities.get(coreRefKey(to));
    if(!a||!b){diagnose("LEGACY_LINK_OUTSIDE_SLICE",from,"A linked record is outside this bounded area slice; no target was invented.");return;}
    const policy=CORE_RELATION_POLICY[kind];
    if(!policy.pairs.some(pair=>pair[0]===a.kind&&pair[1]===b.kind)){diagnose("LEGACY_LINK_UNQUALIFIED",from,`The recorded ${kind} association has unsupported endpoint kinds and was not reinterpreted.`);return;}
    relations.push(parseCore(CoreRelationSchema,{id,revision,kind,from,to,note}));
  }
  for(const entry of features)if(entry.recordId)addRelation(ref("physical",entry.id),ref("registry",entry.recordId),"recorded_by",`physical-record:${entry.id}`,"Explicit stored physical_features.record_id association",entry.revision);
  for(const record of records)for(const link of [...record.links].sort((a,b)=>canonicalCoreText(a)<canonicalCoreText(b)?-1:1)){
    const from=ref("registry",record.id),to=ref("registry",link.targetId),target=entities.get(coreRefKey(to));
    const kind:CoreRelation["kind"]=link.type==="within"?(target?.kind==="parcel"?"associated_parcel":"part_of"):link.type==="floor"?"occupies_level":link.type;
    addRelation(from,to,kind,`registry-link:${record.id}:${link.type}:${link.targetId}`,`Original registry association: ${link.type}`,record.revision);
  }
  const identity:CoreIdentityGraph=validateCoreIdentityGraph({entities:ordered(entities.values()),relations});

  async function keepRepresentation(candidate:Record<string,unknown>,purpose:"analysis"|"display",entityWorld:WorldState|null,parts:readonly CoreSourcePart[]) {
    const profile=CoreGeometryProfileSchema.safeParse(candidate.geometry);
    if(!profile.success)diagnose("GEOMETRY_PROFILE_UNSUPPORTED",candidate.entity as CoreRef,"Legacy geometry is retained but exceeds this declared profile; no coordinates were dropped.");
    let rep=parseCore(CoreRepresentationSchema,{...candidate,geometry:profile.success?profile.data:{profile:"unavailable",reason:"Legacy geometry is outside the qualified input profile"}});
    try {
      validateCoreGeometryCatalog({representations:[rep],reportedQuantities:[]},identity,sources.catalog(),{frames:ordered(frames.values()),operations:[]});
    }catch(error){
      if(!(error instanceof CoreContractError)||!["INVALID_CONTRACT","GEOMETRY_RING","GEOMETRY_TOPOLOGY","GEOMETRY_DEGENERATE","GEOMETRY_BUDGET","GEOMETRY_NUMERIC","GEOMETRY_INTERVAL","VERTICAL_UNRESOLVED","VERTICAL_MISMATCH"].includes(error.code))throw error;
      diagnose(error.code,rep.entity,"The original geometry is retained in the legacy record but is unavailable in this qualified profile.");
      rep=parseCore(CoreRepresentationSchema,{...rep,geometry:{profile:"unavailable",reason:`Legacy geometry requires separate qualification: ${error.code}`}});
    }
    geometry.push(rep);
    for(const part of parts)await sources.link(rep.entity,part,part.locators.some(isPreciseCoreLocator)?"geometry":"record");
    if(entityWorld===null){diagnose("REGISTRY_WORLD_UNRESOLVED",rep.entity,"This non-synthetic registry geometry has no explicit observed/planned world assertion; it remains recorded evidence, not selected physical truth.");return;}
    if(entityWorld!==world)return;
    const id=rep.ref.id;
    observations.push({ref:ref("observation",id),revision:1,entity:rep.entity,world:worldRef,role:rep.role,method:entityWorld==="synthetic"?"synthetic":"source",access:"operator",sourceParts:rep.sourceParts,
      validity:{fromMs:null,toMs:null},payload:{kind:"geometry",representation:version("representation",id,rep.revision)}});
    resolutions.push({ref:ref("resolution",id),revision:1,entity:rep.entity,world:worldRef,role:rep.role,purpose,candidates:[version("observation",id)],selected:version("observation",id),reason:"Preserved existing record representation; no competing source was silently preferred"});
    compositions.push({ref:ref("composition",id),revision:1,entity:rep.entity,world:worldRef,kind:"passthrough",geometry:version("resolution",id)});
  }

  function keepReported(id:string,entity:CoreRef,amount:number|undefined|null,definition:"horizontal_area"|"prism_volume",part:CoreSourcePart,selectedWorld:WorldState|null){
    if(amount===null||amount===undefined)return;
    const q:CoreGeometryCatalog["reportedQuantities"][number]={ref:ref("reported_quantity",id),revision:1,entity,definition,unit:definition==="horizontal_area"?"m2":"m3",amount:{state:"known",value:amount},sourcePart:sourcePartVersion(part)};
    reportedQuantities.push(q);
    if(selectedWorld!==world)return;
    observations.push({ref:ref("observation",id),revision:1,entity,world:worldRef,role:definition,method:world==="synthetic"?"synthetic":"derived",access:"operator",sourceParts:[q.sourcePart],validity:{fromMs:null,toMs:null},payload:{kind:"reported_quantity",quantity:version("reported_quantity",id)}});
    resolutions.push({ref:ref("resolution",id),revision:1,entity,world:worldRef,role:definition,purpose:"record",candidates:[version("observation",id)],selected:version("observation",id),reason:"Stored legacy quantity retained separately; not substituted for new analytical calculation"});
  }

  for(const entry of features){
    const f=entry.body,target=ref("physical",f.id),sourceParts=new Map<string,CoreSourcePart>();
    const legacyLocators=[...(f.sourceKey?[{sourceRevisionId:f.sourceRevisionId,featureId:f.sourceKey}]:[]),...(f.evidence??[]),...(f.verticalExtent?.evidence??[]),...(f.height?.evidence??[])];
    for(const locator of legacyLocators){const part=await sources.locator(locator);sourceParts.set(part.ref.id,part);}
    const allParts=ordered(sourceParts.values()),precise=allParts.filter(p=>p.locators.some(isPreciseCoreLocator));
    if(!precise.length)diagnose("GEOMETRY_EVIDENCE_UNQUALIFIED",target,"No exact original source part is available; the geometry remains a legacy-record interpretation.");
    const fallback=precise.length?[]:[await sources.recordElement({id:f.id,revision:f.revision,siteId:slice.area.siteId,synthetic:world==="synthetic"},"physical_feature")];
    const geometryParts=precise.length?precise:fallback;
    if(f.areaM2!==null&&f.areaM2!==undefined){
      const recordPart=fallback[0]??await sources.recordElement({id:f.id,revision:f.revision,siteId:entry.ownerAreaId,synthetic:world==="synthetic"},"physical_feature");
      keepReported(`legacy-area:${f.id}`,target,f.areaM2,"horizontal_area",recordPart,world);
    }
    for(const part of allParts.filter(p=>!precise.includes(p)))await sources.link(target,part,"record");
    const role=roles[f.geometryRole??f.semantics?.geometryRole??"unknown"];
    if(role==="unspecified")diagnose("GEOMETRY_ROLE_UNRESOLVED",target,"Geometry role remains unknown; measurements are not implied by a displayable outline.");
    const id=`legacy:${entry.ownerAreaId}:${f.id}:metric`;
    const verticalLabel=f.verticalExtent?.reference??null;
    const frame=coordinateFrame(id,`Legacy local frame ${f.id}`,entry.ownerReference?.analysisCrs??null,verticalLabel);
    if(entry.ownerReference)frames.set(id,frame);
    const geographicId="legacy:CRS84";
    frames.set(geographicId,{ref:ref("frame",geographicId),revision:1,label:"Longitude/latitude legacy representation",sourceCrs:"OGC:CRS84",kind:"geographic",angularUnit:"degree",axes:"longitude-latitude",verticalUnit:"m",verticalDirection:"up",vertical:unknownVertical()});
    for(const [purpose,raw,frameId] of [["analysis",f.geometry,entry.ownerReference?id:null],["display",f.geographicGeometry,geographicId]] as const){
      const parsed=CorePlanarGeometrySchema.safeParse(raw);
      const interval=f.verticalExtent,vertical=frame.kind!=="geocentric"?frame.vertical:unknownVertical();
      const profile=parsed.success&&purpose==="analysis"&&interval&&vertical.kind==="benchmark"&&(parsed.data.type==="Polygon"||parsed.data.type==="MultiPolygon")?
        {profile:"prism",footprint:parsed.data,interval:{lowerMetres:interval.lower,upperMetres:interval.upper,reference:vertical.reference}}:
        parsed.success?{profile:"planar",geometry:parsed.data}:{profile:"unavailable",reason:"Legacy geometry is outside the qualified planar profile; original is retained"};
      if(!parsed.success)diagnose("GEOMETRY_PROFILE_UNSUPPORTED",target,`The ${purpose} geometry was not flattened or repaired.`);
      await keepRepresentation({ref:ref("representation",`${f.id}:${purpose==="analysis"?"local":"geographic"}:${role}`),revision:f.revision,entity:target,
        frame:frameId?version("frame",frameId):null,role,geometry:profile,sourceParts:geometryParts.map(sourcePartVersion)},purpose,world,geometryParts);
    }
    if(!f.verticalExtent&&f.height?.value!==null)diagnose("HEIGHT_NOT_VERTICAL_PLACEMENT",target,"Stored height metadata is preserved, but height alone does not establish an analytical lower elevation.");
  }

  for(const record of records){
    const target=ref("registry",record.id),site=sites.get(record.siteId)!,frameId=`legacy-registry:${site.id}:frame`;
    if(site.frame.horizontalUnit!=="m"||site.frame.verticalUnit!=="m")coreFail("LEGACY_FRAME_UNIT","The stored registry frame is outside the metre-frame contract");
    const frame=coordinateFrame(frameId,`Recorded site frame ${site.frame.id}`,null,site.frame.benchmark);
    frames.set(frameId,frame);
    const model=await sources.recordElement(record,"registry_record"),evidence=[...(record.evidence??[]),...Object.values(record.geometry?.bindings??{}).filter(binding=>binding!==undefined)];
    keepReported(`legacy-volume:${record.id}`,target,record.geometry?.volume,"prism_volume",model,record.synthetic?"synthetic":null);
    for(const binding of evidence)await sources.link(target,await sources.binding(binding),"record");
    const role:Role=record.kind==="parcel"?"recorded_parcel":record.kind==="floor"?"floor_boundary":record.kind==="space"?"unit_boundary":"exterior";
    // The legacy profile permits an open ring, not silently discarded dimensions.
    const points=record.footprint.map(p=>[...p]);
    if(points.length&&canonicalCoreText(points[0])!==canonicalCoreText(points[points.length-1]))points.push([...points[0]]);
    let candidate:unknown={profile:"planar",geometry:{type:"Polygon",coordinates:[points]}};
    const modelGeometry=record.geometry;
    if(modelGeometry&&frame.kind==="engineering"&&frame.vertical.kind==="benchmark"){
      const ring=modelGeometry.footprint.map(p=>[...p]);
      if(ring.length&&canonicalCoreText(ring[0])!==canonicalCoreText(ring[ring.length-1]))ring.push([...ring[0]]);
      candidate={profile:"prism",footprint:{type:"Polygon",coordinates:[ring]},interval:{lowerMetres:modelGeometry.lower,upperMetres:modelGeometry.upper,reference:frame.vertical.reference}};
    }else if(modelGeometry)diagnose("REGISTRY_SOLID_PROFILE_UNQUALIFIED",target,"An unresolved datum retains the recorded footprint without inventing vertical placement.");
    if(points.length<4&&!modelGeometry)candidate={profile:"unavailable",reason:"Recorded geometry is absent; registry identity is preserved"};
    await keepRepresentation({ref:ref("representation",`registry:${record.id}:${role}`),revision:record.revision,entity:target,frame:version("frame",frameId),role,geometry:candidate,sourceParts:[sourcePartVersion(model)]},"analysis",record.synthetic?"synthetic":null,[model]);
  }
  const input=parseCore(CoreSnapshotInputSchema,{schemaVersion:"ulpin-spatial/2",context:{world:worldRef,asOfMs:null,scope:{id:`local-operator:area:${slice.area.id}`,revision:1,ceiling:"operator"}},
    worlds:[{...worldRef,label:`Legacy ${world} spatial records`,state:world}],identity,sources:sources.catalog(),frames:{frames:ordered(frames.values()),operations:[]},geometry:{representations:geometry,reportedQuantities},observations,resolutions,compositions});
  const snapshot=await buildCoreSnapshot(input);
  const legacy={area:slice.area,sites:byId(slice.sites).map(s=>({id:s.id,revision:s.revision,frame:{id:s.frame.id,horizontalUnit:s.frame.horizontalUnit,verticalUnit:s.frame.verticalUnit,benchmark:s.frame.benchmark}})),
    features:features.map(f=>({ref:ref("physical",f.id),revision:f.revision,ownerAreaId:f.ownerAreaId,recordId:f.recordId,sourceRevisionId:f.body.sourceRevisionId,sourceKey:f.body.sourceKey,datasetNamespace:f.body.datasetNamespace,
      ownerReference:f.ownerReference?{sourceCrs:f.ownerReference.sourceCrs,analysisCrs:f.ownerReference.analysisCrs,origin:f.ownerReference.origin,anchor:f.ownerReference.anchor,transformVersion:f.ownerReference.transformVersion,verticalReference:f.ownerReference.verticalReference}:null,
      sourceReference:f.body.sourceReference?{sourceCrs:f.body.sourceReference.sourceCrs,analysisCrs:f.body.sourceReference.analysisCrs,origin:f.body.sourceReference.origin,anchor:f.body.sourceReference.anchor,transformVersion:f.body.sourceReference.transformVersion,verticalReference:f.body.sourceReference.verticalReference}:null,
      height:f.body.height?{state:f.body.height.state,value:f.body.height.value,unit:f.body.height.unit,meaning:f.body.height.meaning,reference:f.body.height.reference}:null,storedAreaM2:f.body.areaM2??null})),
    records:records.map(r=>({ref:ref("registry",r.id),revision:r.revision,siteId:r.siteId,kind:r.kind,synthetic:r.synthetic,
      geometryQuality:r.geometry?{id:r.geometry.id,lowerVerified:r.geometry.lowerVerified,upperVerified:r.geometry.upperVerified,storedArea:r.geometry.area??null,storedHeight:r.geometry.height??null,storedVolume:r.geometry.volume??null}:null})),
    sources:byId(slice.sources).map(s=>({id:s.id,revision:s.revision,familyId:s.familyId,sha256:s.sha256,bytes:s.bytes})),locators:sources.originalLocators()};
  const readDigest=await coreInputDigest({snapshot:snapshot.manifest.inputDigest,legacy});
  return {schemaVersion:"ulpin-legacy-normalization/1" as const,readDigest,input,snapshot,legacy,diagnostics:diagnostics.sort((a,b)=>canonicalCoreText(a)<canonicalCoreText(b)?-1:1)};
}

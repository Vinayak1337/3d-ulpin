import {coreFail,coreRefKey,parseCore,type CoreRef,type CoreRevisionRef} from "./scalars";
import {indexCoreRecords,requireCoreRevision,uniqueCoreKeys} from "./references";
import {validateCoreIdentityGraph} from "./identity";
import {isPreciseCoreLocator,validateCoreSourceCatalog} from "./sources";
import {validateCoreFrameCatalog} from "./frames";
import {validateCoreGeometryCatalog} from "./geometry";
import type {CoreRepresentation,CoreGeometryCatalog} from "./geometry-schema";
import {canonicalCoreText,coreInputDigest} from "./signature";
import {CORE_SNAPSHOT_POLICY,CorePublicationCandidateSchema,CoreSnapshotInputSchema,CoreSnapshotManifestSchema,type CoreComposition,type CoreObservation,type CoreResolution,type CoreSnapshotInput} from "./snapshot-schema";

const pin=(value:CoreRevisionRef)=>`${coreRefKey(value.ref)}@${value.revision}`;
const refVersion=(value:{readonly ref:CoreRef;readonly revision:number})=>({ref:value.ref,revision:value.revision});
const recordOrder=<T extends {readonly ref:CoreRef;readonly revision:number}>(values:readonly T[]):T[]=>[...values].sort((a,b)=>pin(a)<pin(b)?-1:pin(a)>pin(b)?1:0);
const bag=<T>(values:readonly T[]):T[]=>values.map(value=>({value,key:canonicalCoreText(value)})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map(row=>row.value);
const sameEntity=(a:{readonly entity:CoreRef},b:{readonly entity:CoreRef})=>coreRefKey(a.entity)===coreRefKey(b.entity);

function prepare(value:unknown) {
  // Bound raw input before allocating the schema's normalized copy.
  canonicalCoreText(value);
  const input=parseCore(CoreSnapshotInputSchema,value);
  validateCoreIdentityGraph(input.identity);validateCoreSourceCatalog(input.sources,input.identity);
  validateCoreFrameCatalog(input.frames);validateCoreGeometryCatalog(input.geometry,input.identity,input.sources,input.frames);
  const worlds=indexCoreRecords(input.worlds,"world"),observations=indexCoreRecords(input.observations,"observation"),resolutions=indexCoreRecords(input.resolutions,"resolution");
  const entities=indexCoreRecords(input.identity.entities,"entity"),representations=indexCoreRecords(input.geometry.representations,"representation"),quantities=indexCoreRecords(input.geometry.reportedQuantities,"reported quantity");
  const parts=indexCoreRecords(input.sources.parts,"source part"),sources=indexCoreRecords(input.sources.sources,"source"),assets=indexCoreRecords(input.sources.assets,"asset"),datasets=indexCoreRecords(input.sources.datasets,"dataset"),frames=indexCoreRecords(input.frames.frames,"frame");
  indexCoreRecords(input.compositions,"composition");
  const world=requireCoreRevision(worlds,input.context.world,"snapshot world"),rank=CORE_SNAPSHOT_POLICY.accessRank,ceiling=rank[input.context.scope.ceiling];
  for(const item of [...input.sources.datasets,...input.sources.assets,...input.sources.sources,...input.sources.parts,...input.observations])
    if(rank[item.access]>ceiling)coreFail("ACCESS_SCOPE","Input contains data outside the declared authorization scope");
  const assetRanks=new Map<string,number>();
  const assetRank=(link:CoreRevisionRef):number=>{
    const root=requireCoreRevision(assets,link,"source asset");
    const stack:{asset:typeof root;leave:boolean}[]=[{asset:root,leave:false}];
    while(stack.length){const {asset,leave}=stack.pop()!,key=pin(asset);if(assetRanks.has(key))continue;
      if(leave){assetRanks.set(key,Math.max(rank[asset.access],...asset.parentAssets.map(p=>assetRanks.get(pin(p))!)));continue;}
      stack.push({asset,leave:true});for(const parent of asset.parentAssets)if(!assetRanks.has(pin(parent)))stack.push({asset:requireCoreRevision(assets,parent,"asset ancestry"),leave:false});
    }
    return assetRanks.get(pin(root))!;
  };
  for(const observation of input.observations){
    if(!entities.has(coreRefKey(observation.entity)))coreFail("MISSING_TARGET","Observation entity is absent");
    const observationWorld=requireCoreRevision(worlds,observation.world,"observation world");
    const {fromMs,toMs}=observation.validity;
    if(fromMs!==null&&toMs!==null&&fromMs>=toMs)coreFail("TIME_RANGE","Observation validity must have an increasing half-open interval");
    uniqueCoreKeys(observation.sourceParts.map(pin),"observation source parts");
    let requiredRank=0;
    if(observationWorld.state==="observed"&&observation.method==="synthetic")coreFail("WORLD_CLASSIFICATION","Synthetic observations cannot be labelled observed");
    for(const partRef of observation.sourceParts){
      const part=requireCoreRevision(parts,partRef,"observation source part"),source=requireCoreRevision(sources,part.source,"observation source"),dataset=source.dataset?requireCoreRevision(datasets,source.dataset,"source dataset"):null;
      requiredRank=Math.max(requiredRank,rank[part.access],rank[source.access],dataset?rank[dataset.access]:0,...source.assets.map(assetRank));
      if(observationWorld.state==="observed"&&(source.method==="synthetic"||dataset&&["planned","hypothetical","synthetic"].includes(dataset.classification)))coreFail("WORLD_CLASSIFICATION","Source classification contradicts an observed-world claim");
      if(["geometry","vertical_interval"].includes(observation.payload.kind)&&!part.locators.some(isPreciseCoreLocator))coreFail("LOCATOR_NOT_QUALIFIED","Geometry/vertical contribution requires an exact source part");
    }
    const payload=observation.payload;
    if(payload.kind==="geometry"){
      const rep=requireCoreRevision(representations,payload.representation,"observed representation");
      if(!sameEntity(rep,observation)||rep.role!==observation.role)coreFail("OBSERVATION_ROLE","Geometry observation must match the representation entity and role");
      for(const part of rep.sourceParts)if(!observation.sourceParts.some(p=>pin(p)===pin(part)))coreFail("OBSERVATION_PROVENANCE","Observation omitted a geometry contribution source");
      if(rep.geometry.profile==="asset")requiredRank=Math.max(requiredRank,assetRank(rep.geometry.asset));
    } else if(payload.kind==="vertical_interval"){
      if(observation.role!=="vertical_interval")coreFail("OBSERVATION_ROLE","Vertical payload has a different semantic role");
      const frame=requireCoreRevision(frames,payload.frame,"vertical observation frame"),interval=payload.interval;
      if(interval){
        if(interval.upperMetres<interval.lowerMetres||!Number.isFinite(interval.upperMetres-interval.lowerMetres))coreFail("GEOMETRY_INTERVAL","Vertical observation bounds are reversed or overflowed");
        if(frame.kind==="geocentric"||(frame.vertical.kind!=="benchmark"&&frame.vertical.kind!=="datum"))coreFail("VERTICAL_UNRESOLVED","A vertical interval requires a named benchmark or datum");
        if(pin(interval.reference)!==pin(frame.vertical.reference))coreFail("VERTICAL_MISMATCH","Vertical observation and frame use different reference zeros");
      }
    } else if(payload.kind==="reported_quantity"){
      const q=requireCoreRevision(quantities,payload.quantity,"observed reported quantity");
      if(!sameEntity(q,observation)||q.definition!==observation.role)coreFail("OBSERVATION_ROLE","Reported observation does not match its quantity definition/entity");
      if(!observation.sourceParts.some(p=>pin(p)===pin(q.sourcePart)))coreFail("OBSERVATION_PROVENANCE","Reported quantity source is missing from its observation");
    }
    if(rank[observation.access]<requiredRank)coreFail("ACCESS_DOWNGRADE","Observation cannot lower the access class of its contributing sources");
  }
  const resolutionKeys:string[]=[];
  for(const resolution of input.resolutions){
    if(!entities.has(coreRefKey(resolution.entity)))coreFail("MISSING_TARGET","Resolution entity is absent");
    requireCoreRevision(worlds,resolution.world,"resolution world");
    uniqueCoreKeys(resolution.candidates.map(pin),"resolution candidates");
    for(const candidate of resolution.candidates){
      const observation=requireCoreRevision(observations,candidate,"resolution candidate");
      if(!sameEntity(observation,resolution)||pin(observation.world)!==pin(resolution.world)||observation.role!==resolution.role)coreFail("RESOLUTION_SCOPE","Resolution candidates differ in entity, world or semantic role");
    }
    if(resolution.selected&&!resolution.candidates.some(p=>pin(p)===pin(resolution.selected!)))coreFail("RESOLUTION_SELECTION","Selected observation is not an exact candidate revision");
    resolutionKeys.push(canonicalCoreText([resolution.entity,resolution.world,resolution.role,resolution.purpose??"analysis"]));
  }
  uniqueCoreKeys(resolutionKeys,"entity/world/role resolution");
  const generated=new Set<string>();
  for(const composition of input.compositions){
    if(!entities.has(coreRefKey(composition.entity)))coreFail("MISSING_TARGET","Composition entity is absent");
    requireCoreRevision(worlds,composition.world,"composition world");
    const refs=composition.kind==="passthrough"?[composition.geometry]:[composition.footprint,composition.vertical];
    for(const link of refs){const resolution=requireCoreRevision(resolutions,link,"composition resolution");if(!sameEntity(resolution,composition)||pin(resolution.world)!==pin(composition.world))coreFail("COMPOSITION_SCOPE","Composition resolution has another world or entity");}
    if(composition.kind==="prism"){
      const footprint=requireCoreRevision(resolutions,composition.footprint,"footprint resolution"),vertical=requireCoreRevision(resolutions,composition.vertical,"vertical resolution");
      if(!(CORE_SNAPSHOT_POLICY.footprintRoles as readonly string[]).includes(footprint.role)||vertical.role!=="vertical_interval")coreFail("COMPOSITION_ROLE","A prism requires a qualified footprint and vertical schedule");
      const key=coreRefKey(composition.output.ref);
      if(representations.has(key)||generated.has(key))coreFail("OUTPUT_ID_COLLISION","Generated geometry cannot replace an existing identity");
      generated.add(key);
    }
  }
  return {input,world,observations,resolutions,representations,quantities,entities};
}
export function validateCoreSnapshotInput(value:unknown):CoreSnapshotInput{return prepare(value).input;}

/** Record/set ordering is canonicalized; coordinates, locators and paths are not. */
function orderedInput(input:CoreSnapshotInput) {
  return {...input,
    worlds:recordOrder(input.worlds),
    identity:{entities:recordOrder(input.identity.entities).map(e=>({...e,identifiers:bag(e.identifiers),memberships:bag(e.memberships),lifecycle:e.lifecycle.state==="active"?e.lifecycle:{...e.lifecycle,replacedBy:bag(e.lifecycle.replacedBy)}})),relations:[...input.identity.relations].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)},
    sources:{...input.sources,datasets:recordOrder(input.sources.datasets),assets:recordOrder(input.sources.assets).map(a=>({...a,parentAssets:bag(a.parentAssets)})),sources:recordOrder(input.sources.sources).map(s=>({...s,assets:bag(s.assets),workflows:bag(s.workflows)})),parts:recordOrder(input.sources.parts),links:recordOrder(input.sources.links),...(input.sources.linkHistory?{linkHistory:recordOrder(input.sources.linkHistory)}:{})},
    frames:{frames:recordOrder(input.frames.frames),operations:recordOrder(input.frames.operations)},
    geometry:{representations:recordOrder(input.geometry.representations).map(r=>({...r,sourceParts:bag(r.sourceParts)})),reportedQuantities:recordOrder(input.geometry.reportedQuantities).map(q=>({...q,amount:q.amount.state==="conflicting"?{...q.amount,candidates:bag(q.amount.candidates)}:q.amount}))},
    observations:recordOrder(input.observations).map(o=>({...o,sourceParts:bag(o.sourceParts)})),
    resolutions:recordOrder(input.resolutions).map(r=>({...r,candidates:bag(r.candidates)})),compositions:recordOrder(input.compositions),
  };
}
export interface CoreCompositionResult {
  composition:CoreRevisionRef;entity:CoreRef;status:"available"|"unavailable";
  representation:CoreRevisionRef|null;reasonCode:string|null;temporalCoverage:"bounded"|"unknown";
}
export async function buildCoreSnapshot(value:unknown) {
  const p=prepare(value),{input}=p;
  const selected=new Map<string,CoreRepresentation>(),selectedQuantities=new Map<string,CoreGeometryCatalog["reportedQuantities"][number]>(),results:CoreCompositionResult[]=[];
  const choose=(link:CoreRevisionRef):{observation:CoreObservation|null;reasonCode:string|null;temporalCoverage:"bounded"|"unknown"}=>{
    const resolution=requireCoreRevision(p.resolutions,link,"selected resolution");
    if(!resolution.selected)return {observation:null,reasonCode:"UNRESOLVED_SELECTION",temporalCoverage:"unknown"};
    const observation=requireCoreRevision(p.observations,resolution.selected,"selected observation"),{fromMs,toMs}=observation.validity,time=input.context.asOfMs;
    const temporalCoverage=time!==null&&fromMs!==null&&toMs!==null?"bounded":"unknown";
    if(time!==null&&(fromMs!==null&&time<fromMs||toMs!==null&&time>=toMs))return {observation:null,reasonCode:"OUTSIDE_VALIDITY",temporalCoverage};
    if(observation.payload.kind==="unavailable")return {observation:null,reasonCode:observation.payload.reasonCode,temporalCoverage};
    return {observation,reasonCode:null,temporalCoverage};
  };
  for(const composition of recordOrder(input.compositions).filter(c=>pin(c.world)===pin(input.context.world))){
    const base={composition:refVersion(composition),entity:composition.entity};
    const failResult=(reasonCode:string,temporalCoverage:"bounded"|"unknown"="unknown")=>results.push(Object.freeze({...base,status:"unavailable",representation:null,reasonCode,temporalCoverage}));
    const first=choose(composition.kind==="passthrough"?composition.geometry:composition.footprint);
    if(!first.observation){failResult(first.reasonCode!,first.temporalCoverage);continue;}
    if(first.observation.payload.kind!=="geometry")coreFail("COMPOSITION_PAYLOAD","Geometry selection has no geometry payload");
    const rep=requireCoreRevision(p.representations,first.observation.payload.representation,"selected geometry");
    let output:CoreRepresentation=rep,coverage=first.temporalCoverage;
    if(composition.kind==="prism"){
      const second=choose(composition.vertical);
      if(!second.observation){failResult(second.reasonCode!,second.temporalCoverage);continue;}
      const vertical=second.observation.payload;
      if(vertical.kind!=="vertical_interval")coreFail("COMPOSITION_PAYLOAD","Vertical selection has no interval payload");
      const shape=rep.geometry.profile==="planar"?rep.geometry.geometry:rep.geometry.profile==="prism"?rep.geometry.footprint:null;
      if(!shape||shape.type!=="Polygon"&&shape.type!=="MultiPolygon"){failResult("POLYGON_REQUIRED");continue;}
      if(!rep.frame){failResult("FRAME_UNRESOLVED");continue;}
      if(pin(rep.frame)!==pin(vertical.frame)){failResult("FRAME_MISMATCH");continue;}
      if(!vertical.interval){failResult("UNKNOWN_VERTICAL_INTERVAL");continue;}
      const parts=new Map([...first.observation.sourceParts,...second.observation.sourceParts].map(part=>[pin(part),part]));
      output={...composition.output,entity:composition.entity,frame:rep.frame,sourceParts:recordOrder([...parts.values()]),geometry:{profile:"prism",footprint:shape,interval:vertical.interval}};
      coverage=first.temporalCoverage==="bounded"&&second.temporalCoverage==="bounded"?"bounded":"unknown";
    }
    selected.set(coreRefKey(output.ref),output);
    results.push(Object.freeze({...base,status:"available",representation:Object.freeze(refVersion(output)),reasonCode:null,temporalCoverage:coverage}));
  }
  for(const resolution of input.resolutions.filter(r=>pin(r.world)===pin(input.context.world))){
    const choice=choose(refVersion(resolution));
    if(choice.observation?.payload.kind!=="reported_quantity")continue;
    const q=requireCoreRevision(p.quantities,choice.observation.payload.quantity,"selected quantity");selectedQuantities.set(coreRefKey(q.ref),q);
    if(q.amount.state==="conflicting")for(const link of q.amount.candidates){const candidate=requireCoreRevision(p.quantities,link,"selected quantity candidate");selectedQuantities.set(coreRefKey(candidate.ref),candidate);}
  }
  const geometry=validateCoreGeometryCatalog({representations:recordOrder([...selected.values()]),reportedQuantities:recordOrder([...selectedQuantities.values()])},input.identity,input.sources,input.frames);
  const usedEntities=new Set([...geometry.representations,...geometry.reportedQuantities].map(r=>coreRefKey(r.entity)));
  const entities=recordOrder(input.identity.entities.filter(e=>usedEntities.has(coreRefKey(e.ref))));
  const inputDigest=await coreInputDigest(orderedInput(input));
  // Conservative frame dependencies are intentional until affected-set compilation.
  const geometryDigest=await coreInputDigest({profile:CORE_SNAPSHOT_POLICY.compilerProfile,world:p.world,
    frames:{frames:recordOrder(input.frames.frames),operations:recordOrder(input.frames.operations)},
    entities:entities.map(e=>({ref:e.ref,kind:e.kind})),representations:geometry.representations.map(({sourceParts,...rep})=>rep)});
  const manifest=parseCore(CoreSnapshotManifestSchema,{schemaVersion:"ulpin-core-snapshot/1",state:"candidate",context:input.context,signatureVersion:CORE_SNAPSHOT_POLICY.canonicalEncoding,inputDigest,geometryDigest,
    representations:geometry.representations.map(refVersion),entities:entities.map(refVersion),retainedObservations:recordOrder(input.observations.filter(o=>pin(o.world)===pin(input.context.world))).map(refVersion)});
  return Object.freeze({manifest,geometry,results:Object.freeze(results)});
}

/** Metadata-only compatibility check. This does not verify uploaded asset bytes. */
export function validateCorePublicationCandidate(snapshotValue:unknown,publicationValue:unknown) {
  const snapshot=parseCore(CoreSnapshotManifestSchema,snapshotValue),publication=parseCore(CorePublicationCandidateSchema,publicationValue);
  if(publication.snapshotDigest!==snapshot.inputDigest||publication.geometryDigest!==snapshot.geometryDigest)coreFail("PUBLICATION_SNAPSHOT","Publication belongs to a different immutable snapshot");
  if(canonicalCoreText(publication.scope)!==canonicalCoreText(snapshot.context.scope))coreFail("ACCESS_SCOPE","Publication authorization scope differs from its snapshot");
  uniqueCoreKeys(publication.assets.map(a=>a.id),"publication assets");
  const assets=new Set(publication.assets.map(a=>a.id)),reps=new Set(snapshot.representations.map(pin));
  uniqueCoreKeys(publication.bindings.map(b=>canonicalCoreText([b.assetId,b.featureId])),"asset feature identities");
  for(const binding of publication.bindings){if(!assets.has(binding.assetId))coreFail("MISSING_REFERENCE","Publication feature refers to an absent derived asset");if(!reps.has(pin(binding.representation)))coreFail("STALE_REFERENCE","Publication feature is not an exact selected representation revision");}
  return publication;
}

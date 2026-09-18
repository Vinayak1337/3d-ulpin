import {polygonArea,signedRingArea,geometryPoints} from "../geometry";
import {metricTopologyIssue} from "../topology";
import type {SpatialGeometry,XY} from "../types";
import {coreFail,coreRefKey,parseCore,type CoreRevisionRef} from "./scalars";
import {validateCoreIdentityGraph} from "./identity";
import {isPreciseCoreLocator,validateCoreSourceCatalog} from "./sources";
import {validateCoreFrameCatalog,coreEngineeringHorizontalMetres} from "./frames";
import {indexCoreRecords,requireCoreRevision,uniqueCoreKeys} from "./references";
import type {CoreFrame} from "./frame-schema";
import {CORE_GEOMETRY_POLICY,CoreGeometryCatalogSchema,CoreMeasureRequestSchema,type CoreGeometryCatalog,type CoreMeasureRequest,type CorePlanarGeometry,type CoreRepresentation} from "./geometry-schema";

const pin=(r:CoreRevisionRef)=>`${coreRefKey(r.ref)}@${r.revision}`;
const areaGeometry=(g:CorePlanarGeometry)=>g.type==="Polygon"||g.type==="MultiPolygon";
const inline=(rep:CoreRepresentation):CorePlanarGeometry|null=>rep.geometry.profile==="planar"?rep.geometry.geometry:rep.geometry.profile==="prism"?rep.geometry.footprint:null;
const analytical=(rep:CoreRepresentation)=>!(CORE_GEOMETRY_POLICY.nonAnalyticalRoles as readonly string[]).includes(rep.role);
function normalise(g:CorePlanarGeometry,frame:CoreFrame):SpatialGeometry {
  if(frame.kind!=="engineering")coreFail("FRAME_PROFILE","Engineering frame required for planar metre analytics");
  const point=(p:XY):XY=>coreEngineeringHorizontalMetres(frame,p);
  switch(g.type){
    case "Point":return {type:g.type,coordinates:point(g.coordinates)};
    case "LineString":return {type:g.type,coordinates:g.coordinates.map(point)};
    case "Polygon":return {type:g.type,coordinates:g.coordinates.map(r=>r.map(point))};
    case "MultiPolygon":return {type:g.type,coordinates:g.coordinates.map(p=>p.map(r=>r.map(point)))};
  }
}
function structuralShape(g:CorePlanarGeometry) {
  if(!areaGeometry(g))return;
  const polygons=g.type==="Polygon"?[g.coordinates]:g.type==="MultiPolygon"?g.coordinates:[];
  for(const p of polygons)for(const r of p) {
    const last=r[r.length-1];
    if(r[0][0]!==last[0]||r[0][1]!==last[1])coreFail("GEOMETRY_RING","Polygon rings must be explicitly closed");
  }
}
function metricShape(g:SpatialGeometry) {
  if(!geometryPoints(g).every(p=>p.every(Number.isFinite)))coreFail("GEOMETRY_NUMERIC","Metre normalization overflowed");
  if(g.type==="Polygon"||g.type==="MultiPolygon") {
    const polygons=g.type==="Polygon"?[g.coordinates]:g.coordinates;
    for(const p of polygons)for(const r of p){const a=Math.abs(signedRingArea(r));if(!Number.isFinite(a)||a<=CORE_GEOMETRY_POLICY.areaFloorMetres2)coreFail("GEOMETRY_DEGENERATE","Polygon ring has no qualified positive area");}
    const issue=metricTopologyIssue(g);
    if(issue)coreFail(issue.includes("budget")?"GEOMETRY_BUDGET":"GEOMETRY_TOPOLOGY",issue);
  } else if(g.type==="LineString") {
    if(g.coordinates.every(p=>p[0]===g.coordinates[0][0]&&p[1]===g.coordinates[0][1]))coreFail("GEOMETRY_DEGENERATE","Line has no distinct positions");
  }
}

function topologyWork(g:SpatialGeometry):number {
  if(g.type!=="Polygon"&&g.type!=="MultiPolygon")return 0;
  const polygons=g.type==="Polygon"?[g.coordinates]:g.coordinates;
  let total=0;
  for(const p of polygons){
    for(let i=0;i<p.length;i++){
      const n=p[i].length-1;total+=n*(n-3)/2;
      for(let j=0;j<i;j++)total+=n*(p[j].length-1);
    }
  }
  for(let i=0;i<polygons.length;i++)for(let j=0;j<i;j++)total+=polygons[i].reduce((s,r)=>s+r.length-1,0)*polygons[j].reduce((s,r)=>s+r.length-1,0);
  return total;
}
/** Validate once at the read/command boundary; the returned prepared context is private. */
function prepare(value:unknown,identityValue:unknown,sourcesValue:unknown,framesValue:unknown) {
  const identity=validateCoreIdentityGraph(identityValue),sources=validateCoreSourceCatalog(sourcesValue,identity),frames=validateCoreFrameCatalog(framesValue);
  const catalog=parseCore(CoreGeometryCatalogSchema,value),entities=indexCoreRecords(identity.entities,"entity"),frameIndex=indexCoreRecords(frames.frames,"frame"),parts=indexCoreRecords(sources.parts,"source part"),assets=indexCoreRecords(sources.assets,"asset");
  const reps=indexCoreRecords(catalog.representations,"representation"),reported=indexCoreRecords(catalog.reportedQuantities,"reported quantity");
  let positions=0,comparisons=0;
  for(const rep of catalog.representations) {
    if(!entities.has(coreRefKey(rep.entity)))coreFail("MISSING_TARGET","Representation entity is absent");
    const frame=rep.frame?requireCoreRevision(frameIndex,rep.frame,"representation frame"):null;
    uniqueCoreKeys(rep.sourceParts.map(pin),"source parts");for(const link of rep.sourceParts)requireCoreRevision(parts,link,"representation source part");
    const g=inline(rep);
    if(g){
      for(const link of rep.sourceParts)if(!requireCoreRevision(parts,link,"geometry source part").locators.some(isPreciseCoreLocator))coreFail("LOCATOR_NOT_QUALIFIED","An inline geometry contribution needs an exact source locator");
      positions+=geometryPoints(g).length;if(positions>CORE_GEOMETRY_POLICY.maximumPositions)coreFail("GEOMETRY_BUDGET","Catalog exceeds the inline geometry position profile");
      structuralShape(g);
      if(frame?.kind==="engineering"){
        const metric=normalise(g,frame);comparisons+=topologyWork(metric);
        if(comparisons>CORE_GEOMETRY_POLICY.maximumTopologyComparisons)coreFail("GEOMETRY_BUDGET","Catalog exceeds the bounded topology comparison profile");
        metricShape(metric);
      }
    }
    if(rep.geometry.profile==="asset")requireCoreRevision(assets,rep.geometry.asset,"geometry asset");
    if(rep.geometry.profile==="prism"&&rep.geometry.interval){
      const interval=rep.geometry.interval;
      if(interval.upperMetres<interval.lowerMetres)coreFail("GEOMETRY_INTERVAL","Positive-up metre elevations are reversed");
      if(!Number.isFinite(interval.upperMetres-interval.lowerMetres))coreFail("GEOMETRY_NUMERIC","Vertical extent overflowed");
      if(!frame||frame.kind==="geocentric"||(frame.vertical.kind!=="benchmark"&&frame.vertical.kind!=="datum"))coreFail("VERTICAL_UNRESOLVED","A prism interval requires its exact named vertical reference");
      if(pin(interval.reference)!==pin(frame.vertical.reference))coreFail("VERTICAL_MISMATCH","Prism bounds do not use the frame's vertical reference");
    }
  }
  for(const q of catalog.reportedQuantities){
    if(!entities.has(coreRefKey(q.entity)))coreFail("MISSING_TARGET","Reported quantity entity is absent");
    requireCoreRevision(parts,q.sourcePart,"reported quantity source part");
    if(!(CORE_GEOMETRY_POLICY.reportedUnits[q.definition] as readonly string[]).includes(q.unit))coreFail("QUANTITY_UNIT","Reported unit and quantity definition have different dimensions");
    if(q.amount.state==="conflicting"){
      uniqueCoreKeys(q.amount.candidates.map(pin),"quantity candidates");
      const values=new Set<number>();
      for(const link of q.amount.candidates){const other=requireCoreRevision(reported,link,"quantity candidate");
        if(coreRefKey(other.entity)!==coreRefKey(q.entity)||other.definition!==q.definition||other.unit!==q.unit||other.amount.state!=="known")
          coreFail("QUANTITY_CONFLICT","Conflict candidates must be known, comparable quantities for the same entity");
        values.add(other.amount.value);
      }
      if(values.size<2)coreFail("QUANTITY_CONFLICT","Equal reported values do not form a numeric disagreement");
    }
  }
  return {catalog,entities,frameIndex,reps,parts};
}
export function validateCoreGeometryCatalog(value:unknown,identity:unknown,sources:unknown,frames:unknown):CoreGeometryCatalog {
  return prepare(value,identity,sources,frames).catalog;
}
function available(value:boolean,reason:string){return Object.freeze({available:value,reasonCode:value?null:reason});}
function evaluated(rep:CoreRepresentation,frame:CoreFrame|null,entityKind:string) {
  const g=inline(rep),polygon=!!g&&areaGeometry(g);
  const interval=rep.geometry.profile==="prism"?rep.geometry.interval:null;
  const horizontal=computeQuantity(rep,frame,g?.type==="LineString"?"planar_length":"horizontal_area");
  const volume=computeQuantity(rep,frame,"prism_volume");
  return Object.freeze({
    source_reference:available(rep.sourceParts.length>0,"NO_SOURCE_PART"),
    local_preview:available(!!g,"NO_INLINE_GEOMETRY"),
    horizontal_measurement:available(horizontal.value!==null,horizontal.reasonCode??"QUANTITY_GEOMETRY"),
    prism_volume:available(volume.value!==null,volume.reasonCode??"QUANTITY_GEOMETRY_ROLE"),
    exterior_render:available(volume.value!==null&&!!interval&&interval.upperMetres>interval.lowerMetres,"NO_POSITIVE_QUALIFIED_PRISM"),
    interior_selection:available(polygon&&((entityKind==="space"&&rep.role==="unit_boundary")||(entityKind==="level"&&rep.role==="floor_boundary")),"NO_IDENTIFIED_INTERIOR"),
  });
}
export function evaluateCoreGeometry(value:unknown,identity:unknown,sources:unknown,frames:unknown) {
  const p=prepare(value,identity,sources,frames);
  return p.catalog.representations.map(rep=>({representation:{ref:rep.ref,revision:rep.revision},capabilities:evaluated(rep,rep.frame?requireCoreRevision(p.frameIndex,rep.frame,"frame"):null,p.entities.get(coreRefKey(rep.entity))!.kind)}));
}
export function measureCoreRepresentation(value:unknown,identity:unknown,sources:unknown,frames:unknown,requestValue:unknown) {
  const p=prepare(value,identity,sources,frames),request=parseCore(CoreMeasureRequestSchema,requestValue),rep=requireCoreRevision(p.reps,request.representation,"measurement representation");
  const frame=rep.frame?requireCoreRevision(p.frameIndex,rep.frame,"frame"):null;
  const base={definition:request.definition,unit:request.definition==="horizontal_area"?"m2":request.definition==="prism_volume"?"m3":"m",representation:request.representation,frame:rep.frame,method:CORE_GEOMETRY_POLICY.method,sourceParts:rep.sourceParts};
  return Object.freeze({...base,...computeQuantity(rep,frame,request.definition)});
}
/** One numeric eligibility path serves both readiness and the actual quantity. */
function computeQuantity(rep:CoreRepresentation,frame:CoreFrame|null,definition:CoreMeasureRequest["definition"]) {
  const g=inline(rep);
  const unavailable=(reasonCode:string)=>({value:null,reasonCode});
  if(!g)return unavailable("NO_INLINE_GEOMETRY");
  if(frame?.kind!=="engineering")return unavailable("ENGINEERING_FRAME_REQUIRED");
  if(!analytical(rep))return unavailable("NON_ANALYTICAL_ROLE");
  const metric=normalise(g,frame);let result:number;
  if(definition==="planar_length") {
    if(metric.type!=="LineString")return unavailable("LINE_REQUIRED");
    result=0;for(let i=1;i<metric.coordinates.length;i++)result+=Math.hypot(metric.coordinates[i][0]-metric.coordinates[i-1][0],metric.coordinates[i][1]-metric.coordinates[i-1][1]);
  } else {
    if(metric.type!=="Polygon"&&metric.type!=="MultiPolygon")return unavailable("POLYGON_REQUIRED");
    result=metric.type==="Polygon"?polygonArea(metric.coordinates):metric.coordinates.reduce((s,p)=>s+polygonArea(p),0);
    if(definition==="prism_volume"){
      if(!(CORE_GEOMETRY_POLICY.volumeRoles as readonly string[]).includes(rep.role))return unavailable("QUANTITY_GEOMETRY_ROLE");
      if(rep.geometry.profile!=="prism"||!rep.geometry.interval)return unavailable("UNKNOWN_VERTICAL_INTERVAL");
      result*=rep.geometry.interval.upperMetres-rep.geometry.interval.lowerMetres;
    }
  }
  if(!Number.isFinite(result)||result<0)return unavailable("QUANTITY_NUMERIC");
  return {value:result,reasonCode:null};
}

import {z} from "zod";
import {enuToEcef,transformPoint} from "../frames";
import {CoreIdSchema,coreFail,coreRefKey,coreText,parseCore,type CoreRevisionRef} from "./scalars";
import {indexCoreRecords,requireCoreRevision} from "./references";
import {
  CORE_FRAME_POLICY,CoreFrameCatalogSchema,CoreFrameSchema,CorePointTransformSchema,
  type CoreCoordinate,type CoreEngineeringFrame,type CoreFrame,type CoreFrameCatalog,type CoreTransform,
} from "./frame-schema";

const eastWest = (axis:string) => axis==="east"||axis==="west";
const sign = (axis:string) => axis==="west"||axis==="south"||axis==="down"?-1:1;
const pinnedKey = (link:CoreRevisionRef) => `${coreRefKey(link.ref)}@${link.revision}`;
const hasVertical = (frame:CoreFrame):frame is Exclude<CoreFrame,{kind:"geocentric"}> => frame.kind!=="geocentric";
const knownVertical = (frame:CoreFrame) => hasVertical(frame)&&(frame.vertical.kind==="benchmark"||frame.vertical.kind==="datum");

function sameVertical(a:CoreEngineeringFrame,b:CoreEngineeringFrame):boolean {
  return (a.vertical.kind==="benchmark"||a.vertical.kind==="datum")&&
    (b.vertical.kind==="benchmark"||b.vertical.kind==="datum")&&
    a.vertical.kind===b.vertical.kind&&pinnedKey(a.vertical.reference)===pinnedKey(b.vertical.reference);
}
export function validateCoreFrameCatalog(input:unknown):CoreFrameCatalog {
  const catalog=parseCore(CoreFrameCatalogSchema,input);
  const frames=indexCoreRecords(catalog.frames,"frame");
  indexCoreRecords(catalog.operations,"transform");
  for(const frame of catalog.frames) {
    if((frame.kind==="engineering"||frame.kind==="projected")&&eastWest(frame.axes[0])===eastWest(frame.axes[1]))
      coreFail("FRAME_AXES","A planar frame requires one east/west and one north/south axis");
  }
  for(const operation of catalog.operations) {
    const from=requireCoreRevision(frames,operation.from,"source frame"),to=requireCoreRevision(frames,operation.to,"target frame");
    if(pinnedKey(operation.from)===pinnedKey(operation.to))coreFail("TRANSFORM_SELF","Use an empty path for an unchanged frame");
    if(operation.kind==="unsupported")continue;
    if(from.kind!=="engineering")coreFail("FRAME_PROFILE","This executor requires an engineering source frame");
    const domain=operation.sourceDomain;
    if(domain&&(domain.minEast>domain.maxEast||domain.minNorth>domain.maxNorth))coreFail("FRAME_BOUNDS","Transform source bounds are reversed");
    if(operation.kind==="local_rigid") {
      if(to.kind!=="engineering")coreFail("FRAME_PROFILE","Local registration requires two engineering frames");
      if(operation.verticalTie.kind!=="unavailable") {
        if(!knownVertical(from)||!knownVertical(to))coreFail("VERTICAL_UNRESOLVED","A constant tie cannot establish unknown or surface-relative height");
        if(operation.verticalTie.kind==="same_reference"&&!sameVertical(from,to))coreFail("VERTICAL_MISMATCH","The declared vertical references differ");
        if(operation.verticalTie.kind==="constant_offset"&&sameVertical(from,to)&&operation.verticalTie.offsetMetres!==0)
          coreFail("VERTICAL_MISMATCH","One exact reference cannot have two elevation zeros");
      }
    } else {
      if(to.kind!=="geocentric")coreFail("FRAME_PROFILE","WGS84 ENU placement requires the WGS84 ECEF target");
      if(from.vertical.kind!=="benchmark"||pinnedKey(from.vertical.reference)!==pinnedKey(operation.benchmark))
        coreFail("VERTICAL_MISMATCH","The ellipsoidal origin must tie the exact local benchmark");
    }
  }
  return catalog;
}

/** Internal numeric helper: callers must first validate the frame and coordinates. */
export function coreEngineeringHorizontalMetres(frame:CoreEngineeringFrame,point:CoreCoordinate):[number,number] {
  const factor=CORE_FRAME_POLICY.lengthMetres[frame.horizontalUnit];
  const first=point[0]*factor*sign(frame.axes[0]),second=point[1]*factor*sign(frame.axes[1]);
  return eastWest(frame.axes[0])?[first,second]:[second,first];
}
function upMetres(frame:CoreEngineeringFrame,value:number):number {
  return value*CORE_FRAME_POLICY.lengthMetres[frame.verticalUnit]*sign(frame.verticalDirection);
}
function encode(frame:CoreEngineeringFrame,east:number,north:number,up:number|undefined):CoreCoordinate {
  const factor=CORE_FRAME_POLICY.lengthMetres[frame.horizontalUnit];
  const first=(eastWest(frame.axes[0])?east:north)*sign(frame.axes[0])/factor;
  const second=(eastWest(frame.axes[1])?east:north)*sign(frame.axes[1])/factor;
  return up===undefined?[first,second]:[first,second,up*sign(frame.verticalDirection)/CORE_FRAME_POLICY.lengthMetres[frame.verticalUnit]];
}
function checkDomain(operation:Exclude<CoreTransform,{kind:"unsupported"}>,east:number,north:number) {
  const d=operation.sourceDomain;
  if(d&&(east<d.minEast||east>d.maxEast||north<d.minNorth||north>d.maxNorth))coreFail("OUTSIDE_DOMAIN","Point is outside the declared source-domain bounds");
}
function applyLocal(operation:Extract<CoreTransform,{kind:"local_rigid"}>,from:CoreEngineeringFrame,to:CoreEngineeringFrame,point:CoreCoordinate,inverse:boolean):CoreCoordinate {
  const inputFrame=inverse?to:from,outputFrame=inverse?from:to;
  const [east,north]=coreEngineeringHorizontalMetres(inputFrame,point),[dx,dy]=operation.translationMetres;
  const angle=operation.rotationDegrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  let outEast:number,outNorth:number;
  if(inverse){outEast=(east-dx)*c+(north-dy)*s;outNorth=-(east-dx)*s+(north-dy)*c;checkDomain(operation,outEast,outNorth);}
  else{checkDomain(operation,east,north);outEast=east*c-north*s+dx;outNorth=east*s+north*c+dy;}
  let up:number|undefined;
  if(point.length===3) {
    if(operation.verticalTie.kind==="unavailable")coreFail("VERTICAL_UNRESOLVED","No qualified vertical tie was supplied for this operation");
    const offset=operation.verticalTie.kind==="constant_offset"?operation.verticalTie.offsetMetres:0;
    up=upMetres(inputFrame,point[2])+(inverse?-offset:offset);
  }
  return encode(outputFrame,outEast,outNorth,up);
}
function applyEnu(operation:Extract<CoreTransform,{kind:"wgs84_enu"}>,from:CoreEngineeringFrame,point:CoreCoordinate,inverse:boolean):CoreCoordinate {
  if(point.length!==3)coreFail("POINT_DIMENSION","World placement requires an explicit three-dimensional point");
  // Guarded reuse of the qualified v1 display primitive. No CRS/datum inference.
  const matrix=enuToEcef({id:from.ref.id,kind:"engineering",horizontalUnit:"m",verticalUnit:"m",axes:"east-north-up",verticalReference:coreRefKey(operation.benchmark.ref),
    anchor:{longitude:operation.origin.longitude,latitude:operation.origin.latitude,ellipsoidHeight:operation.origin.ellipsoidHeightMetres,provenance:operation.provenance}});
  if(!inverse) {
    const [east,north]=coreEngineeringHorizontalMetres(from,point);checkDomain(operation,east,north);
    return transformPoint(matrix,[east,north,upMetres(from,point[2])]);
  }
  const dx=point[0]-matrix[12],dy=point[1]-matrix[13],dz=point[2]-matrix[14];
  const east=dx*matrix[0]+dy*matrix[1]+dz*matrix[2],north=dx*matrix[4]+dy*matrix[5]+dz*matrix[6],up=dx*matrix[8]+dy*matrix[9]+dz*matrix[10];
  checkDomain(operation,east,north);
  return encode(from,east,north,up);
}

/** Execute only an explicit, revision-pinned path. No implicit route or Z filling. */
export function transformCorePoint(catalogInput:unknown,requestInput:unknown) {
  const catalog=validateCoreFrameCatalog(catalogInput),request=parseCore(CorePointTransformSchema,requestInput);
  const frames=indexCoreRecords(catalog.frames,"frame"),operations=indexCoreRecords(catalog.operations,"transform");
  const start=requireCoreRevision(frames,request.from,"request source"),end=requireCoreRevision(frames,request.to,"request target");
  if((start.kind==="geocentric"||end.kind==="geocentric")&&request.point.length!==3)coreFail("POINT_DIMENSION","ECEF points require three coordinates");
  if(request.point.length===3&&[start,end].some(frame=>hasVertical(frame)&&!knownVertical(frame)))
    coreFail("VERTICAL_UNRESOLVED","Unknown or surface-relative Z does not establish a three-dimensional frame tie");
  let point:CoreCoordinate=request.point,cursor=request.from;
  const visited=new Set([pinnedKey(cursor)]),declaredAccuraciesMetres:(number|null)[]=[];
  for(const step of request.steps) {
    const operation=requireCoreRevision(operations,step.operation,"requested transform"),inverse=step.direction==="inverse";
    const input=inverse?operation.to:operation.from,output=inverse?operation.from:operation.to;
    if(pinnedKey(input)!==pinnedKey(cursor))coreFail("TRANSFORM_PATH","Operation path is not frame/revision continuous");
    if(visited.has(pinnedKey(output)))coreFail("TRANSFORM_CYCLE","Operation path repeats a frame");
    if(operation.kind==="unsupported")coreFail("TRANSFORM_PROFILE","The selected transform profile has no qualified executor");
    const from=requireCoreRevision(frames,operation.from,"operation source"),to=requireCoreRevision(frames,operation.to,"operation target");
    if(from.kind!=="engineering")coreFail("FRAME_PROFILE","Engineering source required");
    if(operation.kind==="local_rigid") {
      if(to.kind!=="engineering")coreFail("FRAME_PROFILE","Engineering target required");
      point=applyLocal(operation,from,to,point,inverse);
    } else point=applyEnu(operation,from,point,inverse);
    if(!point.every(Number.isFinite))coreFail("NON_FINITE_RESULT","Coordinate arithmetic overflowed the supported numeric profile");
    visited.add(pinnedKey(output));cursor=output;declaredAccuraciesMetres.push(operation.accuracyMetres);
  }
  if(pinnedKey(cursor)!==pinnedKey(request.to))coreFail("TRANSFORM_PATH","Operation path does not reach the requested target revision");
  return Object.freeze({point:Object.freeze([...point]),frame:request.to,steps:request.steps,declaredAccuraciesMetres:Object.freeze(declaredAccuraciesMetres)});
}

const LegacyFrameSchema=z.strictObject({
  id:CoreIdSchema,kind:z.enum(["engineering","geographic"]),horizontalUnit:z.enum(["m","degree"]),verticalUnit:z.literal("m"),
  axes:z.enum(["east-north-up","longitude-latitude-height"]),verticalReference:coreText(1024).nullable(),sourceCrs:coreText(4096).optional(),
  anchor:z.strictObject({longitude:z.number().min(-180).max(180),latitude:z.number().min(-90).max(90),ellipsoidHeight:z.number(),provenance:coreText(2048)}).optional(),
});
/** Preserve v1 metadata; a repeated free-text benchmark label is not a datum tie. */
export function projectLegacyCoreFrame(input:unknown) {
  const legacy=parseCore(LegacyFrameSchema,input);
  if(legacy.kind==="engineering"&&(legacy.horizontalUnit!=="m"||legacy.axes!=="east-north-up")||
     legacy.kind==="geographic"&&(legacy.horizontalUnit!=="degree"||legacy.axes!=="longitude-latitude-height"))coreFail("FRAME_PROFILE","Legacy frame axes/units contradict its kind");
  const common={ref:{namespace:"frame" as const,id:legacy.id},revision:1,label:legacy.id,sourceCrs:legacy.sourceCrs??null,verticalUnit:"m" as const,verticalDirection:"up" as const,
    vertical:legacy.verticalReference===null?{kind:"unknown",reason:"Legacy source supplies no named vertical reference"}:
      {kind:"benchmark",reference:{ref:{namespace:"legacy_frame_benchmark",id:legacy.id},revision:1},label:legacy.verticalReference}};
  const frame=parseCore(CoreFrameSchema,legacy.kind==="engineering"?{...common,kind:"engineering",horizontalUnit:"m",axes:["east","north"]}:
    {...common,kind:"geographic",angularUnit:"degree",axes:"longitude-latitude"});
  return Object.freeze({frame,legacyAnchor:legacy.anchor??null});
}

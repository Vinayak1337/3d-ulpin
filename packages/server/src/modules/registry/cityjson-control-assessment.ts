import {z} from 'zod';
import type {PoolClient} from 'pg';
import {CITYJSON_CONTROL_VERSION,CITYJSON_CONTROL_LIMITS,NativePointControlSchema,RegistryCityJSONControlRequestSchema,
  RegistryCityJSONControlAssessmentSchema,type RegistryCityJSONControlRequest,type RegistryCityJSONControlAssessment}
  from '../../../../contracts/src/registry-cityjson-control-assessment';
import {transaction} from '../../infrastructure/db';
import {AppError,conflict,notFound} from '../../infrastructure/errors';
import {sha256} from '../../infrastructure/storage';
import {fingerprint} from '../cases/domain';
import {readRegistryCityJSONReferenceAuthorityTx} from './cityjson-reference';
import {readRegistryCityJSONDraftTx} from './cityjson-draft';
import {documentReviewContext} from './registry-document-evidence';

type Aggregate=Awaited<ReturnType<typeof readRegistryCityJSONReferenceAuthorityTx>>;
type Native=Awaited<ReturnType<typeof readRegistryCityJSONDraftTx>>;
type Source={id:string;family_id:string;sha256:string;inspection:Record<string,any>|null};
export type CityJSONControlDependencies={transaction:typeof transaction;references:typeof readRegistryCityJSONReferenceAuthorityTx;
  native:typeof readRegistryCityJSONDraftTx};
const defaults:CityJSONControlDependencies={transaction,references:readRegistryCityJSONReferenceAuthorityTx,native:readRegistryCityJSONDraftTx};
const frame={id:'EPSG:7415',axes:['easting','northing','height'] as [string,string,string],unit:'m',vertical:'NAP'};
const coordinate=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
function bounded<T>(value:T,limit:number){
  if(Buffer.byteLength(JSON.stringify(value))>limit)throw new AppError(413,'CITYJSON_CONTROL_LIMIT','Select a smaller point-control comparison.');
  return value;
}
function pins(aggregate:Aggregate){const {current,references}=aggregate;return {id:current.draft.id,
  draftRevision:current.draft.revision,recordId:current.record.id,candidateSha256:fingerprint(current.candidate),
  selectionSha256:fingerprint(current.candidate.selection),referencesSha256:fingerprint(references.references.map(entry=>entry.pin))};}
function selectedVertices(boundaries:unknown){
  const result=new Set<number>();let count=0;
  function visit(value:unknown,depth:number){
    if(++count>100000||depth>5)throw new AppError(413,'CITYJSON_CONTROL_LIMIT','The selected native boundaries exceed this point profile.');
    if(Array.isArray(value)){for(const child of value)visit(child,depth+1);}
    else if(typeof value==='number'&&Number.isInteger(value)&&value>=0)result.add(value);
    else throw new AppError(422,'CITYJSON_CONTROL_NATIVE','The exact native boundary indices are unavailable.');
  }
  visit(boundaries,0);return result;
}
/** Arithmetic only. Inputs are already accepted exact native/reference views;
 * coordinates in an HTTP request never enter this calculation. */
export function cityjsonControlProjection(request:RegistryCityJSONControlRequest,aggregate:Aggregate,native:Native,
  sources:Source[],context:ReturnType<typeof documentReviewContext>):RegistryCityJSONControlAssessment{
  const {current}=aggregate,candidate=current.candidate;
  if(native.draftId!==current.draft.id||native.draftRevision!==current.draft.revision||native.recordId!==current.record.id||
    fingerprint(native.candidate)!==fingerprint(candidate))conflict('The exact native comparison selection changed.');
  const authority=pins(aggregate);
  if(request.expectedDraftRevision!==authority.draftRevision||request.candidateSha256!==authority.candidateSha256||
    request.selectionSha256!==authority.selectionSha256||request.referencesSha256!==authority.referencesSha256)
    conflict('Pin the exact current native candidate and retained references.');
  if(fingerprint(native.native.encodedVertices)!==candidate.selection.verticesSha256||
    fingerprint(native.native.transform)!==candidate.selection.transformSha256||
    fingerprint(native.native.geometry)!==candidate.selection.geometrySha256)
    conflict('The native comparison arrays differ from their exact accepted selection.');
  const transform=native.native.transform===null?{scale:[1,1,1],translate:[0,0,0]}:
    z.strictObject({scale:coordinate,translate:coordinate}).parse(native.native.transform);
  const geometry=z.object({boundaries:z.unknown()}).parse(native.native.geometry),vertices=selectedVertices(geometry.boundaries);
  const byReference=new Map(aggregate.references.references.map(entry=>[entry.pin.id,entry]));
  const points:RegistryCityJSONControlAssessment['points']=[],missing:RegistryCityJSONControlAssessment['missing']=[];
  for(const match of request.correspondences){
    const entry=byReference.get(match.referenceId)??notFound('The selected control reference is unavailable.'),{pin,part}=entry;
    if(sha256(part.text)!==pin.partSha256||part.sha256!==pin.partSha256||fingerprint(part.locator)!==fingerprint(pin.locator))
      conflict('The exact selected control literal or locator changed.');
    const source=sources.find(row=>row.id===pin.document.sourceId)??notFound('The selected control source is unavailable.');
    if(source.sha256!==pin.document.sourceSha256)conflict('The control source receipt changed.');
    const base={referenceId:pin.id,nativeVertexIndex:match.nativeVertexIndex,
      nativeVertexPointer:`${candidate.selection.verticesPointer}/${match.nativeVertexIndex}`,reviewSha256:fingerprint(match.review),
      evidence:{document:pin.document,partId:pin.partId,partSha256:pin.partSha256,locator:pin.locator,coordinatePointer:'/coordinates' as const,
        inputSha256:pin.inputSha256,readerSha256:pin.readerSha256,acceptedFence:pin.acceptedFence},controlId:null as string|null,
      state:'needs_input' as const,reasonCode:null as string|null,nativePosition:null,controlPosition:null,residual:null,
      horizontalMetres:null,verticalMetres:null,distanceMetres:null};
    let control:z.infer<typeof NativePointControlSchema>|undefined,reason:string|undefined;
    if(source.sha256===candidate.input.sourceSha256||source.id===candidate.input.sourceId||
      source.family_id===candidate.input.sourceFamilyId||pin.document.caseId===candidate.input.caseId||source.inspection?.copiedFrom)
      reason='independent_control_source_required';
    else if(part.locator.line===undefined||part.locator.page!==undefined||part.locator.cell!==undefined||
      (part.locator.segmentCount??1)!==1)reason='literal_text_control_locator_required';
    else try{const parsed=NativePointControlSchema.safeParse(JSON.parse(part.text));
      if(parsed.success)control=parsed.data;else reason='source_point_control_profile_unavailable';
    }catch{reason='source_point_control_profile_unavailable';}
    if(control){
      base.controlId=control.controlId;
      if(control.acquisition.method!=='independent_survey')reason='independent_survey_provenance_required';
      else if(control.targetObjectId!==candidate.selection.objectId)reason='control_object_correspondence_unavailable';
      else if(fingerprint(control.frame)!==fingerprint(frame)||candidate.reference.crs!==frame.id||candidate.reference.vertical!==frame.vertical||
        current.site.frame?.id!==frame.id||current.site.frame?.horizontalUnit!=='m'||current.site.frame?.verticalUnit!=='m'||
        current.site.frame?.benchmark!==frame.vertical)reason='same_named_frame_axes_metres_required';
      else if(control.coordinates===undefined)reason='control_coordinates_absent';
      else if(control.coordinates===null)reason='control_coordinates_null';
      else if(control.coordinates.some(value=>value===null))reason='control_coordinates_incomplete';
      else if(!vertices.has(match.nativeVertexIndex)||!native.native.encodedVertices[match.nativeVertexIndex])reason='native_vertex_outside_selected_geometry';
    }
    if(reason||!control){const code=reason??'source_point_control_profile_unavailable';
      points.push({...base,reasonCode:code});missing.push({referenceId:pin.id,reasonCode:code});continue;}
    const encoded=native.native.encodedVertices[match.nativeVertexIndex];
    const position=coordinate.parse(encoded.map((value,axis)=>value*transform.scale[axis]+transform.translate[axis]));
    const measured=coordinate.parse(control.coordinates),residual=coordinate.parse(position.map((value,axis)=>value-measured[axis]));
    const horizontal=Math.hypot(residual[0],residual[1]),distance=Math.hypot(...residual);
    if(!Number.isFinite(distance)||distance>1e7)throw new AppError(422,'CITYJSON_CONTROL_NUMERIC','Coordinates exceed this bounded metre profile.');
    points.push({...base,state:'comparison_computed',nativePosition:position,controlPosition:measured,residual,
      horizontalMetres:horizontal,verticalMetres:residual[2],distanceMetres:distance});
  }
  if(!points.length)missing.push({referenceId:null,reasonCode:'independent_point_controls_missing'});
  let metrics:RegistryCityJSONControlAssessment['metrics']=null;
  if(points.length&&!missing.length){
    const count=points.length,mean=(read:(point:typeof points[number])=>number)=>points.reduce((sum,p)=>sum+read(p),0)/count;
    metrics={count,meanResidual:[0,1,2].map(axis=>mean(p=>p.residual![axis])) as [number,number,number],
      rmseHorizontalMetres:Math.sqrt(mean(p=>p.horizontalMetres!**2)),rmseVerticalMetres:Math.sqrt(mean(p=>p.verticalMetres!**2)),
      rmse3DMetres:Math.sqrt(mean(p=>p.distanceMetres!**2)),maximum3DMetres:Math.max(...points.map(p=>p.distanceMetres!))};
  }
  const body={version:CITYJSON_CONTROL_VERSION,state:metrics?'comparison_computed' as const:'needs_input' as const,draft:authority,
    source:{caseId:candidate.input.caseId,caseRevision:candidate.input.caseRevision,sourceId:candidate.input.sourceId,
      sourceSha256:candidate.input.sourceSha256,nativeArtifactSha256:candidate.artifact.sha256,
      verticesSha256:candidate.selection.verticesSha256,transformSha256:candidate.selection.transformSha256},frame,points,metrics,missing,
    provenance:{method:'same_named_frame_point_residuals',nativeDecode:'cityjson_scale_translate_once',controlProfile:'native-point-control/1',
      reviewAttribution:'local_process',contextSha256:fingerprint(context),inputSha256:fingerprint({request,authority,context}),
      independence:'source_declared_and_operator_reviewed'},accuracy:'not_assessed',admission:'unavailable',qualification:'not_assessed',learningQualification:'not_assessed'};
  return bounded(RegistryCityJSONControlAssessmentSchema.parse({...body,assessmentSha256:fingerprint(body)}),CITYJSON_CONTROL_LIMITS.responseBytes);
}
/** Read-only consumer of existing complete reference/native authority. Each
 * reference reader rechecks its whole input set after private document I/O.
 * Repeat it after native I/O and suppress any stale/revoked aggregate. */
export async function cityjsonControlSourcesTx(client:PoolClient,aggregate:Aggregate,request:RegistryCityJSONControlRequest){
  const ids=[...new Set(request.correspondences.map(match=>
    aggregate.references.references.find(entry=>entry.pin.id===match.referenceId)?.pin.document.sourceId??notFound()))].sort();
  return (await client.query('SELECT id,family_id,sha256,inspection FROM sources WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[ids])).rows as Source[];
}
export async function prepareCityJSONControls(draftValue:string,raw:unknown,deps:CityJSONControlDependencies=defaults){
  const draftId=z.uuid().parse(draftValue).toLowerCase(),request=RegistryCityJSONControlRequestSchema.parse(raw),context=documentReviewContext();
  bounded(request,CITYJSON_CONTROL_LIMITS.requestBytes);
  const resolve=(readNative=false)=>deps.transaction(async client=>{
    const aggregate=await deps.references(client,draftId,request.expectedDraftRevision);
    const sources=await cityjsonControlSourcesTx(client,aggregate,request);
    const native=readNative?await deps.native(client,draftId):null;
    if(fingerprint(context)!==fingerprint(documentReviewContext()))throw new AppError(403,'CITYJSON_CONTROL_DENIED','The comparison access changed.');
    return {aggregate,sources,native};
  });
  try{
    const before=await resolve(true),after=await resolve();
    if(fingerprint({aggregate:before.aggregate,sources:before.sources})!==fingerprint({aggregate:after.aggregate,sources:after.sources}))
      conflict('Native/reference/control authority changed during private I/O. Refresh the comparison.');
    return {draftId,request,context,aggregate:after.aggregate,sources:after.sources,
      assessment:cityjsonControlProjection(request,after.aggregate,before.native!,after.sources,context)};
  }catch(error){if(error instanceof AppError&&[403,404].includes(error.status))
    throw new AppError(404,'CITYJSON_CONTROL_UNAVAILABLE','The selected private native/control evidence is unavailable.');throw error;}
}
export async function assessCityJSONControls(draftValue:string,raw:unknown,deps:CityJSONControlDependencies=defaults){
  return (await prepareCityJSONControls(draftValue,raw,deps)).assessment;
}
export class CityJSONControlAssessmentService{assess(draftId:string,raw:unknown){return assessCityJSONControls(draftId,raw);}}

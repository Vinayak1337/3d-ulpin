import {z} from 'zod';
import type {RequestContext} from '@ulpin/contracts/usp';
import {SOURCE_FUSION_VERSION,SOURCE_FUSION_LIMITS,SourceFusionRequestSchema,SourceFusionContextSchema,
  SourceFusionLiteralJsonSchema,SourceFusionLiteralObjectSchema,
  type SourceFusionContext,type SourceFusionSelection} from '../../../../../contracts/src/source-fusion';
import {AppError} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {assertLocalUsp} from '../snapshots';
import {fusionAuthorityBatch,readFusionResult,fusionLive,type FusionBudget} from './source-fusion-authority';

type Loaded=Awaited<ReturnType<typeof readFusionResult>>;
export type SourceFusionDependencies={authority:typeof fusionAuthorityBatch;read:typeof readFusionResult};
const defaults:SourceFusionDependencies={authority:fusionAuthorityBatch,read:readFusionResult};
const fail=()=>{throw new AppError(422,'SOURCE_FUSION_SELECTION','The requested accepted evidence selection is unavailable.');};
const namespace=(selection:SourceFusionSelection)=>`source:${selection.pin.caseId}/${selection.pin.sourceId}@${selection.pin.sourceRevision}`;
const declaration=(body:Record<string,any>,key:string)=>Object.hasOwn(body,key)
  ?{state:'declared' as const,value:body[key]}:{state:'absent' as const};
function pointer(root:unknown,path:string):any{
  if(!path.startsWith('/'))return fail();
  let value:any=root;
  for(const encoded of path.slice(1).split('/')){
    if(/~(?![01])/u.test(encoded))return fail();
    const key=encoded.replaceAll('~1','/').replaceAll('~0','~');
    if(!value||typeof value!=='object'||!Object.hasOwn(value,key))return fail();
    value=value[key];
  }
  return value;
}
const nativeSchema=z.object({schemaVersion:z.literal('source-native-cityjson/1'),sourceSha256:z.string(),sourceBytes:z.number(),
  sourceDocument:z.unknown(),frame:SourceFusionLiteralObjectSchema,transformPointer:z.string().nullable(),
  objects:z.array(z.object({id:z.string(),pointer:z.string(),type:z.string(),geometryState:z.enum(['present','absent']),geometries:z.array(z.object({
    pointer:z.string(),type:z.string(),status:z.string()})).max(1000)})).max(1000),
  hierarchyIssues:z.array(SourceFusionLiteralJsonSchema).max(1000)});

/** Pure projection of already read/verified selections; never a matching result. */
export function fusionSourceProjection(selection:SourceFusionSelection,loaded:Loaded):SourceFusionContext['sources'][number]{
  if(fingerprint(loaded.result.input)!==selection.pin.inputSha256||loaded.result.input.readerSha256!==selection.pin.readerSha256)
    return fail();
  const ns=namespace(selection),base={pin:selection.pin,namespace:ns,sourceSetRole:'operator_selected_fragment' as const};
  if(selection.kind==='document'&&loaded.kind==='document'){
    const native=loaded.result.native;
    const byId=new Map(native.parts.map(part=>[part.id,part]));
    if(byId.size!==native.parts.length)return fail();
    const parts=[...selection.partIds].sort().map(id=>{
      const part=byId.get(id);if(!part)return fail();
      return {key:`${ns}/part/${part.id}`,part,textState:/\[redacted/i.test(part.text)
        ?'redacted_native_derivative' as const:'native_derivative' as const};
    });
    return {kind:'document',...base,format:native.format,nativeStatus:native.status,code:native.code,warnings:native.warnings,
      capability:native.status!=='extracted'?'native_incomplete':parts.length?'selected_native_text':'selection_required',parts,
      coverage:{selectedParts:parts.length,availableNativeParts:native.parts.length,scope:'explicit_selection_only',assistedExtraction:'outside_profile'}};
  }
  if(selection.kind==='cityjson'&&loaded.kind==='cityjson'){
    const native=nativeSchema.parse(loaded.native);
    if(native.sourceSha256!==selection.pin.sourceSha256||native.sourceBytes!==loaded.result.input.sourceBytes)return fail();
    const byId=new Map(native.objects.map(object=>[object.id,object]));
    if(byId.size!==native.objects.length)return fail();
    const objects=[...selection.objectIds].sort().map(id=>{
      const object=byId.get(id);if(!object)return fail();
      const body=pointer(native.sourceDocument,object.pointer);
      if(!body||typeof body!=='object'||Array.isArray(body))return fail();
      if(body.type!==object.type)return fail();
      return {key:`${ns}/object/${JSON.stringify(id)}`,id,pointer:object.pointer,type:object.type,geometryState:object.geometryState,
        attributes:declaration(body,'attributes'),parents:declaration(body,'parents'),children:declaration(body,'children'),
        geometries:object.geometries.map(geometry=>{
          const body=pointer(native.sourceDocument,geometry.pointer);
          if(!body||typeof body!=='object'||Array.isArray(body)||body.type!==geometry.type)return fail();
          return {pointer:geometry.pointer,type:geometry.type,status:geometry.status,lod:declaration(body,'lod')};
        })};
    });
    const metadataPointer=native.frame.metadataPointer;
    if(metadataPointer!==null&&typeof metadataPointer!=='string')return fail();
    return {kind:'cityjson',...base,nativeStatus:loaded.result.summary.status,artifactSha256:loaded.result.artifact.sha256,
      reference:{frame:native.frame,metadata:metadataPointer===null?{state:'absent'}:
        {state:'declared',value:pointer(native.sourceDocument,metadataPointer)},transform:native.transformPointer===null?{state:'absent'}:
        {state:'declared',value:pointer(native.sourceDocument,native.transformPointer)}},objects,
      coverage:{selectedObjects:objects.length,availableNativeObjects:native.objects.length,scope:'explicit_selection_only',
        geometryArrays:'omitted; exact artifact references retained'},hierarchyIssues:native.hierarchyIssues};
  }
  return fail();
}

export function fusionContextProjection(sources:SourceFusionContext['sources']):SourceFusionContext{
  const body={version:SOURCE_FUSION_VERSION,sources,
    association:{state:'not_assessed' as const,membership:'operator_selection' as const,
      reason:'source_set_membership_does_not_establish_relationships' as const,canonicalTargets:[],
      crossSourceFrameAlignment:'not_assessed' as const,conflicts:'literal_values_retained_per_source; not_reconciled' as const},
    capabilities:{contextAssembly:'available' as const,matching:'not_assessed' as const,recordedBuildingRequired:false as const,
      geometryQualification:'not_assessed' as const,rights:'not_assessed' as const}};
  const validated=SourceFusionContextSchema.parse({...body,contextSha256:'0'.repeat(64)});
  // Validate JSON before serialization; malformed in-process declarations must
  // not execute accessors/toJSON. The actual response includes its hash field.
  if(Buffer.byteLength(JSON.stringify(validated))>SOURCE_FUSION_LIMITS.responseBytes-8192)
    throw new AppError(413,'SOURCE_FUSION_RESPONSE_LIMIT','Select fewer or smaller evidence fragments.');
  const {contextSha256:_,...returnedBody}=validated;
  // Hash exactly what will be returned, after literal-preserving validation.
  validated.contextSha256=fingerprint(returnedBody);
  return validated;
}

export async function assembleSourceFusion(ctx:RequestContext,raw:unknown,deps:SourceFusionDependencies=defaults){
  const request=SourceFusionRequestSchema.parse(raw);assertLocalUsp(ctx);
  if(Buffer.byteLength(JSON.stringify(request))>SOURCE_FUSION_LIMITS.requestBytes)
    throw new AppError(413,'SOURCE_FUSION_REQUEST_LIMIT','Select a smaller explicit source set.');
  const selections=[...request.sources].sort((a,b)=>a.pin.caseId.localeCompare(b.pin.caseId)||
    a.pin.sourceId.localeCompare(b.pin.sourceId)||a.pin.jobId.localeCompare(b.pin.jobId));
  const controller=new AbortController(),deadlineAt=Date.now()+SOURCE_FUSION_LIMITS.deadlineMs;
  const timer=setTimeout(()=>controller.abort(),SOURCE_FUSION_LIMITS.deadlineMs);timer.unref();
  const budget:FusionBudget={deadlineAt,signal:controller.signal,reservedBytes:0};
  try{
    const authorities=await deps.authority(ctx,selections,budget);
    const sources:SourceFusionContext['sources']=[];
    for(const [index,selection] of selections.entries()){
      fusionLive(budget);const loaded=await deps.read(selection,authorities[index],budget);
      fusionLive(budget);sources.push(fusionSourceProjection(selection,loaded));
    }
    const response=fusionContextProjection(sources);fusionLive(budget);
    // No object I/O occurs inside this final aggregate transaction.
    await deps.authority(ctx,selections,budget,authorities);
    fusionLive(budget);assertLocalUsp(ctx);return response;
  }catch(error){
    fusionLive(budget);
    if(error instanceof AppError&&[403,404,409,422].includes(error.status))
      throw new AppError(error.status,error.status===409?'SOURCE_FUSION_STALE':'SOURCE_FUSION_UNAVAILABLE',
        'The requested accepted evidence context is unavailable.');
    throw error;
  }finally{clearTimeout(timer);controller.abort();}
}
export class SourceFusionService{
  assemble(ctx:RequestContext,input:unknown){return assembleSourceFusion(ctx,input);}
}

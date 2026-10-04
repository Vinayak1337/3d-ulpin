import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,stat,rm,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {OBJ_LIMITS,ObjSummarySchema,ObjSupervisionSchema,ObjHostSupervisionSchema,type ObjInput} from '../../../../../contracts/src/usp/obj-ingestion';
import {sha256} from '../../../infrastructure/storage';
import {AppError} from '../../../infrastructure/errors';
import {assertObjTools,type ObjConfig} from './obj-config';

// The accepted reader inventories unsupported arity too. The whole artifact's
// 16 MiB cap bounds component arrays without a second, narrower arity profile.
const count=z.number().int().nonnegative(),coordinate=z.object({index:count,values:z.array(z.number()).min(1),status:z.enum(['source_values','unsupported_profile']),reason:z.string().nullable()});
const native=z.object({schemaVersion:z.literal('obj-source-context/1'),profile:z.literal('utf8-literal-polygons/1'),
  status:ObjSummarySchema.shape.status,sourceSha256:ObjSummarySchema.shape.sourceSha256,sourceBytes:ObjSummarySchema.shape.sourceBytes,
  geometryProjectionStatus:ObjSummarySchema.shape.geometryProjectionStatus,representation:z.literal('context_mesh'),
  vertices:z.array(coordinate.extend({cartesianProjectionEligible:z.boolean()})).max(100000),textures:z.array(coordinate).max(100000),normals:z.array(coordinate).max(100000),
  faces:z.array(z.object({index:count,references:z.array(z.unknown()).min(3).max(500000),projectionEligible:z.boolean()})).max(100000),
  declarations:z.array(z.unknown()).max(250000),unsupported:z.array(z.unknown()).max(250000),
  resources:z.array(z.object({state:z.literal('needs_input')})).max(250000),
  counts:z.object({vertices:count.max(100000),textures:count.max(100000),normals:count.max(100000),faces:count.max(100000),
    faceReferences:count.max(500000),eligiblePolygons:count.max(100000),declarations:count.max(250000),unsupported:count.max(250000)}),
  qualification:z.object({axes:z.literal('unknown'),units:z.literal('unknown'),crs:z.literal('unknown'),heightReference:z.literal('unknown'),globalPlacement:z.literal('unknown'),
    topology:z.literal('not_assessed'),analyticalGeometry:z.literal(false),measurements:z.literal(false),propertyIdentity:z.literal(false),registryAdmission:z.literal(false),learningTruth:z.literal(false),
    polygonOrder:z.literal('source_order; no triangulation or winding conversion'),indices:z.literal('positive_absolute_final_file_population; negative_relative_source_order_population'),
    missingComponents:z.literal('absent; no specification defaults inserted'),materialsAndTextures:z.literal('declarations_only; companions_not_resolved')})});
/** Derive bounded status from the unchanged native artifact; retain literal records separately. */
export function objSummary(bytes:Buffer,input:ObjInput){
  if(bytes.length>OBJ_LIMITS.artifactBytes)throw new AppError(413,'OBJ_OUTPUT_LIMIT','OBJ native output exceeds its profile.');
  const value=native.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))),c=value.counts;
  const coordinates=[...value.vertices,...value.textures,...value.normals],eligible=value.faces.filter(f=>f.projectionEligible).length,
    partial=Boolean(value.unsupported.length||value.resources.length||eligible!==value.faces.length||!value.faces.length||coordinates.some(r=>r.status!=='source_values'||r.reason));
  if(value.sourceSha256!==input.sourceSha256||value.sourceBytes!==input.sourceBytes||c.vertices!==value.vertices.length||c.textures!==value.textures.length||c.normals!==value.normals.length
    ||coordinates.length>100000||coordinates.length+c.faces+c.declarations+c.unsupported>250000||c.faces!==value.faces.length||c.declarations!==value.declarations.length||c.unsupported!==value.unsupported.length
    ||c.faceReferences!==value.faces.reduce((n,f)=>n+f.references.length,0)||c.eligiblePolygons!==eligible
    ||[value.vertices,value.textures,value.normals,value.faces].some(records=>records.some((r,i)=>r.index!==i))
    ||value.status!==(partial?'inspected_partial':'inspected_local')||value.geometryProjectionStatus!==(eligible&&eligible===c.faces?'available':eligible?'partial':'unavailable'))
    throw new AppError(422,'OBJ_ARTIFACT_INTEGRITY','Native result differs from the enrolled source or complete inventory.');
  return ObjSummarySchema.parse({schemaVersion:value.schemaVersion,sourceSha256:value.sourceSha256,sourceBytes:value.sourceBytes,
    status:value.status,geometryProjectionStatus:value.geometryProjectionStatus,representation:value.representation,
    vertexCount:c.vertices,textureCount:c.textures,normalCount:c.normals,polygonCount:c.faces,faceReferenceCount:c.faceReferences,eligiblePolygonCount:eligible,
    declarationCount:c.declarations,unsupportedStatementCount:c.unsupported,missingCompanionDeclarationCount:value.resources.length,
    axes:'unknown',units:'unknown',crs:'unknown',heightReference:'unknown',globalPlacement:'unknown',accuracy:'not_assessed',validity:'not_assessed',canonicalIdentity:'not_assessed',
    analyticEligible:false,registryAdmission:false,measurements:false,learningLabels:false,rights:'not_assessed'});
}
const controlledCode=z.string().regex(/^OBJ_[A-Z_]{1,60}$/);
function reapObj(config:ObjConfig,pid:number,scratch:string){
  try{assertObjTools(config.pins,Date.now()+5000);}catch{
    return Promise.reject(new AppError(503,'OBJ_REAP_UNAVAILABLE','Reaper imports are not verified; private scratch remains retained.'));
  }
  return new Promise<void>((resolve,reject)=>{
    const reaper=spawn(config.python,['-I','-S','-B',config.supervisor,'--reap-pid',String(pid)],{shell:false,windowsHide:true,cwd:scratch,
      env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',TEMP:scratch,TMP:scratch},stdio:['ignore','pipe','ignore']});
    let reply='';const timer=setTimeout(()=>reaper.kill(),5000);
    reaper.stdout.on('data',(v:Buffer)=>{reply+=v.toString('utf8');if(reply.length>1024)reaper.kill();});
    reaper.on('error',()=>{});
    reaper.on('close',code=>{clearTimeout(timer);if(code===0&&reply.trim()==='{"state":"available"}')resolve();
      else reject(new AppError(503,'OBJ_REAP_UNAVAILABLE','Owned parser termination was not confirmed; private scratch remains retained.'));});
  });
}
export function superviseObj(config:ObjConfig,requestPath:string,scratch:string,signal:AbortSignal){
  signal.throwIfAborted();
  assertObjTools(config.pins);
  return new Promise<{supervision:z.infer<typeof ObjSupervisionSchema>;hostSupervision:z.infer<typeof ObjHostSupervisionSchema>}>((resolve,reject)=>{
    const child=spawn(config.python,['-I','-S','-B',config.supervisor,'--request',requestPath],{shell:false,windowsHide:true,cwd:scratch,
      env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',TEMP:scratch,TMP:scratch},stdio:['ignore','pipe','pipe']});
    let stdout='',size=0,failure:unknown;
    const abort=()=>{failure=signal.reason??new AppError(409,'OBJ_CANCELLED','Obj reading was cancelled.');child.kill();};
    const timer=setTimeout(()=>{failure=new AppError(504,'OBJ_TIMEOUT','Obj wrapper exceeded its deadline.');child.kill();},75_000);
    signal.addEventListener('abort',abort,{once:true});
    const collect=(v:Buffer,output:boolean)=>{size+=v.length;if(size>16384){failure=new AppError(413,'OBJ_REPLY_LIMIT','Obj supervisor reply exceeded its profile.');child.kill();}
      else if(output)stdout+=v.toString('utf8');};
    child.stdout.on('data',(v:Buffer)=>collect(v,true));child.stderr.on('data',(v:Buffer)=>collect(v,false));
    child.on('error',()=>{failure=new AppError(503,'OBJ_UNAVAILABLE','Pinned Obj supervisor could not start.');});
    child.on('close',async code=>{
      clearTimeout(timer);signal.removeEventListener('abort',abort);
      if(failure){try{if(child.pid)await reapObj(config,child.pid,scratch);}catch(error){reject(error);return;}reject(failure);return;}
      try{const reply=z.object({state:z.literal('available').optional(),code:controlledCode.optional(),supervision:ObjSupervisionSchema.optional(),hostSupervision:ObjHostSupervisionSchema.optional()}).parse(JSON.parse(stdout));
        if(reply.code)throw new AppError(['OBJ_UNAVAILABLE','OBJ_BUSY','OBJ_TOOL_CHANGED','OBJ_UNSUPPORTED_PLATFORM'].includes(reply.code)?503:422,
          reply.code,'Obj reading did not complete; unchanged original is retained for explicit retry.');
        if(code!==0||reply.state!=='available'||!reply.supervision||!reply.hostSupervision)throw new Error();resolve({supervision:reply.supervision,hostSupervision:reply.hostSupervision});
      }catch(error){reject(error instanceof AppError?error:new AppError(422,'OBJ_PROCESSING_FAILED','Obj supervisor did not return a controlled result.'));}
    });
    if(signal.aborted)abort();
  });
}
export async function processObj(input:ObjInput,source:Buffer,signal:AbortSignal,deadlineAt:number){
  signal.throwIfAborted();if(source.length!==input.sourceBytes||sha256(source)!==input.sourceSha256)
    throw new AppError(422,'OBJ_SOURCE_INTEGRITY','Retained Obj source differs from its byte receipt.');
  const config=assertObjTools(input.tools,deadlineAt),scratch=await mkdtemp(join(config.scratchRoot,'obj-native-'));
  let cleanup=true;
  try{
    const sourcePath=join(scratch,'original.bin'),outputDirectory=join(scratch,'output'),output=join(outputDirectory,'obj.json'),requestPath=join(scratch,'request.json');
    await writeFile(sourcePath,source,{flag:'wx'});
    await writeFile(requestPath,JSON.stringify({source:sourcePath,sourceSha256:input.sourceSha256,outputDirectory,profilePath:config.profilePath,tools:input.tools}),{flag:'wx'});
    const observation=await superviseObj(config,requestPath,scratch,signal);signal.throwIfAborted();
    const info=await stat(output);if(!info.isFile()||info.size>OBJ_LIMITS.artifactBytes)throw new AppError(413,'OBJ_OUTPUT_LIMIT','Local Obj output exceeds its profile.');
    const bytes=await readFile(output,{signal}),summary=objSummary(bytes,input);
    if(sha256(await readFile(sourcePath,{signal}))!==input.sourceSha256)throw new AppError(422,'OBJ_SOURCE_INTEGRITY','Local Obj original changed.');
    assertObjTools(input.tools,deadlineAt);signal.throwIfAborted();return {bytes,summary,...observation,hash:sha256(bytes)};
  }catch(error){if(error instanceof AppError&&error.code==='OBJ_REAP_UNAVAILABLE')cleanup=false;throw error;}
  finally{
    const child=relative(config.scratchRoot,await realpath(scratch));if(!child||child.startsWith('..')||isAbsolute(child))throw new AppError(503,'OBJ_CLEANUP_SCOPE','Owned Obj temporary path changed.');
    if(cleanup)await rm(scratch,{recursive:true,force:true});
  }
}

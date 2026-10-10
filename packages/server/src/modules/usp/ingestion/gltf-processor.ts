import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,stat,rm,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {GLTF_LIMITS,GltfSummarySchema,GltfSupervisionSchema,type GltfInput} from '../../../../../contracts/src/usp/gltf-ingestion';
import {sha256} from '../../../infrastructure/storage';
import {AppError} from '../../../infrastructure/errors';
import {assertGltfTools,type GltfConfig} from './gltf-config';

const count=z.number().int().nonnegative(),declaredResource=z.object({dependency:z.object({status:z.string(),fetched:z.literal(false).optional()}).optional()});
const native=z.object({schemaVersion:z.literal('gltf-local-inspection/1'),status:GltfSummarySchema.shape.status,
  sourceSha256:GltfSummarySchema.shape.sourceSha256,sourceBytes:GltfSummarySchema.shape.sourceBytes,
  geometryProjectionStatus:GltfSummarySchema.shape.geometryProjectionStatus,representation:z.literal('context_mesh'),
  selectedScene:z.object({index:GltfSummarySchema.shape.selectedSceneIndex,origin:GltfSummarySchema.shape.selectedSceneOrigin}),
  nodes:z.array(z.unknown()).max(10000),buffers:z.array(z.object({status:z.string(),fetched:z.literal(false)})).max(10000),
  primitives:z.array(z.object({status:z.string(),projection:z.object({
    POSITION:z.object({values:z.array(z.array(z.number()).length(3)).max(100000).optional()}),
    indices:z.object({values:z.array(count).max(300000).nullable().optional()})}).nullable()})).max(10000),
  resources:z.object({images:z.array(declaredResource).max(10000)}),
  counts:z.object({nodes:count.max(10000),primitives:count.max(10000),projectedPositions:count.max(100000),projectedIndices:count.max(300000)}),
  qualification:z.object({profile:z.literal('local_source_inspection_only'),globalPlacement:z.literal('unknown'),
    analyticalGeometry:z.literal(false),measurements:z.literal(false),propertyIdentity:z.literal(false),registryAdmission:z.literal(false),rendering:z.literal(false),
    coordinates:z.literal('source_accessor_values; node transforms are declarations only')})});
/** Derive small status from the actual unaltered native projection, not source labels. */
export function gltfSummary(bytes:Buffer,input:GltfInput){
  if(bytes.length>GLTF_LIMITS.artifactBytes)throw new AppError(413,'GLTF_OUTPUT_LIMIT','Gltf native output exceeds its profile.');
  const value=native.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))),c=value.counts;
  if(value.sourceSha256!==input.sourceSha256||value.sourceBytes!==input.sourceBytes||c.nodes!==value.nodes.length||c.primitives!==value.primitives.length
    ||c.projectedPositions!==value.primitives.reduce((n,p)=>n+(p.projection?.POSITION.values?.length??0),0)
    ||c.projectedIndices!==value.primitives.reduce((n,p)=>n+(p.projection?.indices.values?.length??0),0)
    ||(input.sceneIndex!==null&&(value.selectedScene.origin!=='caller'||value.selectedScene.index!==input.sceneIndex)))
    throw new AppError(422,'GLTF_ARTIFACT_INTEGRITY','Native result differs from the enrolled source or inventory.');
  return GltfSummarySchema.parse({schemaVersion:value.schemaVersion,sourceSha256:value.sourceSha256,sourceBytes:value.sourceBytes,
    status:value.status,geometryProjectionStatus:value.geometryProjectionStatus,representation:value.representation,
    selectedSceneIndex:value.selectedScene.index,selectedSceneOrigin:value.selectedScene.origin,
    nodeCount:c.nodes,primitiveCount:c.primitives,projectedPositions:c.projectedPositions,projectedIndices:c.projectedIndices,
    missingCompanionCount:value.buffers.filter(b=>b.status==='needs_input').length+value.resources.images.filter(i=>i.dependency?.status==='needs_input').length,
    unsupportedPrimitiveCount:value.primitives.filter(p=>p.status==='unsupported').length,
    globalPlacement:'unknown',accuracy:'not_assessed',validity:'not_assessed',canonicalIdentity:'not_assessed',
    analyticEligible:false,registryAdmission:false,measurements:false,learningLabels:false,rights:'not_assessed'});
}
const controlledCode=z.string().regex(/^GLTF_[A-Z_]{1,60}$/);
function reapGltf(config:GltfConfig,pid:number,scratch:string){
  try{assertGltfTools(config.pins,Date.now()+5000);}catch{
    return Promise.reject(new AppError(503,'GLTF_REAP_UNAVAILABLE','Reaper imports are not verified; private scratch remains retained.'));
  }
  return new Promise<void>((resolve,reject)=>{
    const reaper=spawn(config.python,['-I','-S','-B',config.supervisor,'--reap-pid',String(pid)],{shell:false,windowsHide:true,cwd:scratch,
      env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',TEMP:scratch,TMP:scratch},stdio:['ignore','pipe','ignore']});
    let reply='';const timer=setTimeout(()=>reaper.kill(),5000);
    reaper.stdout.on('data',(v:Buffer)=>{reply+=v.toString('utf8');if(reply.length>1024)reaper.kill();});
    reaper.on('error',()=>{});
    reaper.on('close',code=>{clearTimeout(timer);if(code===0&&reply.trim()==='{"state":"available"}')resolve();
      else reject(new AppError(503,'GLTF_REAP_UNAVAILABLE','Owned parser termination was not confirmed; private scratch remains retained.'));});
  });
}
export function superviseGltf(config:GltfConfig,requestPath:string,scratch:string,signal:AbortSignal){
  signal.throwIfAborted();
  assertGltfTools(config.pins);
  return new Promise<z.infer<typeof GltfSupervisionSchema>>((resolve,reject)=>{
    const child=spawn(config.python,['-I','-S','-B',config.supervisor,'--request',requestPath],{shell:false,windowsHide:true,cwd:scratch,
      env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',TEMP:scratch,TMP:scratch},stdio:['ignore','pipe','pipe']});
    let stdout='',size=0,failure:unknown;
    const abort=()=>{failure=signal.reason??new AppError(409,'GLTF_CANCELLED','Gltf reading was cancelled.');child.kill();};
    const timer=setTimeout(()=>{failure=new AppError(504,'GLTF_TIMEOUT','Gltf wrapper exceeded its deadline.');child.kill();},75_000);
    signal.addEventListener('abort',abort,{once:true});
    const collect=(v:Buffer,output:boolean)=>{size+=v.length;if(size>16384){failure=new AppError(413,'GLTF_REPLY_LIMIT','Gltf supervisor reply exceeded its profile.');child.kill();}
      else if(output)stdout+=v.toString('utf8');};
    child.stdout.on('data',(v:Buffer)=>collect(v,true));child.stderr.on('data',(v:Buffer)=>collect(v,false));
    child.on('error',()=>{failure=new AppError(503,'GLTF_UNAVAILABLE','Pinned Gltf supervisor could not start.');});
    child.on('close',async code=>{
      clearTimeout(timer);signal.removeEventListener('abort',abort);
      if(failure){try{if(child.pid)await reapGltf(config,child.pid,scratch);}catch(error){reject(error);return;}reject(failure);return;}
      try{const reply=z.object({state:z.literal('available').optional(),code:controlledCode.optional(),supervision:GltfSupervisionSchema.optional()}).parse(JSON.parse(stdout));
        if(reply.code)throw new AppError(['GLTF_UNAVAILABLE','GLTF_BUSY','GLTF_TOOL_CHANGED','GLTF_UNSUPPORTED_PLATFORM'].includes(reply.code)?503:422,
          reply.code,'Gltf reading did not complete; unchanged original is retained for explicit retry.');
        if(code!==0||reply.state!=='available'||!reply.supervision)throw new Error();resolve(reply.supervision);
      }catch(error){reject(error instanceof AppError?error:new AppError(422,'GLTF_PROCESSING_FAILED','Gltf supervisor did not return a controlled result.'));}
    });
    if(signal.aborted)abort();
  });
}
export async function processGltf(input:GltfInput,source:Buffer,signal:AbortSignal,deadlineAt:number){
  signal.throwIfAborted();if(source.length!==input.sourceBytes||sha256(source)!==input.sourceSha256)
    throw new AppError(422,'GLTF_SOURCE_INTEGRITY','Retained Gltf source differs from its byte receipt.');
  const config=assertGltfTools(input.tools,deadlineAt),scratch=await mkdtemp(join(config.scratchRoot,'gltf-native-'));
  let cleanup=true;
  try{
    const sourcePath=join(scratch,'original.bin'),outputDirectory=join(scratch,'output'),output=join(outputDirectory,'gltf.json'),requestPath=join(scratch,'request.json');
    await writeFile(sourcePath,source,{flag:'wx'});
    await writeFile(requestPath,JSON.stringify({source:sourcePath,sourceSha256:input.sourceSha256,outputDirectory,sceneIndex:input.sceneIndex,profilePath:config.profilePath,tools:input.tools}),{flag:'wx'});
    const supervision=await superviseGltf(config,requestPath,scratch,signal);signal.throwIfAborted();
    const info=await stat(output);if(!info.isFile()||info.size>GLTF_LIMITS.artifactBytes)throw new AppError(413,'GLTF_OUTPUT_LIMIT','Local Gltf output exceeds its profile.');
    const bytes=await readFile(output,{signal}),summary=gltfSummary(bytes,input);
    if(sha256(await readFile(sourcePath,{signal}))!==input.sourceSha256)throw new AppError(422,'GLTF_SOURCE_INTEGRITY','Local Gltf original changed.');
    assertGltfTools(input.tools,deadlineAt);signal.throwIfAborted();return {bytes,summary,supervision,hash:sha256(bytes)};
  }catch(error){if(error instanceof AppError&&error.code==='GLTF_REAP_UNAVAILABLE')cleanup=false;throw error;}
  finally{
    const child=relative(config.scratchRoot,await realpath(scratch));if(!child||child.startsWith('..')||isAbsolute(child))throw new AppError(503,'GLTF_CLEANUP_SCOPE','Owned Gltf temporary path changed.');
    if(cleanup)await rm(scratch,{recursive:true,force:true});
  }
}

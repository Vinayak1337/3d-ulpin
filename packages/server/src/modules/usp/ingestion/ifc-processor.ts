import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,stat,rm,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {IFC_LIMITS,IFCSummarySchema,type IFCInput} from '@ulpin/contracts/usp';
import {sha256} from '../../../infrastructure/storage';
import {AppError} from '../../../infrastructure/errors';
import {assertIFCTools,type IFCConfig} from './ifc-config';

const native=z.object({schemaVersion:z.literal('ulpin-native-ifc/1'),status:z.literal('available'),scope:z.literal('source_native_metadata'),
  source:z.object({sha256:z.string(),bytes:z.number(),schema:z.enum(['IFC2X3','IFC4'])}),
  parser:z.object({name:z.literal('IfcOpenShell'),version:z.literal('0.8.5')}),
  counts:z.object({sourceEntities:z.number().int().nonnegative().max(100000),projectedRecords:z.number().int().nonnegative().max(10000)}),
  records:z.array(z.object({stepId:z.number().int().positive(),entityType:z.string()})).max(10000),
  georeference:z.object({state:z.enum(['supplied_unqualified','missing_or_unqualified']),inspectionFrame:z.literal('source_local'),globalTransformApplied:z.literal(false)}),
  semantics:z.object({storeysAreLegalUnits:z.literal(false),unitConversionApplied:z.literal(false),rights:z.literal('not_assessed')})});
export function ifcSummary(bytes:Buffer,input:IFCInput){
  if(bytes.length>IFC_LIMITS.artifactBytes)throw new AppError(413,'IFC_OUTPUT_LIMIT','IFC native output exceeds its profile.');
  const value=native.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  if(value.source.sha256!==input.sourceSha256||value.source.bytes!==input.sourceBytes||value.records.length!==value.counts.projectedRecords
    ||new Set(value.records.map(v=>v.stepId)).size!==value.records.length)
    throw new AppError(422,'IFC_ARTIFACT_INTEGRITY','Native result differs from the enrolled source.');
  const count=(type:string)=>value.records.filter(v=>v.entityType===type).length;
  return IFCSummarySchema.parse({schemaVersion:value.schemaVersion,sourceSha256:value.source.sha256,sourceBytes:value.source.bytes,
    schema:value.source.schema,entityCount:value.counts.sourceEntities,recordCount:value.counts.projectedRecords,
    buildingCount:count('IfcBuilding'),storeyCount:count('IfcBuildingStorey'),spaceCount:count('IfcSpace'),
    georeferenceState:value.georeference.state,inspectionFrame:'source_local',metadataOnly:true,geometry:'unsupported',
    globalPlacement:'not_qualified',unitConversionApplied:false,storeysAreLegalUnits:false,rights:'not_assessed'});
}
const controlledCode=z.string().regex(/^IFC_[A-Z_]{1,60}$/);
function reapIFC(config:IFCConfig,pid:number,scratch:string){
  try{assertIFCTools(config.pins,Date.now()+5000);}catch{
    return Promise.reject(new AppError(503,'IFC_REAP_UNAVAILABLE','Reaper imports are not verified; private scratch remains retained.'));
  }
  return new Promise<void>((resolve,reject)=>{
    const reaper=spawn(config.python,['-I','-S','-B',config.supervisor,'--reap-pid',String(pid)],{shell:false,windowsHide:true,cwd:scratch,
      env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',TEMP:scratch,TMP:scratch},stdio:['ignore','pipe','ignore']});
    let reply='';const timer=setTimeout(()=>reaper.kill(),5000);
    reaper.stdout.on('data',(v:Buffer)=>{reply+=v.toString('utf8');if(reply.length>1024)reaper.kill();});
    reaper.on('error',()=>{});
    reaper.on('close',code=>{clearTimeout(timer);if(code===0&&reply.trim()==='{"state":"available"}')resolve();
      else reject(new AppError(503,'IFC_REAP_UNAVAILABLE','Owned parser termination was not confirmed; private scratch remains retained.'));});
  });
}
export function superviseIFC(config:IFCConfig,requestPath:string,scratch:string,signal:AbortSignal){
  signal.throwIfAborted();
  assertIFCTools(config.pins);
  return new Promise<void>((resolve,reject)=>{
    const child=spawn(config.python,['-I','-S','-B',config.supervisor,'--request',requestPath],{shell:false,windowsHide:true,cwd:scratch,
      env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',TEMP:scratch,TMP:scratch},stdio:['ignore','pipe','pipe']});
    let stdout='',size=0,failure:unknown;
    const abort=()=>{failure=signal.reason??new AppError(409,'IFC_CANCELLED','IFC reading was cancelled.');child.kill();};
    const timer=setTimeout(()=>{failure=new AppError(504,'IFC_TIMEOUT','IFC wrapper exceeded its deadline.');child.kill();},90_000);
    signal.addEventListener('abort',abort,{once:true});
    const collect=(v:Buffer,output:boolean)=>{size+=v.length;if(size>16384){failure=new AppError(413,'IFC_REPLY_LIMIT','IFC supervisor reply exceeded its profile.');child.kill();}
      else if(output)stdout+=v.toString('utf8');};
    child.stdout.on('data',(v:Buffer)=>collect(v,true));child.stderr.on('data',(v:Buffer)=>collect(v,false));
    child.on('error',()=>{failure=new AppError(503,'IFC_UNAVAILABLE','Pinned IFC supervisor could not start.');});
    child.on('close',async code=>{
      clearTimeout(timer);signal.removeEventListener('abort',abort);
      if(failure){try{if(child.pid)await reapIFC(config,child.pid,scratch);}catch(error){reject(error);return;}reject(failure);return;}
      try{const reply=z.object({state:z.literal('available').optional(),code:controlledCode.optional()}).parse(JSON.parse(stdout));
        if(reply.code)throw new AppError(['IFC_UNAVAILABLE','IFC_BUSY','IFC_TOOL_CHANGED','IFC_UNSUPPORTED_PLATFORM'].includes(reply.code)?503:422,
          reply.code,'IFC reading did not complete; unchanged original is retained for explicit retry.');
        if(code!==0||reply.state!=='available')throw new Error();resolve();
      }catch(error){reject(error instanceof AppError?error:new AppError(422,'IFC_PROCESSING_FAILED','IFC supervisor did not return a controlled result.'));}
    });
    if(signal.aborted)abort();
  });
}
export async function processIFC(input:IFCInput,source:Buffer,signal:AbortSignal,deadlineAt:number){
  signal.throwIfAborted();if(source.length!==input.sourceBytes||sha256(source)!==input.sourceSha256)
    throw new AppError(422,'IFC_SOURCE_INTEGRITY','Retained IFC source differs from its byte receipt.');
  const config=assertIFCTools(input.tools,deadlineAt),scratch=await mkdtemp(join(config.scratchRoot,'ifc-native-'));
  let cleanup=true;
  try{
    const sourcePath=join(scratch,'original.ifc'),output=join(scratch,'native.json'),requestPath=join(scratch,'request.json');
    await writeFile(sourcePath,source,{flag:'wx'});
    await writeFile(requestPath,JSON.stringify({source:sourcePath,sourceSha256:input.sourceSha256,output,profilePath:config.profilePath,tools:input.tools}),{flag:'wx'});
    await superviseIFC(config,requestPath,scratch,signal);signal.throwIfAborted();
    const info=await stat(output);if(!info.isFile()||info.size>IFC_LIMITS.artifactBytes)throw new AppError(413,'IFC_OUTPUT_LIMIT','Local IFC output exceeds its profile.');
    const bytes=await readFile(output,{signal}),summary=ifcSummary(bytes,input);
    if(sha256(await readFile(sourcePath,{signal}))!==input.sourceSha256)throw new AppError(422,'IFC_SOURCE_INTEGRITY','Local IFC original changed.');
    assertIFCTools(input.tools,deadlineAt);signal.throwIfAborted();return {bytes,summary,hash:sha256(bytes)};
  }catch(error){if(error instanceof AppError&&error.code==='IFC_REAP_UNAVAILABLE')cleanup=false;throw error;}
  finally{
    const child=relative(config.scratchRoot,await realpath(scratch));if(!child||child.startsWith('..')||isAbsolute(child))throw new AppError(503,'IFC_CLEANUP_SCOPE','Owned IFC temporary path changed.');
    if(cleanup)await rm(scratch,{recursive:true,force:true});
  }
}

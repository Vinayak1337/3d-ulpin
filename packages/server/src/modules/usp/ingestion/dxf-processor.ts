import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,stat,rm,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {DXF_LIMITS,DXFSummarySchema,type DXFInput} from '@ulpin/contracts/usp';
import {sha256} from '../../../infrastructure/storage';
import {AppError} from '../../../infrastructure/errors';
import {assertDXFTools,type DXFConfig} from './dxf-config';

const count=z.number().int().nonnegative();
const native=z.object({schemaVersion:z.literal('dxf-native-inspection/1'),status:z.literal('available'),
  sourceSha256:z.string(),sourceBytes:z.number(),dxfVersion:DXFSummarySchema.shape.dxfVersion,
  parser:z.object({name:z.literal('ezdxf'),version:z.literal('1.4.3'),recovery:z.literal(false)}),
  recordCount:count.max(100000),projectedEntityCountIncludingChildren:count.max(10000),pointCount:count.max(100000),
  entities:z.array(z.object({type:z.string()})).max(10000),unsupportedFindings:z.array(z.unknown()).max(10000),
  units:z.object({...DXFSummarySchema.shape.units.shape,conversion:z.null()}),
  qualification:z.object({scope:z.literal('source_local_inspection'),globalPlacement:z.literal('not_assessed'),
    geometryValidity:z.literal('not_assessed'),analyticEligible:z.literal(false),operationalRecords:z.literal(false),trainingLabels:z.literal(false)})});
export function dxfSummary(bytes:Buffer,input:DXFInput){
  if(bytes.length>DXF_LIMITS.artifactBytes)throw new AppError(413,'DXF_OUTPUT_LIMIT','DXF native output exceeds its profile.');
  const value=native.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  if(value.sourceSha256!==input.sourceSha256||value.sourceBytes!==input.sourceBytes||
    value.entities.length>value.projectedEntityCountIncludingChildren||value.projectedEntityCountIncludingChildren>value.recordCount)
    throw new AppError(422,'DXF_ARTIFACT_INTEGRITY','Native result differs from the enrolled source.');
  const {conversion:_,...units}=value.units;
  return DXFSummarySchema.parse({schemaVersion:value.schemaVersion,sourceSha256:value.sourceSha256,sourceBytes:value.sourceBytes,
    dxfVersion:value.dxfVersion,recordCount:value.recordCount,projectedEntityCount:value.projectedEntityCountIncludingChildren,
    pointCount:value.pointCount,unsupportedFindingCount:value.unsupportedFindings.length,units,inspectionFrame:'source_local',
    globalPlacement:'not_assessed',geometryValidity:'not_assessed',unitConversionApplied:false,blockExpansion:'not_performed',
    analyticEligible:false,operationalRecords:false,trainingLabels:false,rights:'not_assessed'});
}
const controlledCode=z.string().regex(/^DXF_[A-Z_]{1,60}$/);
function reapDXF(config:DXFConfig,pid:number,scratch:string){
  try{assertDXFTools(config.pins,Date.now()+5000);}catch{
    return Promise.reject(new AppError(503,'DXF_REAP_UNAVAILABLE','Reaper imports are not verified; private scratch remains retained.'));
  }
  return new Promise<void>((resolve,reject)=>{
    const reaper=spawn(config.python,['-I','-S','-B',config.supervisor,'--reap-pid',String(pid)],{shell:false,windowsHide:true,cwd:scratch,
      env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',TEMP:scratch,TMP:scratch},stdio:['ignore','pipe','ignore']});
    let reply='';const timer=setTimeout(()=>reaper.kill(),5000);
    reaper.stdout.on('data',(v:Buffer)=>{reply+=v.toString('utf8');if(reply.length>1024)reaper.kill();});
    reaper.on('error',()=>{});
    reaper.on('close',code=>{clearTimeout(timer);if(code===0&&reply.trim()==='{"state":"available"}')resolve();
      else reject(new AppError(503,'DXF_REAP_UNAVAILABLE','Owned parser termination was not confirmed; private scratch remains retained.'));});
  });
}
export function superviseDXF(config:DXFConfig,requestPath:string,scratch:string,signal:AbortSignal){
  signal.throwIfAborted();
  assertDXFTools(config.pins);
  return new Promise<void>((resolve,reject)=>{
    const child=spawn(config.python,['-I','-S','-B',config.supervisor,'--request',requestPath],{shell:false,windowsHide:true,cwd:scratch,
      env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',TEMP:scratch,TMP:scratch},stdio:['ignore','pipe','pipe']});
    let stdout='',size=0,failure:unknown;
    const abort=()=>{failure=signal.reason??new AppError(409,'DXF_CANCELLED','DXF reading was cancelled.');child.kill();};
    const timer=setTimeout(()=>{failure=new AppError(504,'DXF_TIMEOUT','DXF wrapper exceeded its deadline.');child.kill();},90_000);
    signal.addEventListener('abort',abort,{once:true});
    const collect=(v:Buffer,output:boolean)=>{size+=v.length;if(size>16384){failure=new AppError(413,'DXF_REPLY_LIMIT','DXF supervisor reply exceeded its profile.');child.kill();}
      else if(output)stdout+=v.toString('utf8');};
    child.stdout.on('data',(v:Buffer)=>collect(v,true));child.stderr.on('data',(v:Buffer)=>collect(v,false));
    child.on('error',()=>{failure=new AppError(503,'DXF_UNAVAILABLE','Pinned DXF supervisor could not start.');});
    child.on('close',async code=>{
      clearTimeout(timer);signal.removeEventListener('abort',abort);
      if(failure){try{if(child.pid)await reapDXF(config,child.pid,scratch);}catch(error){reject(error);return;}reject(failure);return;}
      try{const reply=z.object({state:z.literal('available').optional(),code:controlledCode.optional()}).parse(JSON.parse(stdout));
        if(reply.code)throw new AppError(['DXF_UNAVAILABLE','DXF_BUSY','DXF_TOOL_CHANGED','DXF_UNSUPPORTED_PLATFORM'].includes(reply.code)?503:422,
          reply.code,'DXF reading did not complete; unchanged original is retained for explicit retry.');
        if(code!==0||reply.state!=='available')throw new Error();resolve();
      }catch(error){reject(error instanceof AppError?error:new AppError(422,'DXF_PROCESSING_FAILED','DXF supervisor did not return a controlled result.'));}
    });
    if(signal.aborted)abort();
  });
}
export async function processDXF(input:DXFInput,source:Buffer,signal:AbortSignal,deadlineAt:number){
  signal.throwIfAborted();if(source.length!==input.sourceBytes||sha256(source)!==input.sourceSha256)
    throw new AppError(422,'DXF_SOURCE_INTEGRITY','Retained DXF source differs from its byte receipt.');
  const config=assertDXFTools(input.tools,deadlineAt),scratch=await mkdtemp(join(config.scratchRoot,'dxf-native-'));
  let cleanup=true;
  try{
    const sourcePath=join(scratch,'original.dxf'),output=join(scratch,'native.json'),requestPath=join(scratch,'request.json');
    await writeFile(sourcePath,source,{flag:'wx'});
    await writeFile(requestPath,JSON.stringify({source:sourcePath,sourceSha256:input.sourceSha256,output,profilePath:config.profilePath,tools:input.tools}),{flag:'wx'});
    await superviseDXF(config,requestPath,scratch,signal);signal.throwIfAborted();
    const info=await stat(output);if(!info.isFile()||info.size>DXF_LIMITS.artifactBytes)throw new AppError(413,'DXF_OUTPUT_LIMIT','Local DXF output exceeds its profile.');
    const bytes=await readFile(output,{signal}),summary=dxfSummary(bytes,input);
    if(sha256(await readFile(sourcePath,{signal}))!==input.sourceSha256)throw new AppError(422,'DXF_SOURCE_INTEGRITY','Local DXF original changed.');
    assertDXFTools(input.tools,deadlineAt);signal.throwIfAborted();return {bytes,summary,hash:sha256(bytes)};
  }catch(error){if(error instanceof AppError&&error.code==='DXF_REAP_UNAVAILABLE')cleanup=false;throw error;}
  finally{
    const child=relative(config.scratchRoot,await realpath(scratch));if(!child||child.startsWith('..')||isAbsolute(child))throw new AppError(503,'DXF_CLEANUP_SCOPE','Owned DXF temporary path changed.');
    if(cleanup)await rm(scratch,{recursive:true,force:true});
  }
}

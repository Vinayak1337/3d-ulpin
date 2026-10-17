import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,stat,rm,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {CITYGML_LIMITS,CityGMLSummarySchema,CityGMLSupervisionSchema,type CityGMLInput} from '../../../../../contracts/src/usp/citygml-ingestion';
import {sha256} from '../../../infrastructure/storage';
import {AppError} from '../../../infrastructure/errors';
import {assertCityGMLTools,type CityGMLConfig} from './citygml-config';

const count=z.number().int().nonnegative();
const native=z.object({schemaVersion:z.literal('ulpin-native-citygml/1'),status:CityGMLSummarySchema.shape.status,
  scope:z.literal('source_native_literal_inventory'),source:z.object({sha256:CityGMLSummarySchema.shape.sourceSha256,
    bytes:CityGMLSummarySchema.shape.sourceBytes,citygmlVersion:z.literal('2.0'),encodingProfile:z.literal('XML 1.0 UTF-8')}),
  limits:z.object({input_bytes:z.literal(CITYGML_LIMITS.originalBytes),output_bytes:z.literal(CITYGML_LIMITS.artifactBytes),
    memory_bytes:z.literal(2*1024**3),seconds:z.literal(60),threads:z.literal(2),elements:z.literal(25000),depth:z.literal(64),
    string_bytes:z.literal(65536),coordinate_values:z.literal(100000)}),
  elements:z.array(z.object({interpretation:z.string()})).max(25000),buildings:z.array(z.unknown()).max(25000),
  coordinates:z.array(z.object({values:z.array(z.unknown()).max(100000).nullable()})).max(25000),
  references:z.array(z.object({state:z.string(),cycleState:z.string()})).max(25000),
  counts:z.object({elements:count.max(25000),buildingsAndParts:count.max(25000),coordinateDeclarations:count.max(25000),
    decodedCoordinateValues:count.max(100000),references:count.max(25000)}),
  findings:z.array(z.object({code:CityGMLSummarySchema.shape.findingCodes.element})).max(4),
  semantics:z.object({globalTransformApplied:z.literal(false),measurement:z.literal('not_assessed'),validity:z.literal('not_assessed'),
    canonicalIdentity:z.literal('not_assessed'),rights:z.literal('not_assessed'),floorsOrUnitsInferred:z.literal(false),externalResourcesResolved:z.literal(false)})});
/** Derive small status from the actual unaltered native projection, not source labels. */
export function citygmlSummary(bytes:Buffer,input:CityGMLInput){
  if(bytes.length>CITYGML_LIMITS.artifactBytes)throw new AppError(413,'CITYGML_OUTPUT_LIMIT','CityGML native output exceeds its profile.');
  const value=native.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))),c=value.counts;
  if(value.source.sha256!==input.sourceSha256||value.source.bytes!==input.sourceBytes||c.elements!==value.elements.length
    ||c.buildingsAndParts!==value.buildings.length||c.coordinateDeclarations!==value.coordinates.length||c.references!==value.references.length
    ||c.decodedCoordinateValues!==value.coordinates.reduce((n,c)=>n+(c.values?.length??0),0)
    ||(value.status==='partial')!==(value.findings.length>0))
    throw new AppError(422,'CITYGML_ARTIFACT_INTEGRITY','Native result differs from the enrolled source or inventory.');
  return CityGMLSummarySchema.parse({schemaVersion:value.schemaVersion,sourceSha256:value.source.sha256,sourceBytes:value.source.bytes,
    citygmlVersion:value.source.citygmlVersion,encodingProfile:value.source.encodingProfile,scope:value.scope,status:value.status,
    elementCount:c.elements,buildingAndPartCount:c.buildingsAndParts,coordinateDeclarationCount:c.coordinateDeclarations,
    decodedCoordinateValueCount:c.decodedCoordinateValues,referenceCount:c.references,
    unsupportedElementCount:value.elements.filter(e=>e.interpretation.startsWith('unsupported')).length,
    unresolvedReferenceCount:value.references.filter(r=>r.state!=='local_target_inventory'||r.cycleState==='cycle_member').length,
    findingCodes:value.findings.map(f=>f.code),accuracy:'not_assessed',validity:'not_assessed',canonicalIdentity:'not_assessed',
    analyticEligible:false,registryAdmission:false,learningLabels:false,rights:'not_assessed'});
}
const controlledCode=z.string().regex(/^CITYGML_[A-Z_]{1,60}$/);
function reapCityGML(config:CityGMLConfig,pid:number,scratch:string){
  try{assertCityGMLTools(config.pins,Date.now()+5000);}catch{
    return Promise.reject(new AppError(503,'CITYGML_REAP_UNAVAILABLE','Reaper imports are not verified; private scratch remains retained.'));
  }
  return new Promise<void>((resolve,reject)=>{
    const reaper=spawn(config.python,['-I','-S','-B',config.supervisor,'--reap-pid',String(pid)],{shell:false,windowsHide:true,cwd:scratch,
      env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',TEMP:scratch,TMP:scratch},stdio:['ignore','pipe','ignore']});
    let reply='';const timer=setTimeout(()=>reaper.kill(),5000);
    reaper.stdout.on('data',(v:Buffer)=>{reply+=v.toString('utf8');if(reply.length>1024)reaper.kill();});
    reaper.on('error',()=>{});
    reaper.on('close',code=>{clearTimeout(timer);if(code===0&&reply.trim()==='{"state":"available"}')resolve();
      else reject(new AppError(503,'CITYGML_REAP_UNAVAILABLE','Owned parser termination was not confirmed; private scratch remains retained.'));});
  });
}
export function superviseCityGML(config:CityGMLConfig,requestPath:string,scratch:string,signal:AbortSignal){
  signal.throwIfAborted();
  assertCityGMLTools(config.pins);
  return new Promise<z.infer<typeof CityGMLSupervisionSchema>>((resolve,reject)=>{
    const child=spawn(config.python,['-I','-S','-B',config.supervisor,'--request',requestPath],{shell:false,windowsHide:true,cwd:scratch,
      env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',TEMP:scratch,TMP:scratch},stdio:['ignore','pipe','pipe']});
    let stdout='',size=0,failure:unknown;
    const abort=()=>{failure=signal.reason??new AppError(409,'CITYGML_CANCELLED','CityGML reading was cancelled.');child.kill();};
    const timer=setTimeout(()=>{failure=new AppError(504,'CITYGML_TIMEOUT','CityGML wrapper exceeded its deadline.');child.kill();},90_000);
    signal.addEventListener('abort',abort,{once:true});
    const collect=(v:Buffer,output:boolean)=>{size+=v.length;if(size>16384){failure=new AppError(413,'CITYGML_REPLY_LIMIT','CityGML supervisor reply exceeded its profile.');child.kill();}
      else if(output)stdout+=v.toString('utf8');};
    child.stdout.on('data',(v:Buffer)=>collect(v,true));child.stderr.on('data',(v:Buffer)=>collect(v,false));
    child.on('error',()=>{failure=new AppError(503,'CITYGML_UNAVAILABLE','Pinned CityGML supervisor could not start.');});
    child.on('close',async code=>{
      clearTimeout(timer);signal.removeEventListener('abort',abort);
      if(failure){try{if(child.pid)await reapCityGML(config,child.pid,scratch);}catch(error){reject(error);return;}reject(failure);return;}
      try{const reply=z.object({state:z.literal('available').optional(),code:controlledCode.optional(),supervision:CityGMLSupervisionSchema.optional()}).parse(JSON.parse(stdout));
        if(reply.code)throw new AppError(['CITYGML_UNAVAILABLE','CITYGML_BUSY','CITYGML_TOOL_CHANGED','CITYGML_UNSUPPORTED_PLATFORM'].includes(reply.code)?503:422,
          reply.code,'CityGML reading did not complete; unchanged original is retained for explicit retry.');
        if(code!==0||reply.state!=='available'||!reply.supervision)throw new Error();resolve(reply.supervision);
      }catch(error){reject(error instanceof AppError?error:new AppError(422,'CITYGML_PROCESSING_FAILED','CityGML supervisor did not return a controlled result.'));}
    });
    if(signal.aborted)abort();
  });
}
export async function processCityGML(input:CityGMLInput,source:Buffer,signal:AbortSignal,deadlineAt:number){
  signal.throwIfAborted();if(source.length!==input.sourceBytes||sha256(source)!==input.sourceSha256)
    throw new AppError(422,'CITYGML_SOURCE_INTEGRITY','Retained CityGML source differs from its byte receipt.');
  const config=assertCityGMLTools(input.tools,deadlineAt),scratch=await mkdtemp(join(config.scratchRoot,'citygml-native-'));
  let cleanup=true;
  try{
    const sourcePath=join(scratch,'original.gml'),output=join(scratch,'native.json'),requestPath=join(scratch,'request.json');
    await writeFile(sourcePath,source,{flag:'wx'});
    await writeFile(requestPath,JSON.stringify({source:sourcePath,sourceSha256:input.sourceSha256,output,profilePath:config.profilePath,tools:input.tools}),{flag:'wx'});
    const supervision=await superviseCityGML(config,requestPath,scratch,signal);signal.throwIfAborted();
    const info=await stat(output);if(!info.isFile()||info.size>CITYGML_LIMITS.artifactBytes)throw new AppError(413,'CITYGML_OUTPUT_LIMIT','Local CityGML output exceeds its profile.');
    const bytes=await readFile(output,{signal}),summary=citygmlSummary(bytes,input);
    if(sha256(await readFile(sourcePath,{signal}))!==input.sourceSha256)throw new AppError(422,'CITYGML_SOURCE_INTEGRITY','Local CityGML original changed.');
    assertCityGMLTools(input.tools,deadlineAt);signal.throwIfAborted();return {bytes,summary,supervision,hash:sha256(bytes)};
  }catch(error){if(error instanceof AppError&&error.code==='CITYGML_REAP_UNAVAILABLE')cleanup=false;throw error;}
  finally{
    const child=relative(config.scratchRoot,await realpath(scratch));if(!child||child.startsWith('..')||isAbsolute(child))throw new AppError(503,'CITYGML_CLEANUP_SCOPE','Owned CityGML temporary path changed.');
    if(cleanup)await rm(scratch,{recursive:true,force:true});
  }
}

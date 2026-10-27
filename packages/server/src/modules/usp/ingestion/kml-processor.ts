import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,stat,rm,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {KML_LIMITS,KMLSummarySchema,KMLMemberPinSchema,KMLSupervisionSchema,type KMLInput} from '../../../../../contracts/src/usp/kml-ingestion';
import {sha256} from '../../../infrastructure/storage';
import {AppError} from '../../../infrastructure/errors';
import {assertKMLTools,type KMLConfig} from './kml-config';
import {fingerprint} from '../../cases/domain';

const count=z.number().int().nonnegative();
const inventoryMember=z.object({...KMLMemberPinSchema.shape,path:z.string().min(1).max(1024),
  compressedBytes:count.max(KML_LIMITS.originalBytes),crc32:z.string().regex(/^[a-f0-9]{8}$/),crc:z.literal('match'),
  kind:z.enum(['directory','kml','inert_asset']),selected:z.boolean()});
const native=z.object({schemaVersion:z.literal('kml-native-inspection/1'),status:KMLSummarySchema.shape.status,
  sourceSha256:KMLSummarySchema.shape.sourceSha256,sourceBytes:KMLSummarySchema.shape.sourceBytes,
  container:KMLSummarySchema.shape.container,xmlSha256:KMLSummarySchema.shape.xmlSha256,member:inventoryMember.nullable(),
  memberInventory:z.array(inventoryMember).max(256),
  selection:z.object({code:KMLSummarySchema.shape.selectionCode.unwrap(),candidates:z.array(z.string()).max(256),status:z.literal('needs_input')}).optional(),
  document:z.object({profile:z.enum(['kml_2_2','unnamespaced_feature_fragment'])}).nullable(),
  features:z.array(z.unknown()).max(10000),unsupported:z.array(z.unknown()).max(100000),references:z.array(z.unknown()).max(100000),coordinateCount:count.max(100000),
  qualification:z.object({profile:z.literal('local_source_inspection'),accuracy:z.literal('not_assessed'),
    analyticEligible:z.literal(false),registryAdmission:z.literal(false),learningLabels:z.literal(false)})});
export function kmlSummary(bytes:Buffer,input:KMLInput){
  if(bytes.length>KML_LIMITS.artifactBytes)throw new AppError(413,'KML_OUTPUT_LIMIT','KML native output exceeds its profile.');
  const value=native.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  const pin=(v:z.infer<typeof inventoryMember>)=>KMLMemberPinSchema.parse({path:v.path,ordinal:v.ordinal,sha256:v.sha256,bytes:v.bytes}),
    member=value.member?pin(value.member):null,members=value.memberInventory.filter(v=>v.kind==='kml').map(pin);
  if(value.sourceSha256!==input.sourceSha256||value.sourceBytes!==input.sourceBytes||
    input.selection&&fingerprint(input.selection)!==fingerprint(member)||
    value.status==='needs_input'&&(value.member!==null||value.xmlSha256!==null||value.document!==null||!value.selection)||
    value.status!=='needs_input'&&(!value.document||!value.xmlSha256||value.xmlSha256!==(member?.sha256??input.sourceSha256))||
    value.container==='kml'&&(member!==null||members.length!==0)||
    member&&!members.some(v=>fingerprint(v)===fingerprint(member))||
    value.selection&&fingerprint(value.selection.candidates)!==fingerprint(members.map(v=>v.path)))
    throw new AppError(422,'KML_ARTIFACT_INTEGRITY','Native result differs from the enrolled source.');
  return KMLSummarySchema.parse({schemaVersion:value.schemaVersion,sourceSha256:value.sourceSha256,sourceBytes:value.sourceBytes,
    container:value.container,status:value.status,xmlSha256:value.xmlSha256,member,members,selectionCode:value.selection?.code??null,
    documentProfile:value.document?.profile??null,horizontalReference:value.document?.profile==='kml_2_2'?'kml_specification':'unknown',
    featureCount:value.features.length,coordinateCount:value.coordinateCount,unsupportedCount:value.unsupported.length,
    unresolvedReferenceCount:value.references.length,accuracy:'not_assessed',analyticEligible:false,registryAdmission:false,learningLabels:false,rights:'not_assessed'});
}
const controlledCode=z.string().regex(/^KML_[A-Z_]{1,60}$/);
function reapKML(config:KMLConfig,pid:number,scratch:string){
  try{assertKMLTools(config.pins,Date.now()+5000);}catch{
    return Promise.reject(new AppError(503,'KML_REAP_UNAVAILABLE','Reaper imports are not verified; private scratch remains retained.'));
  }
  return new Promise<void>((resolve,reject)=>{
    const reaper=spawn(config.python,['-I','-S','-B',config.supervisor,'--reap-pid',String(pid)],{shell:false,windowsHide:true,cwd:scratch,
      env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',TEMP:scratch,TMP:scratch},stdio:['ignore','pipe','ignore']});
    let reply='';const timer=setTimeout(()=>reaper.kill(),5000);
    reaper.stdout.on('data',(v:Buffer)=>{reply+=v.toString('utf8');if(reply.length>1024)reaper.kill();});
    reaper.on('error',()=>{});
    reaper.on('close',code=>{clearTimeout(timer);if(code===0&&reply.trim()==='{"state":"available"}')resolve();
      else reject(new AppError(503,'KML_REAP_UNAVAILABLE','Owned parser termination was not confirmed; private scratch remains retained.'));});
  });
}
export function superviseKML(config:KMLConfig,requestPath:string,scratch:string,signal:AbortSignal){
  signal.throwIfAborted();
  assertKMLTools(config.pins);
  return new Promise<z.infer<typeof KMLSupervisionSchema>>((resolve,reject)=>{
    const child=spawn(config.python,['-I','-S','-B',config.supervisor,'--request',requestPath],{shell:false,windowsHide:true,cwd:scratch,
      env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',TEMP:scratch,TMP:scratch},stdio:['ignore','pipe','pipe']});
    let stdout='',size=0,failure:unknown;
    const abort=()=>{failure=signal.reason??new AppError(409,'KML_CANCELLED','KML reading was cancelled.');child.kill();};
    const timer=setTimeout(()=>{failure=new AppError(504,'KML_TIMEOUT','KML wrapper exceeded its deadline.');child.kill();},90_000);
    signal.addEventListener('abort',abort,{once:true});
    const collect=(v:Buffer,output:boolean)=>{size+=v.length;if(size>16384){failure=new AppError(413,'KML_REPLY_LIMIT','KML supervisor reply exceeded its profile.');child.kill();}
      else if(output)stdout+=v.toString('utf8');};
    child.stdout.on('data',(v:Buffer)=>collect(v,true));child.stderr.on('data',(v:Buffer)=>collect(v,false));
    child.on('error',()=>{failure=new AppError(503,'KML_UNAVAILABLE','Pinned KML supervisor could not start.');});
    child.on('close',async code=>{
      clearTimeout(timer);signal.removeEventListener('abort',abort);
      if(failure){try{if(child.pid)await reapKML(config,child.pid,scratch);}catch(error){reject(error);return;}reject(failure);return;}
      try{const reply=z.object({state:z.literal('available').optional(),code:controlledCode.optional(),supervision:KMLSupervisionSchema.optional()}).parse(JSON.parse(stdout));
        if(reply.code)throw new AppError(['KML_UNAVAILABLE','KML_BUSY','KML_TOOL_CHANGED','KML_UNSUPPORTED_PLATFORM'].includes(reply.code)?503:422,
          reply.code,'KML reading did not complete; unchanged original is retained for explicit retry.');
        if(code!==0||reply.state!=='available'||!reply.supervision)throw new Error();resolve(reply.supervision);
      }catch(error){reject(error instanceof AppError?error:new AppError(422,'KML_PROCESSING_FAILED','KML supervisor did not return a controlled result.'));}
    });
    if(signal.aborted)abort();
  });
}
export async function processKML(input:KMLInput,source:Buffer,signal:AbortSignal,deadlineAt:number){
  signal.throwIfAborted();if(source.length!==input.sourceBytes||sha256(source)!==input.sourceSha256)
    throw new AppError(422,'KML_SOURCE_INTEGRITY','Retained KML source differs from its byte receipt.');
  const config=assertKMLTools(input.tools,deadlineAt),scratch=await mkdtemp(join(config.scratchRoot,'kml-native-'));
  let cleanup=true;
  try{
    const sourcePath=join(scratch,'original.kml'),output=join(scratch,'native.json'),requestPath=join(scratch,'request.json');
    await writeFile(sourcePath,source,{flag:'wx'});
    await writeFile(requestPath,JSON.stringify({source:sourcePath,sourceSha256:input.sourceSha256,member:input.selection?.path??null,output,profilePath:config.profilePath,tools:input.tools}),{flag:'wx'});
    const supervision=await superviseKML(config,requestPath,scratch,signal);signal.throwIfAborted();
    const info=await stat(output);if(!info.isFile()||info.size>KML_LIMITS.artifactBytes)throw new AppError(413,'KML_OUTPUT_LIMIT','Local KML output exceeds its profile.');
    const bytes=await readFile(output,{signal}),summary=kmlSummary(bytes,input);
    if(sha256(await readFile(sourcePath,{signal}))!==input.sourceSha256)throw new AppError(422,'KML_SOURCE_INTEGRITY','Local KML original changed.');
    assertKMLTools(input.tools,deadlineAt);signal.throwIfAborted();return {bytes,summary,supervision,hash:sha256(bytes)};
  }catch(error){if(error instanceof AppError&&error.code==='KML_REAP_UNAVAILABLE')cleanup=false;throw error;}
  finally{
    const child=relative(config.scratchRoot,await realpath(scratch));if(!child||child.startsWith('..')||isAbsolute(child))throw new AppError(503,'KML_CLEANUP_SCOPE','Owned KML temporary path changed.');
    if(cleanup)await rm(scratch,{recursive:true,force:true});
  }
}

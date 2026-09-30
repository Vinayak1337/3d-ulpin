import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,stat,rm,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {CITYJSON_VALIDATION_LIMITS,RegistryCityJSONValidationSummarySchema,
  type RegistryCityJSONValidationInput} from '@ulpin/contracts';
import {AppError} from '../../infrastructure/errors';
import {sha256} from '../../infrastructure/storage';
import {fingerprint} from '../cases/domain';
import {cityjsonValidationConfig,type CityJSONValidationConfig,validationUnavailable} from './cityjson-validation-config';

const hash=z.string().regex(/^[a-f0-9]{64}$/),state=z.enum(['valid','invalid','unsupported','error','unavailable']);
const check=z.object({state,toolVersion:z.string().optional(),reportSha256:hash.optional(),hasWarnings:z.boolean().optional(),
  checks:z.object({errors:z.record(z.string(),z.object({valid:z.boolean()}))}).optional(),errorCodes:z.array(z.union([z.number(),z.string()])).optional()});
const receiptSchema=z.object({schemaVersion:z.literal('cityjson-offline-validity/1'),adapterSha256:hash,toolLockSha256:hash,
  timeoutSeconds:z.literal(120),state,source:z.object({sha256:hash,bytes:z.number()}),
  analyticalQualification:z.literal('not_assessed'),configuration:z.object({parameters:z.strictObject({snap_tol:z.literal(1e-12),
    planarity_d2p_tol:z.literal(0.01),planarity_n_tol:z.literal(20),overlap_tol:z.literal(0)}),originalByteLimit:z.literal(8*1024*1024),
    reportByteLimit:z.literal(4*1024*1024),timeoutSeconds:z.literal(120)}),
  lineage:z.object({selections:z.array(z.object({objectId:z.string(),sourceGeometryIndex:z.number()}))}).optional(),
  results:z.object({cjval:check.optional(),val3dity:check.optional()}),commands:z.array(z.object({execution:z.string()}))});
export const CITYJSON_VALIDATION_REPORT_NAMES=['receipt.json','cjval.stdout','cjval.stderr','val3dity.stdout','val3dity.stderr','val3dity.json'] as const;
type Report={name:typeof CITYJSON_VALIDATION_REPORT_NAMES[number];bytes:Buffer};

/** Public diagnostics are controlled codes/locators; arbitrary validator strings/paths stay private. */
export function validationSummary(raw:unknown,input:RegistryCityJSONValidationInput,reports:Report[]){
  const r=receiptSchema.parse(raw),tools=input.validator.tools;
  if(r.source.sha256!==input.candidate.input.sourceSha256||r.source.bytes!==input.candidate.input.sourceBytes||
    r.adapterSha256!==input.validator.adapterSha256||r.toolLockSha256!==input.validator.toolLockSha256)
    throw new AppError(422,'CITYJSON_VALIDATION_INTEGRITY','Local report differs from enrolled source/tool pins.');
  if(r.commands.some(v=>v.execution==='timeout'))throw new AppError(504,'CITYJSON_VALIDATION_TIMEOUT','Local validation exceeded its deadline.');
  if(r.state==='unavailable')validationUnavailable();
  if(r.state==='error')throw new AppError(422,'CITYJSON_VALIDATION_TOOL_FAILURE','Local validation failed; a new explicit request can retry.');
  // A partial unsupported result may still expose a completed document check;
  // that check needs the same exact version/report pins as a full verdict.
  for(const [name,file] of [['cjval','cjval.stdout'],['val3dity','val3dity.json']] as const){
    const result=r.results[name],report=reports.find(v=>v.name===file);
    if(result&&['valid','invalid'].includes(result.state)&&(result.toolVersion!==tools.find(v=>v.name===name)?.version||
      !report||sha256(report.bytes)!==result.reportSha256))
      throw new AppError(422,'CITYJSON_VALIDATION_INTEGRITY','Completed validator report differs from its enrolled pins.');
  }
  if(r.state!=='unsupported'){
    const selected=r.lineage?.selections.map(v=>({objectId:v.objectId,geometryIndex:v.sourceGeometryIndex}));
    if(fingerprint(selected)!==fingerprint(input.selections.map(({objectId,geometryIndex})=>({objectId,geometryIndex}))))
      throw new AppError(422,'CITYJSON_VALIDATION_INTEGRITY','Report selection is not the enrolled geometry.');
    for(const [name,file] of [['cjval','cjval.stdout'],['val3dity','val3dity.json']] as const){
      const result=r.results[name],report=reports.find(v=>v.name===file);
      if(!result||!['valid','invalid'].includes(result.state)||!report)
        throw new AppError(422,'CITYJSON_VALIDATION_INTEGRITY','A complete pinned validator report is required.');
    }
    const expected=r.results.cjval!.state==='invalid'||r.results.val3dity!.state==='invalid'?'invalid':'valid';
    if(r.state!==expected)throw new AppError(422,'CITYJSON_VALIDATION_INTEGRITY','Validator aggregate differs from individual verdicts.');
  }
  const codes:string[]=[];
  if(r.state==='unsupported')codes.push('CITYJSON_VALIDATION_UNSUPPORTED');
  for(const [name,value] of Object.entries(r.results.cjval?.checks?.errors??{}))
    if(!value.valid&&/^[a-z_]{1,40}$/.test(name))codes.push(`CJVAL_${name.toUpperCase()}`);
  for(const code of r.results.val3dity?.errorCodes??[])
    if(/^\d{1,5}$/.test(String(code)))codes.push(`VAL3DITY_${code}`);
  return RegistryCityJSONValidationSummarySchema.parse({outcome:r.state,
    documentSchema:['valid','invalid'].includes(r.results.cjval?.state??'')?r.results.cjval!.state:'unsupported',
    selectedGeometry:['valid','invalid'].includes(r.results.val3dity?.state??'')?r.results.val3dity!.state:'unsupported',
    hasWarnings:r.results.cjval?.hasWarnings??false,codes:[...new Set(codes)].slice(0,64),
    sourceLocators:input.selections,validator:input.validator,qualification:'not_assessed',referenceAccuracy:'not_assessed',canonicalAdmission:'not_assessed'});
}

async function boundedFile(path:string,limit:number){
  const info=await stat(path);if(!info.isFile()||info.size>limit)
    throw new AppError(413,'CITYJSON_VALIDATION_REPORT_LIMIT','Local report exceeds its bounded profile.');
  const bytes=await readFile(path);if(bytes.length>limit)throw new AppError(413,'CITYJSON_VALIDATION_REPORT_LIMIT','Report changed size.');return bytes;
}
/** One supervisor owns a Windows kill-on-close process tree and an OS-released host mutex. */
async function supervise(config:CityJSONValidationConfig,requestPath:string,scratch:string,signal:AbortSignal){
  signal.throwIfAborted();
  return new Promise<void>((resolve,reject)=>{
    const child=spawn(config.python,['-I','-B',config.supervisor,'--request',requestPath],{shell:false,windowsHide:true,cwd:scratch,
      env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',TEMP:scratch,TMP:scratch},stdio:['ignore','pipe','pipe']});
    let stdout='',size=0,failure:unknown;
    const abort=()=>{failure=signal.reason??new AppError(409,'CITYJSON_VALIDATION_CANCELLED','Validation was cancelled.');child.kill();};
    const timer=setTimeout(()=>{failure=new AppError(504,'CITYJSON_VALIDATION_TIMEOUT','Validation exceeded its total deadline.');child.kill();},120_000);
    signal.addEventListener('abort',abort,{once:true});
    const collect=(value:Buffer,output:boolean)=>{size+=value.length;if(size>64*1024){failure=new AppError(413,'CITYJSON_VALIDATION_REPORT_LIMIT','Supervisor output exceeded its limit.');child.kill();}
      else if(output)stdout+=value.toString('utf8');};
    child.stdout.on('data',(v:Buffer)=>collect(v,true));child.stderr.on('data',(v:Buffer)=>collect(v,false));
    child.on('error',()=>{failure=new AppError(503,'CITYJSON_VALIDATION_UNAVAILABLE','Local supervisor could not start.');});
    child.on('close',code=>{
      clearTimeout(timer);signal.removeEventListener('abort',abort);
      if(failure){reject(failure);return;}
      try{
        const reply=z.object({state:state.optional(),code:z.enum(['CITYJSON_VALIDATION_BUSY','CITYJSON_VALIDATION_UNAVAILABLE',
          'CITYJSON_VALIDATION_TOOL_CHANGED','CITYJSON_VALIDATION_UNSUPPORTED_PLATFORM']).optional()}).parse(JSON.parse(stdout));
        if(reply.code)throw new AppError(503,reply.code,'Local validator unavailable; use an explicit request to retry.');
        if(code!==0||!reply.state)throw new Error();resolve();
      }catch(error){reject(error instanceof AppError?error:new AppError(422,'CITYJSON_VALIDATION_TOOL_FAILURE','Local supervisor failed.'));}
    });
    // Handle a cancellation arriving between the initial check and listener attachment.
    if(signal.aborted)abort();
  });
}

export async function processCityJSONValidation(input:RegistryCityJSONValidationInput,source:Buffer,signal:AbortSignal){
  if(source.length!==input.candidate.input.sourceBytes||sha256(source)!==input.candidate.input.sourceSha256)
    throw new AppError(422,'CITYJSON_VALIDATION_INTEGRITY','Unchanged source bytes failed their receipt.');
  const config=cityjsonValidationConfig();if(fingerprint(config.pins)!==fingerprint(input.validator))validationUnavailable('CITYJSON_VALIDATION_TOOL_CHANGED');
  const scratch=await mkdtemp(join(config.scratchRoot,'cityjson-validation-'));
  try{
    const sourcePath=join(scratch,'original.json'),output=join(scratch,'reports'),requestPath=join(scratch,'request.json');
    await writeFile(sourcePath,source,{flag:'wx'});
    await writeFile(requestPath,JSON.stringify({source:sourcePath,sourceSha256:input.candidate.input.sourceSha256,output,
      toolsRoot:config.toolsRoot,pins:input.validator,selections:input.selections}),{flag:'wx'});
    await supervise(config,requestPath,scratch,signal);signal.throwIfAborted();
    const reports:Report[]=[];
    for(const name of CITYJSON_VALIDATION_REPORT_NAMES){
      try{reports.push({name,bytes:await boundedFile(join(output,name),CITYJSON_VALIDATION_LIMITS.reportBytes)});}
      catch(error){if(name!=='receipt.json'&&(error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
    }
    const summary=validationSummary(JSON.parse(reports.find(v=>v.name==='receipt.json')!.bytes.toString('utf8')),input,reports);
    if(sha256(await boundedFile(sourcePath,8*1024*1024))!==input.candidate.input.sourceSha256||
      fingerprint(cityjsonValidationConfig().pins)!==fingerprint(input.validator))validationUnavailable('CITYJSON_VALIDATION_TOOL_CHANGED');
    signal.throwIfAborted();return {summary,reports};
  }finally{
    // mkdtemp owns this exact child; never delete the configured root or an unverified path.
    const child=relative(config.scratchRoot,await realpath(scratch));
    if(!child||child.startsWith('..')||isAbsolute(child))validationUnavailable();
    await rm(scratch,{recursive:true,force:true});
  }
}

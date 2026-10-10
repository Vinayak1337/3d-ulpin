import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,stat,rm,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {GEOPARQUET_LIMITS,GeoParquetSummarySchema,GeoParquetWindowSchema,GeoParquetSupervisionSchema,type GeoParquetInput} from '../../../../../contracts/src/usp/geoparquet-ingestion';
import {sha256} from '../../../infrastructure/storage';
import {AppError} from '../../../infrastructure/errors';
import {assertGeoParquetTools,type GeoParquetConfig} from './geoparquet-config';

const count=z.number().int().nonnegative();
const native=z.object({format:z.literal('usp-native-geoparquet/1'),source:z.object({sha256:GeoParquetSummarySchema.shape.sourceSha256,bytes:GeoParquetSummarySchema.shape.sourceBytes}),
  reader:z.object({profileVersion:z.literal('1.1.0'),versions:z.object({pyarrow:z.literal('21.0.0'),shapely:z.literal('2.0.7'),numpy:z.literal('2.2.6')}),
    limits:z.object({input_bytes:z.literal(GEOPARQUET_LIMITS.originalBytes),output_bytes:z.literal(GEOPARQUET_LIMITS.artifactBytes),
      memory_bytes:z.literal(2*1024**3),seconds:z.literal(60),threads:z.literal(2),footer_bytes:z.literal(1024**2),columns:z.literal(128),row_groups:z.literal(128),
      group_bytes:z.literal(128*1024**2),group_rows:z.literal(100000),rows:z.literal(1000),coordinates:z.literal(100000),cell_bytes:z.literal(1024**2),
      string_bytes:z.literal(32768),nodes:z.literal(250000),depth:z.literal(32)})}),
  geoMetadata:z.object({state:GeoParquetSummarySchema.shape.geoMetadataState}),
  profile:z.object({status:GeoParquetSummarySchema.shape.profileStatus,reasons:GeoParquetSummarySchema.shape.profileReasons}),
  schema:z.object({columns:z.array(z.unknown()).max(128)}),rowGroups:z.array(z.unknown()).max(128),
  rows:z.array(z.object({rowIndex:count.max(Number.MAX_SAFE_INTEGER),columns:z.record(z.string(),z.object({decoded:z.object({state:z.enum(['available','unsupported'])}).optional()}))})).max(1000),
  window:GeoParquetWindowSchema,
  semantics:z.object({globalPlacementQualified:z.literal(false),transformApplied:z.literal(false),measurementQualified:z.literal(false),canonicalIdentityAssigned:z.literal(false),originalValuesOnly:z.literal(true)})});
/** Keep the full projection untouched; derive a bounded status with explicit coverage. */
export function geoparquetSummary(bytes:Buffer,input:GeoParquetInput){
  if(bytes.length>GEOPARQUET_LIMITS.artifactBytes)throw new AppError(413,'GEOPARQUET_OUTPUT_LIMIT','Native output exceeds its profile.');
  const value=native.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))),w=value.window;
  if(value.source.sha256!==input.sourceSha256||value.source.bytes!==input.sourceBytes
    ||w.requestedStartRowIndex!==input.selection.startRowIndex||w.requestedRows!==input.selection.rowCount||w.returnedRows!==value.rows.length
    ||w.returnedRows>w.requestedRows||w.prefixRowsOmitted!==Math.min(input.selection.startRowIndex,w.totalRows)
    ||value.rows.some((row,i)=>row.rowIndex!==input.selection.startRowIndex+i)
    ||w.status==='unsupported'&&(w.returnedRows!==0||w.nextRowIndex!==null||w.truncated||value.profile.status!=='unsupported')
    ||w.status==='available'&&(value.profile.status!=='supported'||w.scannedBatchRows===undefined||w.prefixRowsScannedInSelectedGroups===undefined||!w.stopReason
      ||w.nextRowIndex!==(input.selection.startRowIndex+w.returnedRows<w.totalRows?input.selection.startRowIndex+w.returnedRows:null)
      ||w.truncated!==(w.nextRowIndex!==null)))
    throw new AppError(422,'GEOPARQUET_ARTIFACT_INTEGRITY','Native inventory differs from its source or selected-row receipt.');
  const unsupportedGeometryCells=value.rows.reduce((n,row)=>n+Object.values(row.columns).filter(c=>c.decoded?.state==='unsupported').length,0);
  return GeoParquetSummarySchema.parse({format:value.format,sourceSha256:value.source.sha256,sourceBytes:value.source.bytes,scope:'source_native_literal_inventory',
    profileStatus:value.profile.status,profileReasons:value.profile.reasons,geoMetadataState:value.geoMetadata.state,
    status:w.status==='unsupported'?'unsupported':w.truncated||unsupportedGeometryCells?'partial':'available',window:w,
    columnCount:value.schema.columns.length,rowGroupCount:value.rowGroups.length,unsupportedGeometryCells,
    accuracy:'not_assessed',validity:'not_assessed',canonicalIdentity:'not_assessed',analyticEligible:false,registryAdmission:false,learningLabels:false,rights:'not_assessed'});
}
const controlledCode=z.string().regex(/^GEOPARQUET_[A-Z_]{1,60}$/);
function reapGeoParquet(config:GeoParquetConfig,pid:number,scratch:string){
  try{assertGeoParquetTools(config.pins,Date.now()+5000);}catch{
    return Promise.reject(new AppError(503,'GEOPARQUET_REAP_UNAVAILABLE','Reaper imports are not verified; private scratch remains retained.'));
  }
  return new Promise<void>((resolve,reject)=>{
    const reaper=spawn(config.python,['-I','-S','-B',config.supervisor,'--reap-pid',String(pid)],{shell:false,windowsHide:true,cwd:scratch,
      env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',TEMP:scratch,TMP:scratch},stdio:['ignore','pipe','ignore']});
    let reply='';const timer=setTimeout(()=>reaper.kill(),5000);
    reaper.stdout.on('data',(v:Buffer)=>{reply+=v.toString('utf8');if(reply.length>1024)reaper.kill();});
    reaper.on('error',()=>{});
    reaper.on('close',code=>{clearTimeout(timer);if(code===0&&reply.trim()==='{"state":"available"}')resolve();
      else reject(new AppError(503,'GEOPARQUET_REAP_UNAVAILABLE','Owned parser termination was not confirmed; private scratch remains retained.'));});
  });
}
export function superviseGeoParquet(config:GeoParquetConfig,requestPath:string,scratch:string,signal:AbortSignal){
  signal.throwIfAborted();
  assertGeoParquetTools(config.pins);
  return new Promise<z.infer<typeof GeoParquetSupervisionSchema>>((resolve,reject)=>{
    const child=spawn(config.python,['-I','-S','-B',config.supervisor,'--request',requestPath],{shell:false,windowsHide:true,cwd:scratch,
      env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',TEMP:scratch,TMP:scratch},stdio:['ignore','pipe','pipe']});
    let stdout='',size=0,failure:unknown;
    const abort=()=>{failure=signal.reason??new AppError(409,'GEOPARQUET_CANCELLED','GeoParquet reading was cancelled.');child.kill();};
    const timer=setTimeout(()=>{failure=new AppError(504,'GEOPARQUET_TIMEOUT','GeoParquet wrapper exceeded its deadline.');child.kill();},90_000);
    signal.addEventListener('abort',abort,{once:true});
    const collect=(v:Buffer,output:boolean)=>{size+=v.length;if(size>16384){failure=new AppError(413,'GEOPARQUET_REPLY_LIMIT','GeoParquet supervisor reply exceeded its profile.');child.kill();}
      else if(output)stdout+=v.toString('utf8');};
    child.stdout.on('data',(v:Buffer)=>collect(v,true));child.stderr.on('data',(v:Buffer)=>collect(v,false));
    child.on('error',()=>{failure=new AppError(503,'GEOPARQUET_UNAVAILABLE','Pinned GeoParquet supervisor could not start.');});
    child.on('close',async code=>{
      clearTimeout(timer);signal.removeEventListener('abort',abort);
      if(failure){try{if(child.pid)await reapGeoParquet(config,child.pid,scratch);}catch(error){reject(error);return;}reject(failure);return;}
      try{const reply=z.object({state:z.literal('available').optional(),code:controlledCode.optional(),supervision:GeoParquetSupervisionSchema.optional()}).parse(JSON.parse(stdout));
        if(reply.code)throw new AppError(['GEOPARQUET_UNAVAILABLE','GEOPARQUET_BUSY','GEOPARQUET_TOOL_CHANGED','GEOPARQUET_UNSUPPORTED_PLATFORM'].includes(reply.code)?503:422,
          reply.code,'GeoParquet reading did not complete; unchanged original is retained for explicit retry.');
        if(code!==0||reply.state!=='available'||!reply.supervision)throw new Error();resolve(reply.supervision);
      }catch(error){reject(error instanceof AppError?error:new AppError(422,'GEOPARQUET_PROCESSING_FAILED','GeoParquet supervisor did not return a controlled result.'));}
    });
    if(signal.aborted)abort();
  });
}
export async function processGeoParquet(input:GeoParquetInput,source:Buffer,signal:AbortSignal,deadlineAt:number){
  signal.throwIfAborted();if(source.length!==input.sourceBytes||sha256(source)!==input.sourceSha256)
    throw new AppError(422,'GEOPARQUET_SOURCE_INTEGRITY','Retained GeoParquet source differs from its byte receipt.');
  const config=assertGeoParquetTools(input.tools,deadlineAt),scratch=await mkdtemp(join(config.scratchRoot,'geoparquet-native-'));
  let cleanup=true;
  try{
    const sourcePath=join(scratch,'original.parquet'),output=join(scratch,'native.json'),requestPath=join(scratch,'request.json');
    await writeFile(sourcePath,source,{flag:'wx'});
    await writeFile(requestPath,JSON.stringify({source:sourcePath,sourceSha256:input.sourceSha256,selection:input.selection,output,profilePath:config.profilePath,tools:input.tools}),{flag:'wx'});
    const supervision=await superviseGeoParquet(config,requestPath,scratch,signal);signal.throwIfAborted();
    const info=await stat(output);if(!info.isFile()||info.size>GEOPARQUET_LIMITS.artifactBytes)throw new AppError(413,'GEOPARQUET_OUTPUT_LIMIT','Local GeoParquet output exceeds its profile.');
    const bytes=await readFile(output,{signal}),summary=geoparquetSummary(bytes,input);
    if(sha256(await readFile(sourcePath,{signal}))!==input.sourceSha256)throw new AppError(422,'GEOPARQUET_SOURCE_INTEGRITY','Local GeoParquet original changed.');
    assertGeoParquetTools(input.tools,deadlineAt);signal.throwIfAborted();return {bytes,summary,supervision,hash:sha256(bytes)};
  }catch(error){if(error instanceof AppError&&error.code==='GEOPARQUET_REAP_UNAVAILABLE')cleanup=false;throw error;}
  finally{
    const child=relative(config.scratchRoot,await realpath(scratch));if(!child||child.startsWith('..')||isAbsolute(child))throw new AppError(503,'GEOPARQUET_CLEANUP_SCOPE','Owned GeoParquet temporary path changed.');
    if(cleanup)await rm(scratch,{recursive:true,force:true});
  }
}

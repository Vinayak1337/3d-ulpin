import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {access,realpath,rm,writeFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {z} from 'zod';
import {PACKET_REGION_LIMITS as limits,PacketRegionWorkerSchema,type PacketRegionSelection} from '../../../../../contracts/src/packet-region';
import {settings} from '../../../infrastructure/config';
import {AppError} from '../../../infrastructure/errors';
import {sha256} from '../../../infrastructure/storage';
import {privateOcrDirectory,readBoundedOcrArtifact} from '../ingestion/document-ocr';
import type {DocumentPageAuthority} from '../ingestion/document-pages';

const paths=['services/geo/geo/usp_packet_regions.py','scripts/usp/document-models/run_packet_region.py',
  'scripts/usp/document-models/run_trial.py','packages/contracts/src/packet-region.ts'];
export async function packetRegionRecipeSha(){
  return sha256(Buffer.concat(await Promise.all(paths.map(p=>readBoundedOcrArtifact(join(settings.repositoryRoot,p),256*1024)))));
}
export type PacketRegionInspection={result:unknown;png:Buffer};
let blocked=false;
export function assertPacketRegionRuntime(){if(blocked)throw new AppError(503,'PACKET_REGION_CLEANUP_UNRESOLVED','Restore the owned region runtime after unresolved cleanup.');}
const executionSchema=z.object({version:z.literal('packet-region-execution/1'),seconds:z.number().int().min(1).max(25),
  memoryBytes:z.literal(limits.memoryBytes),resultSha256:z.string().regex(/^[a-f0-9]{64}$/),
  worker:z.object({exitCode:z.literal(0),stopReason:z.null(),gatedStart:z.literal(true),
    elapsedSeconds:z.number().finite().nonnegative().max(30),peakObservedRssBytes:z.number().int().nonnegative().max(limits.memoryBytes),
    peakJobPrivateBytes:z.number().int().nonnegative().max(limits.memoryBytes)})});
function execute(python:string,args:string[],timeout:number){
  const env:Record<string,string>={};
  for(const name of ['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'])
    if(process.env[name])env[name]=process.env[name]!;
  Object.assign(env,{HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',CUDA_VISIBLE_DEVICES:'',OMP_NUM_THREADS:'2',MKL_NUM_THREADS:'2',OPENBLAS_NUM_THREADS:'2'});
  return new Promise<number|null>((resolve,reject)=>{
    const child=spawn(python,args,{cwd:settings.repositoryRoot,env,windowsHide:true,stdio:'ignore'});
    let settled=false,timedOut=false,cleanup:ReturnType<typeof setTimeout>|undefined;
    const finish=(code:number|null)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(cleanup);resolve(timedOut?null:code);};
    const timer=setTimeout(()=>{
      timedOut=true;
      if(child.pid)spawnSync(join(process.env.SystemRoot??'C:\\Windows','System32','taskkill.exe'),
        ['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:3000,stdio:'ignore'});
      cleanup=setTimeout(()=>{if(!settled){settled=true;reject(new Error('PACKET_REGION_CLEANUP_UNRESOLVED'));}},3000);
    },timeout);
    child.on('error',()=>finish(null));child.on('close',finish);
  });
}

export async function inspectPrivatePacketRegion(authority:DocumentPageAuthority,bytes:Uint8Array,page:number,
  selection:PacketRegionSelection,deadline:number):Promise<PacketRegionInspection>{
  assertPacketRegionRuntime();
  const configured=process.env.ULPIN_PACKET_REGIONS_PYTHON,scratch=process.env.ULPIN_PACKET_REGIONS_SCRATCH;
  if(process.platform!=='win32'||!configured||!scratch||!isAbsolute(configured)||!isAbsolute(scratch))
    throw new AppError(503,'PACKET_REGION_RUNTIME_UNAVAILABLE','Configure the pinned private Windows region runtime and scratch directory.');
  let python:string;
  try{python=await realpath(configured);await access(python);}catch{throw new AppError(503,'PACKET_REGION_RUNTIME_UNAVAILABLE','The pinned region runtime is unavailable.');}
  let directory:string|undefined,keep=false;
  try{
    try{directory=await privateOcrDirectory(scratch,randomUUID());}
    catch{throw new AppError(503,'PACKET_REGION_SCRATCH_UNAVAILABLE','Private scratch must be available outside the repository.');}
    const source=join(directory,'original.pdf'),selected=join(directory,'selection.json'),output=join(directory,'output');
    await writeFile(source,bytes,{flag:'wx',mode:0o600});
    await writeFile(selected,JSON.stringify(selection),{flag:'wx',mode:0o600});
    const seconds=Math.min(limits.workerSeconds,Math.floor((deadline-Date.now()-6000)/1000));
    if(seconds<1)throw new AppError(504,'PACKET_REGION_DEADLINE','Not enough time remains for bounded extraction.');
    let exit:number|null;
    try{exit=await execute(python,[join(settings.repositoryRoot,'scripts/usp/document-models/run_packet_region.py'),
      '--source',source,'--sha256',authority.sourceSha256,'--page',String(page),'--selection',selected,
      '--output',output,'--seconds',String(seconds)],Math.min((seconds+3)*1000,deadline-Date.now()));}
    catch{keep=true;blocked=true;throw new AppError(503,'PACKET_REGION_CLEANUP_UNRESOLVED','Region cleanup is unresolved; its private attempt was retained.');}
    const resultBytes=await readBoundedOcrArtifact(join(output,'result.json'),limits.metadataBytes);
    const result:unknown=JSON.parse(resultBytes.toString('utf8'));
    if(exit!==0){
      const failure=z.strictObject({version:z.literal('packet-region-failure/1'),code:z.string().regex(/^PACKET_REGION_[A-Z_]+$/)}).safeParse(result);
      if(failure.success)throw new AppError(failure.data.code.startsWith('PACKET_REGION_RUNTIME_')?503:422,failure.data.code,
        'This exact crop is unavailable under the bounded profile. The original is retained.');
      throw new AppError(503,'PACKET_REGION_RUNTIME_FAILED','The bounded region worker failed.');
    }
    const execution=executionSchema.parse(JSON.parse((await readBoundedOcrArtifact(join(output,'receipt.json'),limits.metadataBytes)).toString('utf8')));
    if(execution.seconds!==seconds||execution.resultSha256!==sha256(resultBytes))
      throw new AppError(503,'PACKET_REGION_RUNTIME_FAILED','Region output differs from its supervised receipt.');
    PacketRegionWorkerSchema.parse(result);
    return {result,png:await readBoundedOcrArtifact(join(output,'region.png'),limits.pngBytes)};
  }catch(error){
    if(error instanceof AppError)throw error;
    throw new AppError(503,'PACKET_REGION_RUNTIME_FAILED','The private worker did not return valid bounded artifacts.');
  }finally{if(directory&&!keep)await rm(directory,{recursive:true,force:true});}
}

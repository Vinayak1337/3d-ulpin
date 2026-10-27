import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {access,realpath,rm,writeFile} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {z} from 'zod';
import {PACKET_REGION_LIMITS as limits,PacketRegionWorkerSchema,type PacketRegionSelection} from '../../../../../contracts/src/packet-region';
import {settings} from '../../../infrastructure/config';
import {AppError} from '../../../infrastructure/errors';
import {sha256} from '../../../infrastructure/storage';
import {privateOcrDirectory,readBoundedOcrArtifact} from '../ingestion/document-ocr';
import type {DocumentPageAuthority} from '../ingestion/document-pages';

const paths=['services/geo/geo/usp_packet_regions.py','scripts/usp/document-models/run_packet_region.py',
  'scripts/usp/document-models/packet_region_loader.py','scripts/usp/document-models/run_trial.py',
  'scripts/usp/document-models/run_pdf_pages.py','services/geo/geo/usp_document_candidates/granite.py',
  'services/geo/geo/__init__.py','services/geo/geo/usp_document_candidates/__init__.py','packages/contracts/src/packet-region.ts'];
const hashSchema=z.string().regex(/^[a-f0-9]{64}$/);
const profileSchema=z.strictObject({version:z.literal('packet-region-runtime/1'),repo:z.string(),python:z.string(),
  purelib:z.string(),base:z.string(),repoFiles:z.array(z.string()),files:z.array(z.strictObject({path:z.string(),
    bytes:z.number().int().min(0).max(32*1024**2),sha256:hashSchema})).min(1).max(5000)});
async function verifiedProfile(){
  const file=process.env.ULPIN_PACKET_REGIONS_PROFILE,expected=process.env.ULPIN_PACKET_REGIONS_PROFILE_SHA256;
  if(!file||!isAbsolute(file)||!hashSchema.safeParse(expected).success)
    throw new AppError(503,'PACKET_REGION_RUNTIME_UNAVAILABLE','Configure a frozen private region execution profile.');
  try{
    const bytes=await readBoundedOcrArtifact(file,1024**2);
    if(sha256(bytes)!==expected)throw new Error('profile drift');
    const profile=profileSchema.parse(JSON.parse(bytes.toString('utf8')));
    if(resolve(profile.repo)!==resolve(settings.repositoryRoot)||JSON.stringify(profile.repoFiles)!==JSON.stringify(paths)||
      ![profile.repo,profile.python,profile.purelib,profile.base,...profile.files.map(v=>v.path)].every(isAbsolute)||
      profile.files.reduce((sum,v)=>sum+v.bytes,0)>512*1024**2)throw new Error('profile bounds');
    const entries=new Map(profile.files.map(v=>[resolve(v.path),v]));
    if(entries.size!==profile.files.length||!entries.has(resolve(profile.python))||
      paths.some(p=>!entries.has(resolve(profile.repo,p))))throw new Error('profile closure');
    // Validate resolved bootstrap/interpreter/cache/native bytes before Python
    // startup. The verified loader then holds read-only Windows handles and
    // compiles all subsequent Python imports from the same verified snapshots.
    for(let offset=0;offset<profile.files.length;offset+=8)await Promise.all(profile.files.slice(offset,offset+8).map(async entry=>{
      if(resolve(await realpath(entry.path))!==resolve(entry.path))throw new Error('resolved drift');
      const contents=await readBoundedOcrArtifact(entry.path,entry.bytes);
      if(contents.length!==entry.bytes||sha256(contents)!==entry.sha256)throw new Error('executable drift');
    }));
    const loader=join(profile.repo,'scripts/usp/document-models/packet_region_loader.py');
    return {file,sha256:expected!,profile,loader,loaderSha256:entries.get(resolve(loader))!.sha256};
  }catch{
    throw new AppError(503,'PACKET_REGION_EXECUTABLE_DRIFT','The frozen region runtime differs from its verified profile.');
  }
}
export async function packetRegionRecipeSha(){return (await verifiedProfile()).sha256;}
export type PacketRegionInspection={result:unknown;png:Buffer};
let blocked=false;
export function assertPacketRegionRuntime(){if(blocked)throw new AppError(503,'PACKET_REGION_CLEANUP_UNRESOLVED','Restore the owned region runtime after unresolved cleanup.');}
const executionSchema=z.object({version:z.literal('packet-region-execution/2'),seconds:z.number().int().min(1).max(25),
  memoryBytes:z.literal(limits.memoryBytes),profileSha256:hashSchema,cleanup:z.literal('confirmed'),code:z.null(),
  resultSha256:hashSchema.nullable(),worker:z.object({exitCode:z.number().int(),
    stopReason:z.enum(['runtime_cap_exceeded','log_byte_limit_exceeded','log_capture_failed','process_memory_cap_exceeded']).nullable(),
    gatedStart:z.literal(true),elapsedSeconds:z.number().finite().nonnegative().max(35),
    peakObservedRssBytes:z.number().int().nonnegative(),peakJobPrivateBytes:z.number().int().nonnegative().nullable()})});
function bootstrap(loader:string,expected:string){
  return `import sys\nif sys.pycache_prefix!=${JSON.stringify('\\\\.\\NUL')}: raise SystemExit(5)\n`+
    `sys.dont_write_bytecode=True\nimport hashlib,types\np=${JSON.stringify(loader)}\nb=open(p,'rb').read(262145)\n`+
    `if len(b)>262144 or hashlib.sha256(b).hexdigest()!=${JSON.stringify(expected)}: raise SystemExit(5)\n`+
    "m=types.ModuleType('packet_region_loader');m.__file__=p;sys.modules[m.__name__]=m\n"+
    "exec(compile(b,p,'exec'),m.__dict__)\nm.run_entry(sys.argv[1:])\n";
}
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
  const frozen=await verifiedProfile();
  if(resolve(python)!==resolve(frozen.profile.python))
    throw new AppError(503,'PACKET_REGION_EXECUTABLE_DRIFT','The selected interpreter differs from its frozen profile.');
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
    // Win32 NUL reads return no bytes. Redirect cache lookup before interpreter
    // initialization, including imports preceding the verified source finder.
    try{exit=await execute(python,['-I','-S','-B','-X','pycache_prefix=\\\\.\\NUL','-c',bootstrap(frozen.loader,frozen.loaderSha256),
      join(settings.repositoryRoot,'scripts/usp/document-models/run_packet_region.py'),
      '--source',source,'--sha256',authority.sourceSha256,'--page',String(page),'--selection',selected,
      '--output',output,'--seconds',String(seconds),'--profile',frozen.file,'--profile-sha256',frozen.sha256],
      Math.min((seconds+5)*1000,deadline-Date.now()));}
    catch{keep=true;blocked=true;throw new AppError(503,'PACKET_REGION_CLEANUP_UNRESOLVED','Region cleanup is unresolved; its private attempt was retained.');}
    let execution:z.infer<typeof executionSchema>;
    try{
      execution=executionSchema.parse(JSON.parse((await readBoundedOcrArtifact(join(output,'receipt.json'),limits.metadataBytes)).toString('utf8')));
      if(execution.seconds!==seconds||execution.profileSha256!==frozen.sha256)throw new Error('receipt mismatch');
    }catch{
      keep=true;blocked=true;
      throw new AppError(503,'PACKET_REGION_CLEANUP_UNRESOLVED','Region cleanup is unresolved; its private attempt was retained.');
    }
    if(execution.worker.stopReason!==null||execution.worker.peakObservedRssBytes>limits.memoryBytes||
      execution.worker.peakJobPrivateBytes===null||execution.worker.peakJobPrivateBytes>limits.memoryBytes)
      throw new AppError(503,'PACKET_REGION_RUNTIME_FAILED','The bounded region worker did not complete within its profile.');
    const resultBytes=await readBoundedOcrArtifact(join(output,'result.json'),limits.metadataBytes);
    const result:unknown=JSON.parse(resultBytes.toString('utf8'));
    if(execution.resultSha256!==sha256(resultBytes))
      throw new AppError(503,'PACKET_REGION_RUNTIME_FAILED','Region output differs from its supervised receipt.');
    if(exit!==0||execution.worker.exitCode!==0){
      const failure=z.strictObject({version:z.literal('packet-region-failure/1'),code:z.string().regex(/^PACKET_REGION_[A-Z_]+$/)}).safeParse(result);
      if(failure.success)throw new AppError(failure.data.code.startsWith('PACKET_REGION_RUNTIME_')?503:422,failure.data.code,
        'This exact crop is unavailable under the bounded profile. The original is retained.');
      throw new AppError(503,'PACKET_REGION_RUNTIME_FAILED','The bounded region worker failed.');
    }
    PacketRegionWorkerSchema.parse(result);
    return {result,png:await readBoundedOcrArtifact(join(output,'region.png'),limits.pngBytes)};
  }catch(error){
    if(error instanceof AppError)throw error;
    throw new AppError(503,'PACKET_REGION_RUNTIME_FAILED','The private worker did not return valid bounded artifacts.');
  }finally{if(directory&&!keep)await rm(directory,{recursive:true,force:true});}
}

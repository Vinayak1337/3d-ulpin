import {readFileSync,statSync,realpathSync,readdirSync,lstatSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {DXFToolPinsSchema,type DXFToolPins} from '@ulpin/contracts/usp';
import {settings} from '../../../infrastructure/config';
import {sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {AppError} from '../../../infrastructure/errors';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const file=z.strictObject({root:z.enum(['runtime','environment','repository']),path:z.string().min(1).max(512),
  bytes:z.number().int().nonnegative().max(64*1024*1024),sha256:hash});
const profileSchema=z.strictObject({schemaVersion:z.literal('dxf-python-profile/1'),platform:z.literal('windows-x86_64'),
  cachePolicy:z.literal('verified_bytecode_read_no_write'),repositoryRoot:z.string(),
  python:z.string(),environmentRoot:z.string(),scratchRoot:z.string(),files:z.array(file).min(1).max(10000)});
const repositorySources=['scripts/usp/dxf/server.py','scripts/usp/dxf/profile.py','scripts/usp/desktop-dxf-read.py',
  'services/geo/geo/__init__.py','services/geo/geo/native_dxf.py','services/geo/geo/native_pdf.py'];
const repositoryCacheDirectories=['scripts/usp/dxf','scripts/usp','services/geo/geo'];
export function dxfUnavailable(code='DXF_UNAVAILABLE'):never{
  throw new AppError(503,code,'Pinned local DXF reading is unavailable; original and prior outcomes remain retained.');
}
function local(path:string){if(!/^[A-Za-z]:[\\/]/.test(path))dxfUnavailable();return realpathSync(path);}
function bytes(path:string,limit:number){const s=statSync(path);if(!s.isFile()||s.size>limit)dxfUnavailable();return readFileSync(path);}
const inside=(root:string,path:string)=>{const r=relative(root,path);return !r.startsWith('..')&&!isAbsolute(r);};
export const DXF_CODE_FILES=['packages/contracts/src/usp/dxf-ingestion.ts',
  ...['dxf','dxf-config','dxf-processor','dxf-worker'].map(v=>`packages/server/src/modules/usp/ingestion/${v}.ts`),
  'packages/server/src/modules/usp/jobs.ts','packages/server/src/infrastructure/storage.ts','packages/server/src/infrastructure/db.ts'];

/** Server-only paths. Physical byte hashes are checked before all current reads/runs. */
export function dxfConfig(deadlineAt=Date.now()+20_000){
  try{
    if(process.platform!=='win32'||process.arch!=='x64')dxfUnavailable('DXF_UNSUPPORTED_PLATFORM');
    const check=()=>{if(Date.now()>=deadlineAt)dxfUnavailable('DXF_CONFIG_TIMEOUT');};
    const profilePath=local(process.env.ULPIN_DXF_PROFILE??''),data=bytes(profilePath,2*1024*1024),
      expected=hash.parse(process.env.ULPIN_DXF_PROFILE_SHA256);
    if(sha256(data)!==expected)dxfUnavailable('DXF_TOOL_CHANGED');
    const profile=profileSchema.parse(JSON.parse(data.toString('utf8'))),python=local(profile.python),
      environmentRoot=local(profile.environmentRoot),scratchRoot=local(profile.scratchRoot),runtimeRoot=realpathSync(join(python,'..')),
      repo=realpathSync(settings.repositoryRoot);
    if(local(profile.repositoryRoot)!==repo)dxfUnavailable('DXF_TOOL_CHANGED');
    if(!statSync(environmentRoot).isDirectory()||!statSync(scratchRoot).isDirectory()||inside(repo,scratchRoot)||inside(repo,runtimeRoot)||inside(repo,environmentRoot)
      ||inside(environmentRoot,scratchRoot)||inside(runtimeRoot,scratchRoot))dxfUnavailable();
    // -I -S still searches python313.zip and the executable directory. Reject
    // added archives, path/config/manifest overrides or DLLs outside this profile.
    const rootFiles=new Set(['LICENSE.txt','NEWS.txt','python.exe','pythonw.exe','python313.dll','python3.dll','vcruntime140.dll','vcruntime140_1.dll']);
    for(const name of readdirSync(runtimeRoot))if(!lstatSync(join(runtimeRoot,name)).isDirectory()&&!rootFiles.has(name))dxfUnavailable('DXF_TOOL_CHANGED');
    const actual:z.infer<typeof file>[]=[],roots={runtime:runtimeRoot,environment:environmentRoot,repository:repo};let total=0;
    const walk=(kind:keyof typeof roots,path:string)=>{
      check();const s=lstatSync(path),name=path.split(/[\\/]/).at(-1);
      if(s.isSymbolicLink())dxfUnavailable('DXF_TOOL_CHANGED');
      if(s.isDirectory()){
        if(kind==='runtime'&&name==='site-packages')return;
        for(const entry of readdirSync(path))walk(kind,join(path,entry));return;
      }
      total+=s.size;if(!s.isFile()||s.size>64*1024*1024||total>256*1024*1024||actual.length>=10000)dxfUnavailable();
      actual.push({root:kind,path:relative(roots[kind],path).replaceAll('\\','/'),bytes:s.size,sha256:sha256(bytes(path,64*1024*1024))});
    };
    for(const name of ['python.exe','python313.dll','python3.dll','vcruntime140.dll','vcruntime140_1.dll','DLLs','Lib'])walk('runtime',join(runtimeRoot,name));
    walk('environment',join(environmentRoot,'Lib/site-packages'));
    // Node verifies caches before any Python bootstrap/stdlib/helper import.
    // Repo modules are also reachable by the unchanged CLI's native child.
    for(const path of repositorySources)walk('repository',join(repo,path));
    for(const directory of repositoryCacheDirectories)for(const name of readdirSync(join(repo,directory)))
      if(name.toLowerCase()==='__pycache__'||name.toLowerCase().endsWith('.pyc'))walk('repository',join(repo,directory,name));
    const order=(a:z.infer<typeof file>,b:z.infer<typeof file>)=>Buffer.compare(Buffer.from(a.root+'/'+a.path),Buffer.from(b.root+'/'+b.path));
    if(fingerprint(actual.sort(order))!==fingerprint(profile.files))dxfUnavailable('DXF_TOOL_CHANGED');
    check();
    const readerFiles=['services/geo/geo/native_dxf.py','services/geo/geo/native_pdf.py','scripts/usp/desktop-dxf-read.py'];
    const readerSha256=sha256(Buffer.concat(readerFiles.flatMap(p=>[Buffer.from(p+'\0'),bytes(join(repo,p),1024*1024)]))),
      supervisor=join(repo,'scripts/usp/dxf/server.py'),profileHelper=join(repo,'scripts/usp/dxf/profile.py'),
      dependencyLock=join(repo,'docs/evidence/usp/native-dxf/requirements.lock');
    const pins=DXFToolPinsSchema.parse({platform:profile.platform,pythonSha256:sha256(bytes(python,16*1024*1024)),
      profileSha256:expected,readerSha256,
      supervisorSha256:sha256(Buffer.concat([bytes(supervisor,1024*1024),bytes(profileHelper,1024*1024)])),
      dependencyLockSha256:sha256(bytes(dependencyLock,64*1024)),
      codeSha256:fingerprint(DXF_CODE_FILES.map(p=>({path:p,sha256:sha256(bytes(join(repo,p),1024*1024))})))});
    return {python,environmentRoot,scratchRoot,supervisor,profilePath,pins};
  }catch(error){if(error instanceof AppError)throw error;return dxfUnavailable();}
}
export type DXFConfig=ReturnType<typeof dxfConfig>;
export function assertDXFTools(pins:DXFToolPins|null,deadlineAt?:number){
  if(!pins)dxfUnavailable();const config=dxfConfig(deadlineAt);
  if(fingerprint(config.pins)!==fingerprint(pins))dxfUnavailable('DXF_TOOL_CHANGED');return config;
}
// KML-02 immutable reads only: exact fd36a4b9 Git/LF and physical aggregates.
const preKMLReadCodeSha=new Set(['6d52384008e5aad896ec16defc76c607c905ca8e644fbb2661fd34c8285efa5c',
  '1c00e8bbbac697ff41d71ebf6f81f0b4b18ad31aba005c9724d5ce01d2f95388']);
// CITYGML-02: exact 0b209ca3 Git/LF and captured physical code; immutable reads only.
const preCityGMLReadCodeSha=new Set(["dbcfe71ae8bac243f6c3aa1b1f549b54b43535aa6c68fa743bdd552f8f897c46", "0f16979a1d9206f99d2e99358932e6f50183a517ef3efd2a0b8f6e0b53b6795f"]);
// GEOPARQUET-02: exact 409d2641 Git/LF and physical immutable-read code only.
const preGeoParquetReadCodeSha=new Set(["d6ff578327b1edc6906f862fb559f0d573507a643e551115b15ed14380cd4541", "01b22fb44f4ce88a8d372c5c8a4ffd94885da76268b4fe1fa24e3de5f2de6ad1"]);
// PACK1-PDF-04: exact 1c024959 Git/LF and captured physical code aggregates.
// Immutable reads only; current full inventory/non-code pins and strict writers remain mandatory.
const prePacketPdfReadCodeSha=new Set(["3908950565f0bf139c38d07c57b21eb5873e6acd60798457374f4e699b13c670","0dbd6d0f053968be658d456cdfb1d521e36d096244ef8bb926d91276d4d0b384"]);
export function dxfReadToolsCompatible(stored:DXFToolPins,current:DXFToolPins){
  const old=DXFToolPinsSchema.safeParse(stored),live=DXFToolPinsSchema.safeParse(current);
  if(!old.success||!live.success)return false;
  if(fingerprint(old.data)===fingerprint(live.data))return true;
  const {codeSha256:oldCode,...oldTools}=old.data,{codeSha256:_currentCode,...currentTools}=live.data;
  if(prePacketPdfReadCodeSha.has(oldCode)){
    const actualCode=fingerprint(DXF_CODE_FILES.map(path=>({path,sha256:sha256(bytes(join(settings.repositoryRoot,path),1024*1024))})));
    return live.data.codeSha256===actualCode&&fingerprint(oldTools)===fingerprint(currentTools);
  }

  return (preKMLReadCodeSha.has(oldCode)||(preCityGMLReadCodeSha.has(oldCode)||preGeoParquetReadCodeSha.has(oldCode)))&&fingerprint(oldTools)===fingerprint(currentTools);
}
/** Full current inventory before immutable result reads; never returns launch configuration. */
export function assertDXFReadTools(pins:DXFToolPins|null,deadlineAt?:number):void{
  if(!pins)dxfUnavailable();const current=dxfConfig(deadlineAt);
  if(!dxfReadToolsCompatible(pins,current.pins))dxfUnavailable('DXF_TOOL_CHANGED');
}

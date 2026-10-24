import {readFileSync,statSync,realpathSync,readdirSync,lstatSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {GeoParquetToolPinsSchema,type GeoParquetToolPins} from '../../../../../contracts/src/usp/geoparquet-ingestion';
import {settings} from '../../../infrastructure/config';
import {sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {AppError} from '../../../infrastructure/errors';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const file=z.strictObject({root:z.enum(['runtime','environment','repository']),path:z.string().min(1).max(512),
  bytes:z.number().int().nonnegative().max(64*1024*1024),sha256:hash});
const profileSchema=z.strictObject({schemaVersion:z.literal('geoparquet-python-profile/1'),platform:z.literal('windows-x86_64'),
  cachePolicy:z.literal('verified_bytecode_read_no_write'),repositoryRoot:z.string(),
  python:z.string(),environmentRoot:z.string(),scratchRoot:z.string(),files:z.array(file).min(1).max(10000)});
const repositorySources=['scripts/usp/geoparquet/server.py','scripts/usp/geoparquet/profile.py','scripts/usp/desktop-geoparquet-read.py',
  'services/geo/geo/__init__.py','services/geo/geo/native_geoparquet.py'];
const repositoryCacheDirectories=['scripts/usp/geoparquet','scripts/usp','services/geo/geo'];
export function geoparquetUnavailable(code='GEOPARQUET_UNAVAILABLE'):never{
  throw new AppError(503,code,'Pinned local GeoParquet reading is unavailable; original and prior outcomes remain retained.');
}
function local(path:string){if(!/^[A-Za-z]:[\\/]/.test(path))geoparquetUnavailable();return realpathSync(path);}
function bytes(path:string,limit:number){const s=statSync(path);if(!s.isFile()||s.size>limit)geoparquetUnavailable();return readFileSync(path);}
const inside=(root:string,path:string)=>{const r=relative(root,path);return !r.startsWith('..')&&!isAbsolute(r);};
export const GEOPARQUET_CODE_FILES=['packages/contracts/src/usp/geoparquet-ingestion.ts',
  ...['geoparquet','geoparquet-config','geoparquet-processor','geoparquet-worker'].map(v=>`packages/server/src/modules/usp/ingestion/${v}.ts`),
  'packages/server/src/modules/usp/jobs.ts','packages/server/src/infrastructure/storage.ts','packages/server/src/infrastructure/db.ts'];

/** Server-only paths. Physical byte hashes are checked before all current reads/runs. */
export function geoparquetConfig(deadlineAt=Date.now()+20_000){
  try{
    if(process.platform!=='win32'||process.arch!=='x64')geoparquetUnavailable('GEOPARQUET_UNSUPPORTED_PLATFORM');
    const check=()=>{if(Date.now()>=deadlineAt)geoparquetUnavailable('GEOPARQUET_CONFIG_TIMEOUT');};
    const profilePath=local(process.env.ULPIN_GEOPARQUET_PROFILE??''),data=bytes(profilePath,2*1024*1024),
      expected=hash.parse(process.env.ULPIN_GEOPARQUET_PROFILE_SHA256);
    if(sha256(data)!==expected)geoparquetUnavailable('GEOPARQUET_TOOL_CHANGED');
    const profile=profileSchema.parse(JSON.parse(data.toString('utf8'))),python=local(profile.python),
      environmentRoot=local(profile.environmentRoot),scratchRoot=local(profile.scratchRoot),runtimeRoot=realpathSync(join(python,'..')),
      repo=realpathSync(settings.repositoryRoot);
    if(local(profile.repositoryRoot)!==repo)geoparquetUnavailable('GEOPARQUET_TOOL_CHANGED');
    if(!statSync(environmentRoot).isDirectory()||!statSync(scratchRoot).isDirectory()||inside(repo,scratchRoot)||inside(repo,runtimeRoot)||inside(repo,environmentRoot)
      ||inside(environmentRoot,scratchRoot)||inside(runtimeRoot,scratchRoot))geoparquetUnavailable();
    // -I -S still searches python313.zip and the executable directory. Reject
    // added archives, path/config/manifest overrides or DLLs outside this profile.
    const rootFiles=new Set(['LICENSE.txt','NEWS.txt','python.exe','pythonw.exe','python313.dll','python3.dll','vcruntime140.dll','vcruntime140_1.dll']);
    for(const name of readdirSync(runtimeRoot))if(!lstatSync(join(runtimeRoot,name)).isDirectory()&&!rootFiles.has(name))geoparquetUnavailable('GEOPARQUET_TOOL_CHANGED');
    const actual:z.infer<typeof file>[]=[],roots={runtime:runtimeRoot,environment:environmentRoot,repository:repo};let total=0;
    const walk=(kind:keyof typeof roots,path:string)=>{
      check();const s=lstatSync(path),name=path.split(/[\\/]/).at(-1);
      if(s.isSymbolicLink())geoparquetUnavailable('GEOPARQUET_TOOL_CHANGED');
      if(s.isDirectory()){
        if(kind==='runtime'&&name==='site-packages')return;
        for(const entry of readdirSync(path))walk(kind,join(path,entry));return;
      }
      total+=s.size;if(!s.isFile()||s.size>64*1024*1024||total>256*1024*1024||actual.length>=10000)geoparquetUnavailable();
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
    if(fingerprint(actual.sort(order))!==fingerprint(profile.files))geoparquetUnavailable('GEOPARQUET_TOOL_CHANGED');
    check();
    const readerFiles=['services/geo/geo/native_geoparquet.py','scripts/usp/desktop-geoparquet-read.py'];
    const readerSha256=sha256(Buffer.concat(readerFiles.flatMap(p=>[Buffer.from(p+'\0'),bytes(join(repo,p),1024*1024)]))),
      supervisor=join(repo,'scripts/usp/geoparquet/server.py'),profileHelper=join(repo,'scripts/usp/geoparquet/profile.py'),
      dependencyLock=join(repo,'scripts/usp/geoparquet/runtime-lock.json');
    const pins=GeoParquetToolPinsSchema.parse({platform:profile.platform,pythonSha256:sha256(bytes(python,16*1024*1024)),
      profileSha256:expected,readerSha256,
      supervisorSha256:sha256(Buffer.concat([bytes(supervisor,1024*1024),bytes(profileHelper,1024*1024)])),
      dependencyLockSha256:sha256(bytes(dependencyLock,64*1024)),
      codeSha256:fingerprint(GEOPARQUET_CODE_FILES.map(p=>({path:p,sha256:sha256(bytes(join(repo,p),1024*1024))})))});
    return {python,environmentRoot,scratchRoot,supervisor,profilePath,pins};
  }catch(error){if(error instanceof AppError)throw error;return geoparquetUnavailable();}
}
export type GeoParquetConfig=ReturnType<typeof geoparquetConfig>;
export function assertGeoParquetTools(pins:GeoParquetToolPins|null,deadlineAt?:number){
  if(!pins)geoparquetUnavailable();const config=geoparquetConfig(deadlineAt);
  if(fingerprint(config.pins)!==fingerprint(pins))geoparquetUnavailable('GEOPARQUET_TOOL_CHANGED');return config;
}

// PACK1-PDF-04: exact 1c024959 Git/LF and captured physical code aggregates.
// Immutable reads only; current full inventory/non-code pins and strict writers remain mandatory.
const prePacketPdfReadCodeSha=new Set(["a0ab2ac38fcd794177ed6c799515243207e4beeb31b9acc583442a31c6aae0a5","5c8567e7943c564990a28fca34679c23b113806f3f99663ae493fc56375acf58"]);
// GLTF-02: exact 0311fa08 Git/LF and observed pre-glTF staging physical code.
// Immutable reads only; full current inventory/non-code pins and strict writers remain.
const preGltfReadCodeSha=new Set(["d3cbd3d803b71152a09bd00a8918bc593dbb627ffa9453f14b9ba86d71300037","0c543e85652e0ef3f74f46ac44ddd7fcf9464bc01b5f765ef6103193bb16acf5"]);
// OBJ-02 immutable reads only: exact assigned-base Git/LF and observed pre-OBJ
// physical CODEFILES in both worker checkouts/staging. Current code/non-code
// inventory remains mandatory; writers never use these aliases.
const preObjReadCodeSha=new Set(["15b55b6192ecf8345dfd05c4bc117e4d6f33288886d785e9da781f17ee796eec", "f53fa951e99f578fe39f0b9e5c5b28ec2bc5636617d81f80c3f92df06cb9f2a8", "e138d4b36cbbcb91fd9b38aae35dec86c3923ab9021189829f9ca5b0836717f9"]);
export function geoparquetReadToolsCompatible(stored:GeoParquetToolPins,current:GeoParquetToolPins){
  const old=GeoParquetToolPinsSchema.safeParse(stored),live=GeoParquetToolPinsSchema.safeParse(current);
  if(!old.success||!live.success)return false;
  if(fingerprint(old.data)===fingerprint(live.data))return true;
  const {codeSha256:oldCode,...oldTools}=old.data,{codeSha256:_currentCode,...currentTools}=live.data;
  if(prePacketPdfReadCodeSha.has(oldCode)||preGltfReadCodeSha.has(oldCode)||preObjReadCodeSha.has(oldCode)){
    const actualCode=fingerprint(GEOPARQUET_CODE_FILES.map(path=>({path,sha256:sha256(bytes(join(settings.repositoryRoot,path),1024*1024))})));
    return live.data.codeSha256===actualCode&&fingerprint(oldTools)===fingerprint(currentTools);
  }
  return false;
}
/** Immutable reads still verify every exact tool and current inventory pin. */
export function assertGeoParquetReadTools(pins:GeoParquetToolPins|null,deadlineAt?:number):void{
  if(!pins)geoparquetUnavailable();const current=geoparquetConfig(deadlineAt);
  if(!geoparquetReadToolsCompatible(pins,current.pins))geoparquetUnavailable('GEOPARQUET_TOOL_CHANGED');
}

import {readFileSync,statSync,realpathSync,readdirSync,lstatSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {IFCToolPinsSchema,type IFCToolPins} from '@ulpin/contracts/usp';
import {settings} from '../../../infrastructure/config';
import {sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {AppError} from '../../../infrastructure/errors';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const file=z.strictObject({root:z.enum(['runtime','environment','repository']),path:z.string().min(1).max(512),
  bytes:z.number().int().nonnegative().max(64*1024*1024),sha256:hash});
const profileSchema=z.strictObject({schemaVersion:z.literal('ifc-python-profile/2'),platform:z.literal('windows-x86_64'),
  cachePolicy:z.literal('verified_bytecode_read_no_write'),repositoryRoot:z.string(),
  python:z.string(),environmentRoot:z.string(),scratchRoot:z.string(),files:z.array(file).min(1).max(10000)});
const repositorySources=['scripts/usp/ifc/server.py','scripts/usp/ifc/profile.py','scripts/usp/desktop-ifc-read.py',
  'services/geo/geo/__init__.py','services/geo/geo/native_ifc.py'];
const repositoryCacheDirectories=['scripts/usp/ifc','scripts/usp','services/geo/geo'];
export function ifcUnavailable(code='IFC_UNAVAILABLE'):never{
  throw new AppError(503,code,'Pinned local IFC reading is unavailable; original and prior outcomes remain retained.');
}
function local(path:string){if(!/^[A-Za-z]:[\\/]/.test(path))ifcUnavailable();return realpathSync(path);}
function bytes(path:string,limit:number){const s=statSync(path);if(!s.isFile()||s.size>limit)ifcUnavailable();return readFileSync(path);}
const inside=(root:string,path:string)=>{const r=relative(root,path);return !r.startsWith('..')&&!isAbsolute(r);};
export const IFC_CODE_FILES=['packages/contracts/src/usp/ifc-ingestion.ts',
  ...['ifc','ifc-config','ifc-processor','ifc-worker'].map(v=>`packages/server/src/modules/usp/ingestion/${v}.ts`),
  'packages/server/src/modules/usp/jobs.ts','packages/server/src/infrastructure/storage.ts','packages/server/src/infrastructure/db.ts'];

/** Server-only paths. Physical byte hashes are checked before all current reads/runs. */
export function ifcConfig(deadlineAt=Date.now()+20_000){
  try{
    if(process.platform!=='win32'||process.arch!=='x64')ifcUnavailable('IFC_UNSUPPORTED_PLATFORM');
    const check=()=>{if(Date.now()>=deadlineAt)ifcUnavailable('IFC_CONFIG_TIMEOUT');};
    const profilePath=local(process.env.ULPIN_IFC_PROFILE??''),data=bytes(profilePath,2*1024*1024),
      expected=hash.parse(process.env.ULPIN_IFC_PROFILE_SHA256);
    if(sha256(data)!==expected)ifcUnavailable('IFC_TOOL_CHANGED');
    const profile=profileSchema.parse(JSON.parse(data.toString('utf8'))),python=local(profile.python),
      environmentRoot=local(profile.environmentRoot),scratchRoot=local(profile.scratchRoot),runtimeRoot=realpathSync(join(python,'..')),
      repo=realpathSync(settings.repositoryRoot);
    if(local(profile.repositoryRoot)!==repo)ifcUnavailable('IFC_TOOL_CHANGED');
    if(!statSync(environmentRoot).isDirectory()||!statSync(scratchRoot).isDirectory()||inside(repo,scratchRoot)||inside(repo,runtimeRoot)||inside(repo,environmentRoot)
      ||inside(environmentRoot,scratchRoot)||inside(runtimeRoot,scratchRoot))ifcUnavailable();
    // -I -S still searches python312.zip and the executable directory. Reject
    // added archives, path/config/manifest overrides or DLLs outside this profile.
    const rootFiles=new Set(['LICENSE.txt','python.exe','pythonw.exe','python312.dll','python3.dll','vcruntime140.dll','vcruntime140_1.dll']);
    for(const name of readdirSync(runtimeRoot))if(!lstatSync(join(runtimeRoot,name)).isDirectory()&&!rootFiles.has(name))ifcUnavailable('IFC_TOOL_CHANGED');
    const actual:z.infer<typeof file>[]=[],roots={runtime:runtimeRoot,environment:environmentRoot,repository:repo};let total=0;
    const walk=(kind:keyof typeof roots,path:string)=>{
      check();const s=lstatSync(path),name=path.split(/[\\/]/).at(-1);
      if(s.isSymbolicLink())ifcUnavailable('IFC_TOOL_CHANGED');
      if(s.isDirectory()){
        if(kind==='runtime'&&name==='site-packages')return;
        for(const entry of readdirSync(path))walk(kind,join(path,entry));return;
      }
      total+=s.size;if(!s.isFile()||s.size>64*1024*1024||total>256*1024*1024||actual.length>=10000)ifcUnavailable();
      actual.push({root:kind,path:relative(roots[kind],path).replaceAll('\\','/'),bytes:s.size,sha256:sha256(bytes(path,64*1024*1024))});
    };
    for(const name of ['python.exe','python312.dll','python3.dll','vcruntime140.dll','vcruntime140_1.dll','DLLs','Lib'])walk('runtime',join(runtimeRoot,name));
    walk('environment',join(environmentRoot,'Lib/site-packages'));
    // Node verifies caches before any Python bootstrap/stdlib/helper import.
    // Repo modules are also reachable by the unchanged CLI's native child.
    for(const path of repositorySources)walk('repository',join(repo,path));
    for(const directory of repositoryCacheDirectories)for(const name of readdirSync(join(repo,directory)))
      if(name.toLowerCase()==='__pycache__'||name.toLowerCase().endsWith('.pyc'))walk('repository',join(repo,directory,name));
    const order=(a:z.infer<typeof file>,b:z.infer<typeof file>)=>Buffer.compare(Buffer.from(a.root+'/'+a.path),Buffer.from(b.root+'/'+b.path));
    if(fingerprint(actual.sort(order))!==fingerprint(profile.files))ifcUnavailable('IFC_TOOL_CHANGED');
    check();
    const readerFiles=['services/geo/geo/native_ifc.py','scripts/usp/desktop-ifc-read.py'];
    const readerSha256=sha256(Buffer.concat(readerFiles.flatMap(p=>[Buffer.from(p+'\0'),bytes(join(repo,p),1024*1024)]))),
      supervisor=join(repo,'scripts/usp/ifc/server.py'),profileHelper=join(repo,'scripts/usp/ifc/profile.py'),
      dependencyLock=join(repo,'docs/evidence/usp/native-ifc/requirements-win-py312.lock');
    const pins=IFCToolPinsSchema.parse({platform:profile.platform,pythonSha256:sha256(bytes(python,16*1024*1024)),
      profileSha256:expected,readerSha256,
      supervisorSha256:sha256(Buffer.concat([bytes(supervisor,1024*1024),bytes(profileHelper,1024*1024)])),
      dependencyLockSha256:sha256(bytes(dependencyLock,64*1024)),
      codeSha256:fingerprint(IFC_CODE_FILES.map(p=>({path:p,sha256:sha256(bytes(join(repo,p),1024*1024))})))});
    return {python,environmentRoot,scratchRoot,supervisor,profilePath,pins};
  }catch(error){if(error instanceof AppError)throw error;return ifcUnavailable();}
}
export type IFCConfig=ReturnType<typeof ifcConfig>;
export function assertIFCTools(pins:IFCToolPins|null,deadlineAt?:number){
  if(!pins)ifcUnavailable();const config=ifcConfig(deadlineAt);
  if(fingerprint(config.pins)!==fingerprint(pins))ifcUnavailable('IFC_TOOL_CHANGED');return config;
}
// DXF-02 immutable reads only: exact cfc679fd Git/LF and physical aggregates.
// No unknown aggregate, changed non-code pin or missing current runtime qualifies.
const preDXFReadCodeSha=new Set(['c7d6d9b23fd9334079868b046907cd9bc3d0c3efb2f298552b409e113279aa1a',
  '16ccbbfd5ece82bf8f5fff15799e7cc448df371ed4de67a3cb1e7934c6aa8db8']);
// KML-02: fd36a4b9 exact Git/LF and captured physical pre-KML constituents.
const preKMLReadCodeSha=new Set(['a441e6ac5d3947e4f267e63494685fada870384c6850c8c205dc8870ea0b68c8',
  '3bd4f09e8a4bdfd2963e2e6c0ff735cdb423c3405e06694755f1f017bb585ac0']);
export function ifcReadToolsCompatible(stored:IFCToolPins,current:IFCToolPins){
  const old=IFCToolPinsSchema.safeParse(stored),live=IFCToolPinsSchema.safeParse(current);
  if(!old.success||!live.success)return false;
  if(fingerprint(old.data)===fingerprint(live.data))return true;
  const {codeSha256:oldCode,...oldTools}=old.data,{codeSha256:_currentCode,...currentTools}=live.data;
  return (preDXFReadCodeSha.has(oldCode)||preKMLReadCodeSha.has(oldCode))&&fingerprint(oldTools)===fingerprint(currentTools);
}
/** Verify the complete current inventory before immutable-result read comparison.
 * Returns no process configuration: writers must continue using assertIFCTools. */
export function assertIFCReadTools(pins:IFCToolPins|null,deadlineAt?:number):void{
  if(!pins)ifcUnavailable();const current=ifcConfig(deadlineAt);
  if(!ifcReadToolsCompatible(pins,current.pins))ifcUnavailable('IFC_TOOL_CHANGED');
}

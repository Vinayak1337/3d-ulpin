import {readFileSync,statSync,realpathSync,readdirSync,lstatSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {KMLToolPinsSchema,type KMLToolPins} from '../../../../../contracts/src/usp/kml-ingestion';
import {settings} from '../../../infrastructure/config';
import {sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {AppError} from '../../../infrastructure/errors';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const file=z.strictObject({root:z.enum(['runtime','environment','repository']),path:z.string().min(1).max(512),
  bytes:z.number().int().nonnegative().max(64*1024*1024),sha256:hash});
const profileSchema=z.strictObject({schemaVersion:z.literal('kml-python-profile/1'),platform:z.literal('windows-x86_64'),
  cachePolicy:z.literal('verified_bytecode_read_no_write'),repositoryRoot:z.string(),
  python:z.string(),environmentRoot:z.string(),scratchRoot:z.string(),files:z.array(file).min(1).max(10000)});
const repositorySources=['scripts/usp/kml/server.py','scripts/usp/kml/profile.py','scripts/usp/desktop-kml-read.py',
  'services/geo/geo/__init__.py','services/geo/geo/native_kml.py'];
const repositoryCacheDirectories=['scripts/usp/kml','scripts/usp','services/geo/geo'];
export function kmlUnavailable(code='KML_UNAVAILABLE'):never{
  throw new AppError(503,code,'Pinned local KML reading is unavailable; original and prior outcomes remain retained.');
}
function local(path:string){if(!/^[A-Za-z]:[\\/]/.test(path))kmlUnavailable();return realpathSync(path);}
function bytes(path:string,limit:number){const s=statSync(path);if(!s.isFile()||s.size>limit)kmlUnavailable();return readFileSync(path);}
const inside=(root:string,path:string)=>{const r=relative(root,path);return !r.startsWith('..')&&!isAbsolute(r);};
export const KML_CODE_FILES=['packages/contracts/src/usp/kml-ingestion.ts',
  ...['kml','kml-config','kml-processor','kml-worker'].map(v=>`packages/server/src/modules/usp/ingestion/${v}.ts`),
  'packages/server/src/modules/usp/jobs.ts','packages/server/src/infrastructure/storage.ts','packages/server/src/infrastructure/db.ts'];

/** Server-only paths. Physical byte hashes are checked before all current reads/runs. */
export function kmlConfig(deadlineAt=Date.now()+20_000){
  try{
    if(process.platform!=='win32'||process.arch!=='x64')kmlUnavailable('KML_UNSUPPORTED_PLATFORM');
    const check=()=>{if(Date.now()>=deadlineAt)kmlUnavailable('KML_CONFIG_TIMEOUT');};
    const profilePath=local(process.env.ULPIN_KML_PROFILE??''),data=bytes(profilePath,2*1024*1024),
      expected=hash.parse(process.env.ULPIN_KML_PROFILE_SHA256);
    if(sha256(data)!==expected)kmlUnavailable('KML_TOOL_CHANGED');
    const profile=profileSchema.parse(JSON.parse(data.toString('utf8'))),python=local(profile.python),
      environmentRoot=local(profile.environmentRoot),scratchRoot=local(profile.scratchRoot),runtimeRoot=realpathSync(join(python,'..')),
      repo=realpathSync(settings.repositoryRoot);
    if(local(profile.repositoryRoot)!==repo)kmlUnavailable('KML_TOOL_CHANGED');
    if(!statSync(environmentRoot).isDirectory()||!statSync(scratchRoot).isDirectory()||inside(repo,scratchRoot)||inside(repo,runtimeRoot)||inside(repo,environmentRoot)
      ||inside(environmentRoot,scratchRoot)||inside(runtimeRoot,scratchRoot))kmlUnavailable();
    // -I -S still searches python313.zip and the executable directory. Reject
    // added archives, path/config/manifest overrides or DLLs outside this profile.
    const rootFiles=new Set(['LICENSE.txt','NEWS.txt','python.exe','pythonw.exe','python313.dll','python3.dll','vcruntime140.dll','vcruntime140_1.dll']);
    for(const name of readdirSync(runtimeRoot))if(!lstatSync(join(runtimeRoot,name)).isDirectory()&&!rootFiles.has(name))kmlUnavailable('KML_TOOL_CHANGED');
    const actual:z.infer<typeof file>[]=[],roots={runtime:runtimeRoot,environment:environmentRoot,repository:repo};let total=0;
    const walk=(kind:keyof typeof roots,path:string)=>{
      check();const s=lstatSync(path),name=path.split(/[\\/]/).at(-1);
      if(s.isSymbolicLink())kmlUnavailable('KML_TOOL_CHANGED');
      if(s.isDirectory()){
        if(kind==='runtime'&&name==='site-packages')return;
        for(const entry of readdirSync(path))walk(kind,join(path,entry));return;
      }
      total+=s.size;if(!s.isFile()||s.size>64*1024*1024||total>256*1024*1024||actual.length>=10000)kmlUnavailable();
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
    if(fingerprint(actual.sort(order))!==fingerprint(profile.files))kmlUnavailable('KML_TOOL_CHANGED');
    check();
    const readerFiles=['services/geo/geo/native_kml.py','scripts/usp/desktop-kml-read.py'];
    const readerSha256=sha256(Buffer.concat(readerFiles.flatMap(p=>[Buffer.from(p+'\0'),bytes(join(repo,p),1024*1024)]))),
      supervisor=join(repo,'scripts/usp/kml/server.py'),profileHelper=join(repo,'scripts/usp/kml/profile.py'),
      dependencyLock=join(repo,'docs/evidence/usp/native-kml/requirements.lock');
    const pins=KMLToolPinsSchema.parse({platform:profile.platform,pythonSha256:sha256(bytes(python,16*1024*1024)),
      profileSha256:expected,readerSha256,
      supervisorSha256:sha256(Buffer.concat([bytes(supervisor,1024*1024),bytes(profileHelper,1024*1024)])),
      dependencyLockSha256:sha256(bytes(dependencyLock,64*1024)),
      codeSha256:fingerprint(KML_CODE_FILES.map(p=>({path:p,sha256:sha256(bytes(join(repo,p),1024*1024))})))});
    return {python,environmentRoot,scratchRoot,supervisor,profilePath,pins};
  }catch(error){if(error instanceof AppError)throw error;return kmlUnavailable();}
}
export type KMLConfig=ReturnType<typeof kmlConfig>;
export function assertKMLTools(pins:KMLToolPins|null,deadlineAt?:number){
  if(!pins)kmlUnavailable();const config=kmlConfig(deadlineAt);
  if(fingerprint(config.pins)!==fingerprint(pins))kmlUnavailable('KML_TOOL_CHANGED');return config;
}

// CITYGML-02: exact assigned-base immutable code compatibility; writers stay strict.
const preCityGMLReadCodeSha=new Set(["fabb23dcf90b0a0f5af81a258538f3202c56260ddc2a92d8a23cb3b6375b885d", "c41f64137609c74fd2f8f04247df9b8d49fa84d34bc2c780b39ba9c72f80cf13"]);
// GEOPARQUET-02: exact 409d2641 Git/LF and physical immutable-read code only.
const preGeoParquetReadCodeSha=new Set(["5c4d50085d0b16ae656c35b6684f6a81eba6cd83728f9fe7d34562847ff2ec41", "a80fef5011b91c23dfb28bc201a0a1c1432f03b38e01a522d5038672b25d7c61"]);
// PACK1-PDF-04: exact 1c024959 Git/LF and captured physical code aggregates.
// Immutable reads only; current full inventory/non-code pins and strict writers remain mandatory.
const prePacketPdfReadCodeSha=new Set(["6c1573a0a4ad3dc9561064444681121e73a956b10673d5627c9b621c5b3c363e","9c480acf3d7b0dd38f966b228835bbf141b50b7e650e04cbfbc26c1d8a746ab3"]);
export function kmlReadToolsCompatible(stored:KMLToolPins,current:KMLToolPins){
  const old=KMLToolPinsSchema.safeParse(stored),live=KMLToolPinsSchema.safeParse(current);
  if(!old.success||!live.success)return false;
  if(fingerprint(old.data)===fingerprint(live.data))return true;
  const {codeSha256:oldCode,...oldTools}=old.data,{codeSha256:_currentCode,...currentTools}=live.data;
  if(prePacketPdfReadCodeSha.has(oldCode)){
    const actualCode=fingerprint(KML_CODE_FILES.map(path=>({path,sha256:sha256(bytes(join(settings.repositoryRoot,path),1024*1024))})));
    return live.data.codeSha256===actualCode&&fingerprint(oldTools)===fingerprint(currentTools);
  }

  return (preCityGMLReadCodeSha.has(oldCode)||preGeoParquetReadCodeSha.has(oldCode))&&fingerprint(oldTools)===fingerprint(currentTools);
}
/** Full inventory remains mandatory; no process configuration is returned. */
export function assertKMLReadTools(pins:KMLToolPins|null,deadlineAt?:number):void{
  if(!pins)kmlUnavailable();const current=kmlConfig(deadlineAt);
  if(!kmlReadToolsCompatible(pins,current.pins))kmlUnavailable('KML_TOOL_CHANGED');
}

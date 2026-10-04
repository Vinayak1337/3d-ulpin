import {readFileSync,statSync,realpathSync,readdirSync,lstatSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {CityGMLToolPinsSchema,type CityGMLToolPins} from '../../../../../contracts/src/usp/citygml-ingestion';
import {settings} from '../../../infrastructure/config';
import {sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {AppError} from '../../../infrastructure/errors';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const file=z.strictObject({root:z.enum(['runtime','environment','repository']),path:z.string().min(1).max(512),
  bytes:z.number().int().nonnegative().max(64*1024*1024),sha256:hash});
const profileSchema=z.strictObject({schemaVersion:z.literal('citygml-python-profile/1'),platform:z.literal('windows-x86_64'),
  cachePolicy:z.literal('verified_bytecode_read_no_write'),repositoryRoot:z.string(),
  python:z.string(),environmentRoot:z.string(),scratchRoot:z.string(),files:z.array(file).min(1).max(10000)});
const repositorySources=['scripts/usp/citygml/server.py','scripts/usp/citygml/profile.py','scripts/usp/desktop-citygml-read.py',
  'services/geo/geo/__init__.py','services/geo/geo/native_citygml.py'];
const repositoryCacheDirectories=['scripts/usp/citygml','scripts/usp','services/geo/geo'];
export function citygmlUnavailable(code='CITYGML_UNAVAILABLE'):never{
  throw new AppError(503,code,'Pinned local CityGML reading is unavailable; original and prior outcomes remain retained.');
}
function local(path:string){if(!/^[A-Za-z]:[\\/]/.test(path))citygmlUnavailable();return realpathSync(path);}
function bytes(path:string,limit:number){const s=statSync(path);if(!s.isFile()||s.size>limit)citygmlUnavailable();return readFileSync(path);}
const inside=(root:string,path:string)=>{const r=relative(root,path);return !r.startsWith('..')&&!isAbsolute(r);};
export const CITYGML_CODE_FILES=['packages/contracts/src/usp/citygml-ingestion.ts',
  ...['citygml','citygml-config','citygml-processor','citygml-worker'].map(v=>`packages/server/src/modules/usp/ingestion/${v}.ts`),
  'packages/server/src/modules/usp/jobs.ts','packages/server/src/infrastructure/storage.ts','packages/server/src/infrastructure/db.ts'];

/** Server-only paths. Physical byte hashes are checked before all current reads/runs. */
export function citygmlConfig(deadlineAt=Date.now()+20_000){
  try{
    if(process.platform!=='win32'||process.arch!=='x64')citygmlUnavailable('CITYGML_UNSUPPORTED_PLATFORM');
    const check=()=>{if(Date.now()>=deadlineAt)citygmlUnavailable('CITYGML_CONFIG_TIMEOUT');};
    const profilePath=local(process.env.ULPIN_CITYGML_PROFILE??''),data=bytes(profilePath,2*1024*1024),
      expected=hash.parse(process.env.ULPIN_CITYGML_PROFILE_SHA256);
    if(sha256(data)!==expected)citygmlUnavailable('CITYGML_TOOL_CHANGED');
    const profile=profileSchema.parse(JSON.parse(data.toString('utf8'))),python=local(profile.python),
      environmentRoot=local(profile.environmentRoot),scratchRoot=local(profile.scratchRoot),runtimeRoot=realpathSync(join(python,'..')),
      repo=realpathSync(settings.repositoryRoot);
    if(local(profile.repositoryRoot)!==repo)citygmlUnavailable('CITYGML_TOOL_CHANGED');
    if(!statSync(environmentRoot).isDirectory()||!statSync(scratchRoot).isDirectory()||inside(repo,scratchRoot)||inside(repo,runtimeRoot)||inside(repo,environmentRoot)
      ||inside(environmentRoot,scratchRoot)||inside(runtimeRoot,scratchRoot))citygmlUnavailable();
    // -I -S still searches python313.zip and the executable directory. Reject
    // added archives, path/config/manifest overrides or DLLs outside this profile.
    const rootFiles=new Set(['LICENSE.txt','NEWS.txt','python.exe','pythonw.exe','python313.dll','python3.dll','vcruntime140.dll','vcruntime140_1.dll']);
    for(const name of readdirSync(runtimeRoot))if(!lstatSync(join(runtimeRoot,name)).isDirectory()&&!rootFiles.has(name))citygmlUnavailable('CITYGML_TOOL_CHANGED');
    const actual:z.infer<typeof file>[]=[],roots={runtime:runtimeRoot,environment:environmentRoot,repository:repo};let total=0;
    const walk=(kind:keyof typeof roots,path:string)=>{
      check();const s=lstatSync(path),name=path.split(/[\\/]/).at(-1);
      if(s.isSymbolicLink())citygmlUnavailable('CITYGML_TOOL_CHANGED');
      if(s.isDirectory()){
        if(kind==='runtime'&&name==='site-packages')return;
        for(const entry of readdirSync(path))walk(kind,join(path,entry));return;
      }
      total+=s.size;if(!s.isFile()||s.size>64*1024*1024||total>256*1024*1024||actual.length>=10000)citygmlUnavailable();
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
    if(fingerprint(actual.sort(order))!==fingerprint(profile.files))citygmlUnavailable('CITYGML_TOOL_CHANGED');
    check();
    const readerFiles=['services/geo/geo/native_citygml.py','scripts/usp/desktop-citygml-read.py'];
    const readerSha256=sha256(Buffer.concat(readerFiles.flatMap(p=>[Buffer.from(p+'\0'),bytes(join(repo,p),1024*1024)]))),
      supervisor=join(repo,'scripts/usp/citygml/server.py'),profileHelper=join(repo,'scripts/usp/citygml/profile.py'),
      dependencyLock=join(repo,'scripts/usp/citygml/runtime-lock.json');
    const pins=CityGMLToolPinsSchema.parse({platform:profile.platform,pythonSha256:sha256(bytes(python,16*1024*1024)),
      profileSha256:expected,readerSha256,
      supervisorSha256:sha256(Buffer.concat([bytes(supervisor,1024*1024),bytes(profileHelper,1024*1024)])),
      dependencyLockSha256:sha256(bytes(dependencyLock,64*1024)),
      codeSha256:fingerprint(CITYGML_CODE_FILES.map(p=>({path:p,sha256:sha256(bytes(join(repo,p),1024*1024))})))});
    return {python,environmentRoot,scratchRoot,supervisor,profilePath,pins};
  }catch(error){if(error instanceof AppError)throw error;return citygmlUnavailable();}
}
export type CityGMLConfig=ReturnType<typeof citygmlConfig>;
export function assertCityGMLTools(pins:CityGMLToolPins|null,deadlineAt?:number){
  if(!pins)citygmlUnavailable();const config=citygmlConfig(deadlineAt);
  if(fingerprint(config.pins)!==fingerprint(pins))citygmlUnavailable('CITYGML_TOOL_CHANGED');return config;
}

// GEOPARQUET-02: exact assigned-base immutable code; full inventory and non-code pins remain mandatory.
const preGeoParquetReadCodeSha=new Set(["e9d559731bfc4a37a4f7388427f80c7c88df40a5286746d1d078f2ffb7fee308", "319041a906b31bca05e1386c992e5a5ca8bad15062930d9b9ab0880e8074408d"]);
// PACK1-PDF-04: exact 1c024959 Git/LF and captured physical code aggregates.
// Immutable reads only; current full inventory/non-code pins and strict writers remain mandatory.
const prePacketPdfReadCodeSha=new Set(["bdc3ae2758db333894aed1c4a664829c7e3f67ad6331982adaef16d7fc66be78","f6533370a70cb15c86b424e334eef6fad20d050ad0572f7c387772d6b5abd14c"]);
// GLTF-02: exact 0311fa08 Git/LF and observed pre-glTF staging physical code.
// Immutable reads only; full current inventory/non-code pins and strict writers remain.
const preGltfReadCodeSha=new Set(["0d98f4d86b8118a9029d72ecb23e330f28aaa2167424ee7b49b7308e3a0ef181","07ff9352c85b53d5ca2a13df21182e93607e2b93d4ae3e7aa6cf16adcf5518fd"]);
// OBJ-02 immutable reads only: exact assigned-base Git/LF and observed pre-OBJ
// physical CODEFILES in both worker checkouts/staging. Current code/non-code
// inventory remains mandatory; writers never use these aliases.
const preObjReadCodeSha=new Set(["3ecd27225165fcb1bd5b76e9037c4792a35c9a15c79ad55647002e2026c7e1d5", "8310d1e8abd384dda09ccbdf5ba9d7836f189f34d9d4c250aaa7cf1f6e5fc2a3", "f353a0f10904b4e272660fe9da70005d9419e613581c475b1d08d93a2a221943"]);
export function citygmlReadToolsCompatible(stored:CityGMLToolPins,current:CityGMLToolPins){
 const old=CityGMLToolPinsSchema.safeParse(stored),live=CityGMLToolPinsSchema.safeParse(current);
 if(!old.success||!live.success)return false;
 if(fingerprint(old.data)===fingerprint(live.data))return true;
 const {codeSha256:oldCode,...oldTools}=old.data,{codeSha256:_currentCode,...currentTools}=live.data;
  if(prePacketPdfReadCodeSha.has(oldCode)||preGltfReadCodeSha.has(oldCode)||preObjReadCodeSha.has(oldCode)){
    const actualCode=fingerprint(CITYGML_CODE_FILES.map(path=>({path,sha256:sha256(bytes(join(settings.repositoryRoot,path),1024*1024))})));
    return live.data.codeSha256===actualCode&&fingerprint(oldTools)===fingerprint(currentTools);
  }

 return preGeoParquetReadCodeSha.has(oldCode)&&fingerprint(oldTools)===fingerprint(currentTools);
}
/** Complete current inventory, immutable comparison only, never launch configuration. */
export function assertCityGMLReadTools(pins:CityGMLToolPins|null,deadlineAt?:number):void{
 if(!pins)citygmlUnavailable();const config=citygmlConfig(deadlineAt);
 if(!citygmlReadToolsCompatible(pins,config.pins))citygmlUnavailable('CITYGML_TOOL_CHANGED');
}

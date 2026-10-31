import {readFileSync,statSync,realpathSync,readdirSync,lstatSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {GltfToolPinsSchema,type GltfToolPins} from '../../../../../contracts/src/usp/gltf-ingestion';
import {settings} from '../../../infrastructure/config';
import {sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {AppError} from '../../../infrastructure/errors';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const file=z.strictObject({root:z.enum(['runtime','environment','repository']),path:z.string().min(1).max(512),
  bytes:z.number().int().nonnegative().max(64*1024*1024),sha256:hash});
const profileSchema=z.strictObject({schemaVersion:z.literal('gltf-python-profile/1'),platform:z.literal('windows-x86_64'),
  cachePolicy:z.literal('verified_bytecode_read_no_write'),repositoryRoot:z.string(),
  python:z.string(),environmentRoot:z.string(),scratchRoot:z.string(),files:z.array(file).min(1).max(10000)});
const repositorySources=['scripts/usp/gltf/server.py','scripts/usp/gltf/profile.py','scripts/usp/desktop-gltf-read.py',
  'services/geo/geo/__init__.py','services/geo/geo/native_gltf.py'];
const repositoryCacheDirectories=['scripts/usp/gltf','scripts/usp','services/geo/geo'];
export function gltfUnavailable(code='GLTF_UNAVAILABLE'):never{
  throw new AppError(503,code,'Pinned local Gltf reading is unavailable; original and prior outcomes remain retained.');
}
function local(path:string){if(!/^[A-Za-z]:[\\/]/.test(path))gltfUnavailable();return realpathSync(path);}
function bytes(path:string,limit:number){const s=statSync(path);if(!s.isFile()||s.size>limit)gltfUnavailable();return readFileSync(path);}
const inside=(root:string,path:string)=>{const r=relative(root,path);return !r.startsWith('..')&&!isAbsolute(r);};
export const GLTF_CODE_FILES=['packages/contracts/src/usp/gltf-ingestion.ts','packages/contracts/src/reader-limits.ts',
  ...['gltf','gltf-config','gltf-processor','gltf-worker','gltf-companions'].map(v=>`packages/server/src/modules/usp/ingestion/${v}.ts`),
  'packages/server/src/modules/usp/jobs.ts','packages/server/src/infrastructure/storage.ts','packages/server/src/infrastructure/db.ts'];

/** Server-only paths. Physical byte hashes are checked before all current reads/runs. */
export function gltfConfig(deadlineAt=Date.now()+20_000){
  try{
    if(process.platform!=='win32'||process.arch!=='x64')gltfUnavailable('GLTF_UNSUPPORTED_PLATFORM');
    const check=()=>{if(Date.now()>=deadlineAt)gltfUnavailable('GLTF_CONFIG_TIMEOUT');};
    const profilePath=local(process.env.ULPIN_GLTF_PROFILE??''),data=bytes(profilePath,2*1024*1024),
      expected=hash.parse(process.env.ULPIN_GLTF_PROFILE_SHA256);
    if(sha256(data)!==expected)gltfUnavailable('GLTF_TOOL_CHANGED');
    const profile=profileSchema.parse(JSON.parse(data.toString('utf8'))),python=local(profile.python),
      environmentRoot=local(profile.environmentRoot),scratchRoot=local(profile.scratchRoot),runtimeRoot=realpathSync(join(python,'..')),
      repo=realpathSync(settings.repositoryRoot);
    if(local(profile.repositoryRoot)!==repo)gltfUnavailable('GLTF_TOOL_CHANGED');
    if(!statSync(environmentRoot).isDirectory()||!statSync(scratchRoot).isDirectory()||inside(repo,scratchRoot)||inside(repo,runtimeRoot)||inside(repo,environmentRoot)
      ||inside(environmentRoot,scratchRoot)||inside(runtimeRoot,scratchRoot))gltfUnavailable();
    // -I -S still searches python313.zip and the executable directory. Reject
    // added archives, path/config/manifest overrides or DLLs outside this profile.
    const rootFiles=new Set(['LICENSE.txt','NEWS.txt','python.exe','pythonw.exe','python313.dll','python3.dll','vcruntime140.dll','vcruntime140_1.dll']);
    for(const name of readdirSync(runtimeRoot))if(!lstatSync(join(runtimeRoot,name)).isDirectory()&&!rootFiles.has(name))gltfUnavailable('GLTF_TOOL_CHANGED');
    const actual:z.infer<typeof file>[]=[],roots={runtime:runtimeRoot,environment:environmentRoot,repository:repo};let total=0;
    const walk=(kind:keyof typeof roots,path:string)=>{
      check();const s=lstatSync(path),name=path.split(/[\\/]/).at(-1);
      if(s.isSymbolicLink())gltfUnavailable('GLTF_TOOL_CHANGED');
      if(s.isDirectory()){
        if(kind==='runtime'&&name==='site-packages')return;
        for(const entry of readdirSync(path))walk(kind,join(path,entry));return;
      }
      total+=s.size;if(!s.isFile()||s.size>64*1024*1024||total>256*1024*1024||actual.length>=10000)gltfUnavailable();
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
    if(fingerprint(actual.sort(order))!==fingerprint(profile.files))gltfUnavailable('GLTF_TOOL_CHANGED');
    check();
    const readerFiles=['services/geo/geo/native_gltf.py','scripts/usp/desktop-gltf-read.py'];
    const readerSha256=sha256(Buffer.concat(readerFiles.flatMap(p=>[Buffer.from(p+'\0'),bytes(join(repo,p),1024*1024)]))),
      supervisor=join(repo,'scripts/usp/gltf/server.py'),profileHelper=join(repo,'scripts/usp/gltf/profile.py'),
      dependencyLock=join(repo,'scripts/usp/gltf/runtime-lock.json');
    const pins=GltfToolPinsSchema.parse({platform:profile.platform,pythonSha256:sha256(bytes(python,16*1024*1024)),
      profileSha256:expected,readerSha256,
      supervisorSha256:sha256(Buffer.concat([bytes(supervisor,1024*1024),bytes(profileHelper,1024*1024)])),
      dependencyLockSha256:sha256(bytes(dependencyLock,64*1024)),
      codeSha256:fingerprint(GLTF_CODE_FILES.map(p=>({path:p,sha256:sha256(bytes(join(repo,p),1024*1024))})))});
    const nonRepositorySha256=fingerprint(actual.filter(entry=>entry.root!=='repository'));
    return {python,environmentRoot,scratchRoot,supervisor,profilePath,pins,nonRepositorySha256};
  }catch(error){if(error instanceof AppError)throw error;return gltfUnavailable();}
}
export type GltfConfig=ReturnType<typeof gltfConfig>;
export function assertGltfTools(pins:GltfToolPins|null,deadlineAt?:number){
  if(!pins)gltfUnavailable();const config=gltfConfig(deadlineAt);
  if(fingerprint(config.pins)!==fingerprint(pins))gltfUnavailable('GLTF_TOOL_CHANGED');return config;
}

// OBJ-02 immutable reads only: exact assigned-base Git/LF and observed pre-OBJ
// physical CODEFILES in both worker checkouts/staging. Current code/non-code
// inventory remains mandatory; writers never use these aliases.
const preObjReadCodeSha=new Set(["a65e70ab797791693b65d0d23c42389fe10248856022a1d9264210301908ba3b", "0dd2070c9001591fad9263e06203bc8d3f316f0277db8fb4552a9464a918514d", "a50cf2e380ad19770783ce9708ff76e10d90f68ab00962706b3a579dbfa060a2"]);
// GB2: reviewed immutable reads from the pre-buffer profile only. The current full
// inventory is still verified by gltfConfig; these pins never authorize a new run.
export const GLTF_PRE_BUFFER_READER_SHA='92035c6c891d4e7c0e7a74a7c1980e9f0489d29f7046eadb639d9b6311ed9097';
const preBufferReadTools:GltfToolPins={platform:'windows-x86_64',readerSha256:GLTF_PRE_BUFFER_READER_SHA,
  pythonSha256:'d932e5e2f324d57f392e8fd063dcf6d0185be8a664c57c6d24e7762ed02c28ca',
  profileSha256:'f9c7ec3af52ecb52f838aeb6e67777ebb399e83030e8dc1bac89720b6151a576',
  supervisorSha256:'d3352a4dacc78f81f704a38c93976dec196112a1b8e915d0a4c0d075c8e5b339',
  dependencyLockSha256:'4ff0c1de1f2eeffbf7f76abba947718f684006ce032f113af039280915388f6e',
  codeSha256:'b3fe20ae29f1f9c8a210fd644be02838b879db0d56cd3093c7cf0f76b96140d1'};
// The old profile's runtime/environment inventory (2,518 entries), excluding repository files.
const preBufferNonRepositorySha='9697c86123f94e2fd04db7e8bccc7f6b840a96785ed04eb301de01c68c7ebc46';
// GB1 physical CRLF and Git/LF native reader bytes; the CLI is intentionally CRLF in both.
const bufferReadTransitions=new Map([
  ['832ce7792d863e27957634ec19a11354f6a28f715b442bc0e7c9121b2ab8e6b5',
    '35830e260b81df2ba147194c92608e18fff193376e982442314dcff12b2ee126'],
  ['bb4ed225ac0ade6395dd8f3da62ca4ebb1d16dfa8939f9e0211799e95d71cef6',
    'e96b8d93376d49efce413123e2cbf1653e45ce2853780366124f4b56325dc79e'],
]);
/** Provisional input comparison only; gltfSummary must also check the retained buffers. */
export function gltfReadReaderCompatible(stored:string,current:string,tools:GltfToolPins|null){
  return stored===current||(stored===GLTF_PRE_BUFFER_READER_SHA&&bufferReadTransitions.has(current)
    &&fingerprint(tools)===fingerprint(preBufferReadTools));
}
export function gltfReadToolsCompatible(stored:GltfToolPins,current:GltfToolPins,nonRepositorySha256?:string){
  const old=GltfToolPinsSchema.safeParse(stored),live=GltfToolPinsSchema.safeParse(current);
  if(!old.success||!live.success)return false;
  if(fingerprint(old.data)===fingerprint(live.data))return true;
  const {codeSha256:oldCode,...oldTools}=old.data,{codeSha256:_currentCode,...currentTools}=live.data;
  const preBuffer=fingerprint(old.data)===fingerprint(preBufferReadTools)
    &&nonRepositorySha256===preBufferNonRepositorySha
    &&bufferReadTransitions.get(live.data.readerSha256)===live.data.supervisorSha256
    &&live.data.pythonSha256===old.data.pythonSha256&&live.data.dependencyLockSha256===old.data.dependencyLockSha256;
  if(!preBuffer&&!preObjReadCodeSha.has(oldCode))return false;
  const actualCode=fingerprint(GLTF_CODE_FILES.map(path=>({path,sha256:sha256(bytes(join(settings.repositoryRoot,path),1024*1024))})));
  return live.data.codeSha256===actualCode&&(preBuffer||fingerprint(oldTools)===fingerprint(currentTools));
}
/** Complete current profile first; comparison only, never launch configuration. */
export function assertGltfReadTools(pins:GltfToolPins|null,deadlineAt?:number):void{
  if(!pins)gltfUnavailable();const current=gltfConfig(deadlineAt);
  if(!gltfReadToolsCompatible(pins,current.pins,current.nonRepositorySha256))gltfUnavailable('GLTF_TOOL_CHANGED');
}

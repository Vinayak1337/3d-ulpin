import {readFileSync,statSync,realpathSync} from 'node:fs';
import {isAbsolute,join,relative,resolve} from 'node:path';
import {z} from 'zod';
import {CityJSONValidatorPinsSchema,CITYJSON_VALIDATION_LIMITS} from '@ulpin/contracts';
import {settings} from '../../infrastructure/config';
import {AppError} from '../../infrastructure/errors';
import {sha256} from '../../infrastructure/storage';
import {fingerprint} from '../cases/domain';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const tool=z.object({version:z.string().max(30),files:z.array(z.strictObject({path:z.string().min(1).max(512),sha256:hash,executable:z.boolean()})).min(1).max(8)});
const lockSchema=z.object({schemaVersion:z.literal('cityjson-validity-tools/1'),platform:z.literal('windows-x86_64'),
  tools:z.strictObject({cjval:tool,val3dity:tool})});
export function validationUnavailable(code='CITYJSON_VALIDATION_UNAVAILABLE'):never{
  throw new AppError(503,code,'Pinned local validation is unavailable; original and previous outcomes are retained.');
}
function configured(name:string){const value=process.env[name];if(!value||!isAbsolute(value))validationUnavailable();return realpathSync(value);}
function bytes(path:string,limit:number){if(!statSync(path).isFile()||statSync(path).size>limit)validationUnavailable();return readFileSync(path);}
/** Paths are server configuration only. Verify actual physical bytes, including checkout line endings. */
export function cityjsonValidationConfig(){
  try{
    if(process.platform!=='win32'||process.arch!=='x64')validationUnavailable('CITYJSON_VALIDATION_UNSUPPORTED_PLATFORM');
    const python=configured('ULPIN_CITYJSON_VALIDATOR_PYTHON'),toolsRoot=configured('ULPIN_CITYJSON_VALIDATOR_TOOLS_ROOT'),
      scratchRoot=configured('ULPIN_CITYJSON_VALIDATOR_SCRATCH_ROOT');
    if(!statSync(toolsRoot).isDirectory()||!statSync(scratchRoot).isDirectory())validationUnavailable();
    const repo=realpathSync(settings.repositoryRoot),scratchRelative=relative(repo,scratchRoot);
    if(!scratchRelative.startsWith('..')&&!isAbsolute(scratchRelative))validationUnavailable();
    const expectedPython=hash.parse(process.env.ULPIN_CITYJSON_VALIDATOR_PYTHON_SHA256),pythonSha256=sha256(bytes(python,100*1024*1024));
    if(pythonSha256!==expectedPython)validationUnavailable('CITYJSON_VALIDATION_TOOL_CHANGED');
    const adapter=join(repo,'scripts/usp/cityjson-validity/validate.py'),supervisor=join(repo,'scripts/usp/cityjson-validity/server.py'),
      toolLock=join(repo,'scripts/usp/cityjson-validity/tools.json'),lockBytes=bytes(toolLock,64*1024),lock=lockSchema.parse(JSON.parse(lockBytes.toString('utf8')));
    const tools=Object.entries(lock.tools).map(([name,pin])=>({name,version:pin.version,files:pin.files.map(file=>{
      if(isAbsolute(file.path))validationUnavailable();
      const path=realpathSync(resolve(toolsRoot,file.path)),rel=relative(toolsRoot,path);
      if(rel.startsWith('..')||isAbsolute(rel)||sha256(bytes(path,100*1024*1024))!==file.sha256)validationUnavailable('CITYJSON_VALIDATION_TOOL_CHANGED');
      return {sha256:file.sha256,executable:file.executable};
    })}));
    const codeFiles=['packages/contracts/src/registry-cityjson-validation.ts',
      'packages/server/src/modules/registry/cityjson-draft.ts',
      ...['config','processor','worker'].map(v=>`packages/server/src/modules/registry/cityjson-validation-${v}.ts`),
      'packages/server/src/modules/registry/cityjson-validation.ts',
      'packages/server/src/modules/usp/jobs.ts','packages/server/src/infrastructure/storage.ts'];
    const pins=CityJSONValidatorPinsSchema.parse({platform:lock.platform,pythonSha256,
      adapterSha256:sha256(bytes(adapter,1024*1024)),supervisorSha256:sha256(bytes(supervisor,1024*1024)),
      toolLockSha256:sha256(lockBytes),tools,codeSha256:fingerprint(codeFiles.map(file=>({file,sha256:sha256(bytes(join(repo,file),1024*1024))}))),
      configSha256:fingerprint({python,toolsRoot,scratchRoot,expectedPython,limits:CITYJSON_VALIDATION_LIMITS,
        environment:'isolated-python;systemroot-only;no-PATH;no-credentials',parameters:{snap_tol:1e-12,planarity_d2p_tol:0.01,planarity_n_tol:20,overlap_tol:0}})});
    return {python,toolsRoot,scratchRoot,adapter,supervisor,pins};
  }catch(error){if(error instanceof AppError)throw error;return validationUnavailable();}
}
export type CityJSONValidationConfig=ReturnType<typeof cityjsonValidationConfig>;

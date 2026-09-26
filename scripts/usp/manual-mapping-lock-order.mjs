/** Start only the targeted concurrency check with a verified, isolated environment. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertUspIsolation, assertLocalOperatorProcess } from './local-isolation.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const bare=Object.fromEntries(['HOME','PATH','USER','LOGNAME','TMPDIR','SHELL','LANG'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
try {
  const dir=realpathSync(process.argv[2]||'');assert(dir.startsWith(realpathSync(join(root,'.runtime/run01'))+'/'));
  const env=JSON.parse(readFileSync(join(dir,'run.env.json'),'utf8')),ownership=JSON.parse(readFileSync(join(dir,'ownership.json'),'utf8'));
  assert.equal(env.ULPIN_ISOLATION_PROFILE,'local-nest');
  const scope=assertUspIsolation(env);assert.deepEqual(ownership.operatorProvenance,assertLocalOperatorProcess(env));
  assert.equal(ownership.checkout,root);assert.equal(ownership.project,scope.project);assert.equal(ownership.nonce,env.ULPIN_LOCAL_NONCE);
  const git=args=>execFileSync('git',args,{cwd:root,env:bare,encoding:'utf8',timeout:5000}).trim();
  assert.equal(git(['rev-parse','HEAD']),ownership.baseCommit);assert.equal(git(['status','--porcelain','--untracked-files=no']),'');
  assert(!existsSync(join(root,'.env')));assert(!existsSync(join(dir,'manual-lock-order.json')),'Use a fresh targeted receipt.');
  const result=execFileSync('pnpm',['exec','tsx','scripts/usp/manual-mapping-lock-order.ts',dir],{cwd:root,env:{...bare,...env},encoding:'utf8',timeout:120000});
  console.log(result.trim());
} catch(error) {console.error(error.message);process.exitCode=1;}

/** RUN-01 Nest runtime preparation. Phase 1: service actions stay disabled. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, realpathSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertUspIsolation } from './local-isolation.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = join(root, '.runtime', 'run01');
// Change this only after the integrated Nest foundation and intake contracts are reviewed.
const RUNTIME_ENABLED = false;
const ports = [25432, 29000, 29001, 26379, 28000, 3188];
const allowed = ['HOME', 'PATH', 'USER', 'LOGNAME', 'TMPDIR', 'SHELL', 'LANG'];
const context = process.platform === 'darwin' ? 'colima-ulpin' : 'default';
const secret = () => randomBytes(32).toString('hex');
const bare = () => Object.fromEntries(allowed.filter(k => process.env[k]).map(k => [k, process.env[k]]));
const redacted = (value, env={}) => {
  let result = String(value);
  for (const key of ['DATABASE_URL', 'POSTGRES_PASSWORD', 'S3_SECRET_KEY', 'GEO_SERVICE_TOKEN'])
    if (env[key]) result = result.replaceAll(env[key], '[redacted]');
  return result.replaceAll(/[a-f0-9]{64}/g, '[redacted]');
};
const runFile = (dir) => join(dir, 'run.env.json');
function config(dir) {
  const path = realpathSync(dir);
  assert(path.startsWith(realpathSync(base) + '/'), 'run directory must be inside .runtime/run01');
  const env = JSON.parse(readFileSync(runFile(path), 'utf8'));
  assert.equal(env.ULPIN_ISOLATION_PROFILE, 'local-nest');
  let scope;
  try {scope=assertUspIsolation(env);}
  catch {throw new Error('private run configuration failed isolation validation');}
  assert.equal(scope.project, `ulpin-usptest-${env.ULPIN_LOCAL_NONCE}`);
  const ownership=JSON.parse(readFileSync(join(path,'ownership.json'),'utf8'));
  assert.equal(ownership.project,scope.project);
  assert.equal(ownership.nonce,env.ULPIN_LOCAL_NONCE);
  assert.equal(ownership.checkout,root);
  assert.match(ownership.baseCommit,/^[a-f0-9]{40}$/);
  return {dir:path, env, scope, ownership};
}
function command(executable, args, env, opts={}) {
  try { return execFileSync(executable, args, {cwd:root, env:{...bare(),...env}, encoding:'utf8', timeout:opts.timeout??300000, stdio:['ignore','pipe','pipe']}).trim(); }
  catch (error) { throw new Error(`${executable} failed: ${redacted((error.stdout||'')+'\n'+(error.stderr||''),env).slice(-1300)}`); }
}
function compose(c, args, options={}) {
  return command('docker', ['compose','--project-directory', root, '--env-file', join(c.dir,'compose.env'), '-p', c.scope.project, '-f', join(root,'compose.yaml'), '-f', join(c.dir,'override.json'), ...args], c.env, options);
}
async function free(port) {
  await new Promise((ok, bad) => { const server=createServer();server.once('error',bad);server.listen(port,'127.0.0.1',()=>server.close(ok)); });
}
function processAlive(pid, nonce) {
  if (!Number.isInteger(pid) || pid < 2) return false;
  try {
    const line=command('ps',['-p',String(pid),'-o','pgid=','-o','command='],{}, {timeout:3000});
    const match=line.match(/^(\d+)\s+(.+)$/);
    return !!match && Number(match[1])===pid && match[2].includes(`ULPIN_RUN_NONCE=${nonce} pnpm `);
  }
  catch { return false; }
}
function launch(c, label, args) {
  assert(args.every(arg=>/^[A-Za-z0-9@/:._-]+$/.test(arg)),'unsafe pnpm argument');
  assert(!processAlive(pid(c,label),c.env.ULPIN_LOCAL_NONCE),`${label} is already running for this nonce`);
  const log = openSync(join(c.dir,`${label}.log`),'a',0o600);
  const child=spawn('/bin/sh',['-c',`ULPIN_RUN_NONCE=${c.env.ULPIN_LOCAL_NONCE} pnpm ${args.join(' ')} & wait`],{cwd:root,env:{...bare(),...c.env,ULPIN_FIXTURE_ROOT:join(root,'fixtures')},detached:true,stdio:['ignore',log,log]});
  closeSync(log);
  assert(child.pid,`${label} process did not start`);
  // A stopped nonce may be resumed; replace only its stale PID after ownership check.
  writeFileSync(join(c.dir,`${label}.pid`),String(child.pid)+'\n',{mode:0o600});
  child.unref();
  return child.pid;
}
const pid = (c,label) => {const path=join(c.dir,`${label}.pid`);return existsSync(path)?Number(readFileSync(path,'utf8').trim()):null;};
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function waitHealth(c, seconds=150) {
  const end=Date.now()+seconds*1000;
  const required=['database','storage','processor','redis','worker'];
  while (Date.now()<end) {
    assert(processAlive(pid(c,'api'),c.env.ULPIN_LOCAL_NONCE),'owned Nest API process exited before health became ready');
    assert(processAlive(pid(c,'dispatcher'),c.env.ULPIN_LOCAL_NONCE),'owned dispatcher exited before health became ready');
    try {const r=await fetch(c.env.ULPIN_TEST_URL+'api/v1/health',{signal:AbortSignal.timeout(2000)});if(r.ok){const j=await r.json();if(j.ok===true&&required.every(key=>j.services?.[key]===true))return j;}}catch{}
    await delay(1500);
  }
  throw new Error('Nest API did not report every required service ready before deadline');
}
async function prepare() {
  assert(!existsSync(join(root,'.env')), 'root .env is present; refuse to select linked configuration');
  assert.equal(command('git',['status','--porcelain','--untracked-files=no'],{}),'','runtime checkout must have no tracked edits');
  const nonce=randomBytes(8).toString('hex'), dir=join(base,nonce);
  mkdirSync(join(dir,'models'),{recursive:true,mode:0o700});chmodSync(dir,0o700);
  const project=`ulpin-usptest-${nonce}`, database=`ulpin_usptest_${nonce}`, password=secret(), s3Secret=secret();
  const env={REPO_DATA:'false',ULPIN_ISOLATION_PROFILE:'local-nest',DOCKER_CONTEXT:context,ULPIN_LOCAL_NONCE:nonce,ULPIN_BASELINE_PROJECT:project,
    POSTGRES_DB:database,POSTGRES_USER:'ulpin_usptest',POSTGRES_PASSWORD:password,POSTGRES_PORT:'25432',DATABASE_URL:`postgresql://ulpin_usptest:${password}@127.0.0.1:25432/${database}`,
    S3_ACCESS_KEY:'ulpin_usptest',S3_SECRET_KEY:s3Secret,S3_BUCKET:project,S3_ENDPOINT:'http://127.0.0.1:29000',S3_REGION:'us-east-1',S3_PORT:'29000',S3_CONSOLE_PORT:'29001',
    REDIS_URL:'redis://127.0.0.1:26379/0',REDIS_PORT:'26379',GEO_URL:'http://127.0.0.1:28000',GEO_PORT:'28000',GEO_SERVICE_TOKEN:secret(),
    HOST:'127.0.0.1',PORT:'3188',ULPIN_LOOPBACK_PORTS:'3188',ULPIN_TEST_URL:'http://127.0.0.1:3188/'};
  assertUspIsolation(env);
  writeFileSync(runFile(dir),JSON.stringify(env),{flag:'wx',mode:0o600});
  writeFileSync(join(dir,'compose.env'),Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{flag:'wx',mode:0o600});
  const tag=`ulpin-geo:run01-${nonce}`;
  writeFileSync(join(dir,'override.json'),JSON.stringify({services:{geo:{image:tag,volumes:[`${join(dir,'models')}:/models:ro`]},worker:{image:tag,volumes:[`${join(dir,'models')}:/models:ro`]}}}),{flag:'wx',mode:0o600});
  writeFileSync(join(dir,'ownership.json'),JSON.stringify({project,nonce,checkout:root,createdAt:new Date().toISOString(),baseCommit:command('git',['rev-parse','HEAD'],{})},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(dir);
}
async function start(dir, resume=false) {
  const c=config(dir);
  assert(!existsSync(join(root,'.env')),'root .env is present; refuse to select linked configuration');
  assert.equal(command('git',['rev-parse','HEAD'],{}),c.ownership.baseCommit,'checkout changed since prepare');
  assert.equal(command('git',['status','--porcelain','--untracked-files=no'],{}),'','runtime checkout has tracked edits');
  const apiPackage=JSON.parse(readFileSync(join(root,'apps/api/package.json'),'utf8'));
  assert.equal(apiPackage.name,'@ulpin/api','independent Nest package is required');
  assert(apiPackage.scripts?.start,'Nest package start script is required');
  assert.equal(command('docker',['context','show'],{}),context,'unexpected Docker context');
  const existing=command('docker',['volume','ls','--format','{{.Name}}','--filter',`label=com.docker.compose.project=${c.scope.project}`],c.env);
  if (!resume) assert(!existing,'nonce project already has volumes; use resume only after verifying ownership');
  else assert(existing,'resume requires this nonce\'s preserved named volumes');
  for (const port of ports) await free(port);
  console.log(`Starting ${c.scope.project}; all published ports bound to 127.0.0.1.`);
  try {
    compose(c,['up','-d','--wait','postgres','minio','redis']);
    compose(c,['run','--rm','minio-init']);
    command('pnpm',['db:migrate'],c.env,{timeout:180000});
    compose(c,['--profile','app','up','-d','--build','--wait','geo','worker'],{timeout:600000});
    launch(c,'dispatcher',['dispatcher']);
    launch(c,'api',['--filter','@ulpin/api','start']);
    const health=await waitHealth(c);
    console.log(JSON.stringify({project:c.scope.project,url:c.env.ULPIN_TEST_URL,services:health.services,dataMode:health.dataMode,dispatcherPid:pid(c,'dispatcher'),apiPid:pid(c,'api')}));
  } catch (error) {
    try { await stop(c.dir); }
    catch (cleanupError) { throw new AggregateError([error,cleanupError],'startup and owned cleanup failed; inspect private run logs'); }
    throw error;
  }
}
function status(dir) {
  const c=config(dir);
  const containers=compose(c,['--profile','app','ps','--format','json'],{timeout:15000});
  const ids=containers.split('\n').filter(Boolean).map(line=>{try {const x=JSON.parse(line);return {name:x.Name,state:x.State,ports:x.Publishers?.map(p=>`${p.URL}:${p.PublishedPort}`).filter(Boolean)}}catch{return {unparsed:true}}});
  const processes=Object.fromEntries(['api','dispatcher'].map(label=>{const processId=pid(c,label);return [label,{pid:processId,ownedAlive:processAlive(processId,c.env.ULPIN_LOCAL_NONCE)}]}));
  console.log(JSON.stringify({project:c.scope.project,containers:ids,processes}));
}
async function recovery(dir) {
  const c=config(dir), url=c.env.ULPIN_TEST_URL+'api/v1/health';
  assert(!existsSync(join(c.dir,'recovery.json')),'recovery receipt already exists for this run');
  const before=await waitHealth(c,20);
  let degraded;
  compose(c,['--profile','app','stop','geo'],{timeout:30000});
  try {
    await new Promise(r=>setTimeout(r,1000));
    const response=await fetch(url,{signal:AbortSignal.timeout(5000)});
    degraded=await response.json();
    assert.equal(degraded.ok,false,'health must not claim ready while owned processor is stopped');
    assert.equal(degraded.services.processor,false);
  } finally {
    compose(c,['--profile','app','start','geo'],{timeout:45000});
  }
  const after=await waitHealth(c,60);
  const result={before:before.services,degraded:degraded.services,after:after.services};
  writeFileSync(join(c.dir,'recovery.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify(result));
}
async function stop(dir) {
  const c=config(dir);
  const remaining=[];
  for (const label of ['api','dispatcher']) {
    const processId=pid(c,label);
    if (!processAlive(processId,c.env.ULPIN_LOCAL_NONCE)) continue;
    try {process.kill(-processId,'SIGTERM');}
    catch (error) {if(error.code!=='ESRCH')remaining.push(label);}
  }
  for (let attempt=0;attempt<20;attempt++) {
    if (['api','dispatcher'].every(label=>!processAlive(pid(c,label),c.env.ULPIN_LOCAL_NONCE))) break;
    await delay(250);
  }
  for (const label of ['api','dispatcher'])
    if (processAlive(pid(c,label),c.env.ULPIN_LOCAL_NONCE)) remaining.push(label);
  // Include the app profile so Compose also stops the owned geo and worker containers.
  compose(c,['--profile','app','down','--remove-orphans'],{timeout:120000});
  assert.equal(remaining.length,0,`owned process groups still running: ${remaining.join(', ')}`);
  console.log(`Stopped ${c.scope.project}; named volumes preserved.`);
}
const [action,dir]=process.argv.slice(2);
try {
  if (!RUNTIME_ENABLED) throw new Error('RUN-01 Nest runtime actions are gated pending integrated foundation and intake review; no service action was taken.');
  if(action==='prepare'&&!dir)await prepare();
  else if(action==='start'&&dir)await start(dir);
  else if(action==='resume'&&dir)await start(dir,true);
  else if(action==='status'&&dir)status(dir);
  else if(action==='recovery'&&dir)await recovery(dir);
  else if(action==='stop'&&dir)await stop(dir);
  else throw new Error('Usage: real-source-runtime.mjs prepare | start|resume|status|recovery|stop <private-run-directory>');
} catch(error) {
  try {const env=RUNTIME_ENABLED&&dir?JSON.parse(readFileSync(runFile(dir),'utf8')):{};
    const message=error instanceof AggregateError ? `${error.message}: ${error.errors.map(item=>item.message).join('; ')}` : error.message;
    console.error(redacted(message,env));}
  catch {console.error('RUN-01 failed; inspect the private run directory. Credentials withheld.');}
  process.exitCode=1;
}

/** Archived RUN-01 work in progress: not a qualified runtime entrypoint.
 * The architecture migration supersedes this Next-based runner. The original
 * draft is preserved in Git history. Keep execution disabled until its isolation,
 * app-profile shutdown and source-to-job lifecycle have been reviewed.
 */
throw new Error('RUN-01 is paused for backend extraction; this preserved draft is not enabled. No runtime action was taken.');

/** RUN-01: fresh nonce-owned local services. No snapshot, seed, provider, or volume reset. */
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
const ports = [25432, 29000, 29001, 26379, 28000, 3000];
const allowed = ['HOME', 'PATH', 'USER', 'LOGNAME', 'TMPDIR', 'SHELL', 'LANG'];
const platform = process.platform === 'darwin' ? 'local-colima' : 'local-docker';
const context = process.platform === 'darwin' ? 'colima-ulpin' : 'default';
const secret = () => randomBytes(32).toString('hex');
const bare = () => Object.fromEntries(allowed.filter(k => process.env[k]).map(k => [k, process.env[k]]));
const redacted = (value, env) => Object.values(env).filter(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)).reduce((s, v) => s.replaceAll(v, '[redacted]'), String(value));
const runFile = (dir) => join(dir, 'run.env.json');
function config(dir) {
  const path = realpathSync(dir);
  assert(path.startsWith(realpathSync(base) + '/'), 'run directory must be inside .runtime/run01');
  const env = JSON.parse(readFileSync(runFile(path), 'utf8'));
  const scope = assertUspIsolation(env);
  assert.equal(scope.project, `ulpin-usptest-${env.ULPIN_LOCAL_NONCE}`);
  return {dir:path, env, scope};
}
function command(executable, args, env, opts={}) {
  try { return execFileSync(executable, args, {cwd:root, env:{...bare(),...env}, encoding:'utf8', timeout:opts.timeout??300000, stdio:['ignore','pipe','pipe']}).trim(); }
  catch (error) { throw new Error(`${executable} ${args.filter(a=>!a.includes('PASSWORD')&&!a.includes('SECRET')).join(' ')} failed: ${redacted((error.stdout||'')+'\n'+(error.stderr||''),env).slice(-1300)}`); }
}
function compose(c, args, options={}) {
  return command('docker-compose', ['--project-directory', root, '--env-file', join(c.dir,'compose.env'), '-p', c.scope.project, '-f', join(root,'compose.yaml'), '-f', join(c.dir,'override.json'), ...args], c.env, options);
}
async function free(port) {
  await new Promise((ok, bad) => { const server=createServer();server.once('error',bad);server.listen(port,'127.0.0.1',()=>server.close(ok)); });
}
function processAlive(pid, nonce) {
  if (!Number.isInteger(pid) || pid < 2) return false;
  try { return command('ps',['-p',String(pid),'-o','command='],{}, {timeout:3000}).includes(`ULPIN_RUN_NONCE=${nonce}`); }
  catch { return false; }
}
function launch(c, label, args) {
  const log = openSync(join(c.dir,`${label}.log`),'a',0o600);
  const child=spawn('/bin/sh',['-c',`ULPIN_RUN_NONCE=${c.env.ULPIN_LOCAL_NONCE} pnpm ${args.join(' ')} & wait`],{cwd:root,env:{...bare(),...c.env,ULPIN_FIXTURE_ROOT:join(root,'fixtures')},detached:true,stdio:['ignore',log,log]});
  closeSync(log);
  writeFileSync(join(c.dir,`${label}.pid`),String(child.pid)+'\n',{mode:0o600});
  child.unref();
  return child.pid;
}
async function waitHealth(url, seconds=150) {
  const end=Date.now()+seconds*1000;
  while (Date.now()<end) {
    try {const r=await fetch(url,{signal:AbortSignal.timeout(2000)});if(r.ok){const j=await r.json();if(j.ok&&Object.values(j.services).every(Boolean))return j;}}catch{}
    await new Promise(r=>setTimeout(r,1500));
  }
  throw new Error('application health did not report all services ready before deadline');
}
async function prepare() {
  assert(!existsSync(join(root,'.env')), 'root .env is present; refuse to select linked configuration');
  const nonce=randomBytes(8).toString('hex'), dir=join(base,nonce);
  mkdirSync(join(dir,'models'),{recursive:true,mode:0o700});chmodSync(dir,0o700);
  const project=`ulpin-usptest-${nonce}`, database=`ulpin_usptest_${nonce}`, password=secret(), s3Secret=secret();
  const env={REPO_DATA:'false',ULPIN_ISOLATION_PROFILE:platform,DOCKER_CONTEXT:context,ULPIN_LOCAL_NONCE:nonce,ULPIN_BASELINE_PROJECT:project,
    POSTGRES_DB:database,POSTGRES_USER:'ulpin_usptest',POSTGRES_PASSWORD:password,POSTGRES_PORT:'25432',DATABASE_URL:`postgresql://ulpin_usptest:${password}@127.0.0.1:25432/${database}`,
    S3_ACCESS_KEY:'ulpin_usptest',S3_SECRET_KEY:s3Secret,S3_BUCKET:project,S3_ENDPOINT:'http://127.0.0.1:29000',S3_REGION:'us-east-1',S3_PORT:'29000',S3_CONSOLE_PORT:'29001',
    REDIS_URL:'redis://127.0.0.1:26379/0',REDIS_PORT:'26379',GEO_URL:'http://127.0.0.1:28000',GEO_PORT:'28000',GEO_SERVICE_TOKEN:secret(),ULPIN_TEST_URL:'http://127.0.0.1:3000/',NEXT_TELEMETRY_DISABLED:'1'};
  assertUspIsolation(env);
  writeFileSync(runFile(dir),JSON.stringify(env),{flag:'wx',mode:0o600});
  writeFileSync(join(dir,'compose.env'),Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{flag:'wx',mode:0o600});
  const tag=`ulpin-geo:run01-${nonce}`;
  writeFileSync(join(dir,'override.json'),JSON.stringify({services:{geo:{image:tag,volumes:[`${join(dir,'models')}:/models:ro`]},worker:{image:tag,volumes:[`${join(dir,'models')}:/models:ro`]}}}),{flag:'wx',mode:0o600});
  writeFileSync(join(dir,'ownership.json'),JSON.stringify({project,nonce,createdAt:new Date().toISOString(),baseCommit:command('git',['rev-parse','HEAD'],{})},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(dir);
}
async function start(dir, resume=false) {
  const c=config(dir);
  assert(!existsSync(join(root,'.env')),'root .env is present; refuse to select linked configuration');
  assert.equal(command('docker',['context','show'],{}),context,'unexpected Docker context');
  const existing=command('docker',['volume','ls','--format','{{.Name}}','--filter',`label=com.docker.compose.project=${c.scope.project}`],c.env);
  if (!resume) assert(!existing,'nonce project already has volumes; use resume only after verifying ownership');
  for (const port of ports) await free(port);
  console.log(`Starting ${c.scope.project}; all published ports bound to 127.0.0.1.`);
  try {
    compose(c,['up','-d','--wait','postgres','minio','redis']);
    compose(c,['run','--rm','minio-init']);
    command('pnpm',['db:migrate'],c.env,{timeout:180000});
    compose(c,['--profile','app','up','-d','--build','--wait','geo','worker'],{timeout:600000});
    launch(c,'dispatcher',['dispatcher']);
    launch(c,'web',['--filter','@ulpin/web','dev']);
    const health=await waitHealth(c.env.ULPIN_TEST_URL+'api/v1/health');
    console.log(JSON.stringify({project:c.scope.project,url:c.env.ULPIN_TEST_URL,services:health.services,dataMode:health.dataMode,dispatcherPid:Number(readFileSync(join(c.dir,'dispatcher.pid'))),webPid:Number(readFileSync(join(c.dir,'web.pid')))}));
  } catch (error) {
    try { stop(c.dir); } catch { /* preserve the original startup failure; volumes remain */ }
    throw error;
  }
}
function status(dir) {
  const c=config(dir);
  const containers=compose(c,['ps','--format','json'],{timeout:15000});
  const ids=containers.split('\n').filter(Boolean).map(line=>{try {const x=JSON.parse(line);return {name:x.Name,state:x.State,ports:x.Publishers?.map(p=>`${p.URL}:${p.PublishedPort}`).filter(Boolean)}}catch{return {unparsed:true}}});
  const processes=Object.fromEntries(['web','dispatcher'].map(label=>{const p=join(c.dir,`${label}.pid`),pid=existsSync(p)?Number(readFileSync(p,'utf8')):null;return [label,{pid,ownedAlive:processAlive(pid,c.env.ULPIN_LOCAL_NONCE)}]}));
  console.log(JSON.stringify({project:c.scope.project,containers:ids,processes}));
}
async function recovery(dir) {
  const c=config(dir), url=c.env.ULPIN_TEST_URL+'api/v1/health';
  const before=await waitHealth(url,20);
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
  const after=await waitHealth(url,60);
  const result={before:before.services,degraded:degraded.services,after:after.services};
  writeFileSync(join(c.dir,'recovery.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(result));
}
function stop(dir) {
  const c=config(dir);
  for (const label of ['web','dispatcher']) {const p=join(c.dir,`${label}.pid`);if(!existsSync(p))continue;const pid=Number(readFileSync(p,'utf8'));if(processAlive(pid,c.env.ULPIN_LOCAL_NONCE)){process.kill(-pid,'SIGTERM');console.log(`Stopped owned ${label} group ${pid}.`);}}
  compose(c,['down','--remove-orphans'],{timeout:120000});
  console.log(`Stopped ${c.scope.project}; named volumes preserved.`);
}
const [action,dir]=process.argv.slice(2);
try {
  if(action==='prepare'&&!dir)await prepare();
  else if(action==='start'&&dir)await start(dir);
  else if(action==='resume'&&dir)await start(dir,true);
  else if(action==='status'&&dir)status(dir);
  else if(action==='recovery'&&dir)await recovery(dir);
  else if(action==='stop'&&dir)stop(dir);
  else throw new Error('Usage: real-source-runtime.mjs prepare | start|resume|status|recovery|stop <private-run-directory>');
} catch(error) {
  try {const env=dir?JSON.parse(readFileSync(runFile(dir),'utf8')):{};console.error(redacted(error.message,env));}
  catch {console.error('RUN-01 failed; inspect the private run directory. Credentials withheld.');}
  process.exitCode=1;
}

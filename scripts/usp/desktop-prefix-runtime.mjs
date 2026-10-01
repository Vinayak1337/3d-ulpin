/** Guarded adoption of a restored, worker-owned Windows prefix-ingestion profile. */
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {existsSync, openSync, closeSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertLocalOperatorProcess, assertUspIsolation} from './local-isolation.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const image='ulpin-geo:desktop-ai03c-b10ec8c';
const labels=['api','dispatcher'];
const bareKeys=['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'];
const ocrKeys=['ULPIN_DOCUMENT_OCR_PYTHON','ULPIN_DOCUMENT_OCR_MODELS','ULPIN_DOCUMENT_OCR_TESSERACT',
  'ULPIN_DOCUMENT_OCR_TESSDATA','ULPIN_DOCUMENT_OCR_SCRATCH'];
const validatorKeys=['ULPIN_CITYJSON_VALIDATOR_PYTHON','ULPIN_CITYJSON_VALIDATOR_PYTHON_SHA256',
  'ULPIN_CITYJSON_VALIDATOR_TOOLS_ROOT','ULPIN_CITYJSON_VALIDATOR_SCRATCH_ROOT'];
const safeEnv=env=>Object.fromEntries([...bareKeys.map(key=>[key,process.env[key]]),
  ...ocrKeys.map(key=>[key,process.env[key]]),...validatorKeys.map(key=>[key,process.env[key]]),...Object.entries(env),
  ['ULPIN_FIXTURE_ROOT',join(root,'fixtures')]].filter(([,value])=>typeof value==='string'));
function command(file,args,env={},timeout=300000){
  try{return execFileSync(file,args,{cwd:root,env:safeEnv(env),encoding:'utf8',timeout,stdio:['ignore','pipe','pipe']}).trim();}
  catch(error){
    let detail=String(error.stderr||error.stdout||'').slice(-1200);
    for(const key of ['DATABASE_URL','POSTGRES_PASSWORD','S3_SECRET_KEY','GEO_SERVICE_TOKEN'])
      if(env[key])detail=detail.replaceAll(env[key],'[redacted]');
    detail=detail.replaceAll(/[a-f0-9]{64}/g,'[redacted]');
    throw new Error(`${basename(file)} failed (${error.status??'unknown'}): ${detail}`);
  }
}
function docker(c,args,timeout){return command('docker',['--context',c.env.DOCKER_CONTEXT,...args],c.env,timeout);}
function compose(c,args,timeout){return docker(c,['compose','--project-directory',root,'--env-file',join(c.dir,'compose.env'),
  '-p',c.project,'-f',join(c.dir,'compose.json'),'-f',join(c.dir,'desktop-ai03c-app.compose.json'),...args],timeout);}
function config(dir){
  assert.equal(process.platform,'win32','this adoption runner is Windows-only');
  const path=realpathSync(dir);
  assert.equal(basename(path),'prefix-worker-20260929','unexpected restored profile directory');
  const env=JSON.parse(readFileSync(join(path,'run.env.json'),'utf8'));
  const scope=assertUspIsolation(env);
  assert.equal(env.ULPIN_ISOLATION_PROFILE,'local-nest');
  assert.equal(env.DOCKER_CONTEXT,'desktop-linux');
  assert.equal(env.API_PORT,'3192');
  assert.equal(env.ULPIN_MODEL_GATEWAY_ENABLED,'0','model gateway must remain disabled');
  assertLocalOperatorProcess(env);
  const owner=JSON.parse(readFileSync(join(path,'ownership.json'),'utf8'));
  const restored=JSON.parse(readFileSync(join(path,'restore-completed.json'),'utf8'));
  assert.equal(owner.profile,'prefix-worker');
  assert.equal(restored.profile,'prefix-worker');
  assert.equal(owner.project,scope.project);
  assert.equal(owner.project,'ulpin-usptest-b050544f3d2cb99e');
  assert.equal(owner.operatorSubject,env.ULPIN_LOCAL_OPERATOR_SUBJECT);
  assert.equal(restored.processingStarted,false);
  for(const [service,volume] of Object.entries({postgres:'postgres-data',minio:'minio-data',redis:'redis-data'}))
    assert.equal(owner.volumes[service],`${scope.project}_${volume}`);
  assert(!existsSync(join(root,'.env')),'root .env could select linked credentials');
  assert.equal(docker({env},['context','show']),'desktop-linux');
  const services=JSON.parse(readFileSync(join(path,'compose.json'),'utf8')).services;
  assert.deepEqual(Object.keys(services).sort(),['minio','postgres','redis']);
  for(const service of ['postgres','minio','redis']){
    const name=`${scope.project}-${service}-1`;
    const metadata=JSON.parse(docker({env},['inspect',name]))[0];
    assert.equal(metadata.Config.Labels['com.docker.compose.project'],scope.project);
    assert.equal(metadata.Config.Labels['com.docker.compose.service'],service);
    assert.equal(metadata.State.Running,true,`${service} must already be running`);
    assert(metadata.Mounts.some(m=>m.Name===owner.volumes[service]),`${service} restored volume missing`);
  }
  return {dir:path,env,project:scope.project};
}
function appCompose(c){
  const geoEnv={GEO_SERVICE_TOKEN:'${GEO_SERVICE_TOKEN:?}',REDIS_URL:'redis://redis:6379/0',
    S3_ENDPOINT:'http://minio:9000',S3_ACCESS_KEY:'${S3_ACCESS_KEY:?}',S3_SECRET_KEY:'${S3_SECRET_KEY:?}',
    S3_BUCKET:'${S3_BUCKET:?}',S3_REGION:'${S3_REGION:?}',ML_MODEL_DIR:'/models'};
  const health={test:['CMD','python','-c',"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"],interval:'5s',timeout:'5s',retries:20};
  return {services:{geo:{image,environment:geoEnv,ports:['127.0.0.1:28000:8000'],
    depends_on:{minio:{condition:'service_started'},redis:{condition:'service_started'}},healthcheck:health},
    worker:{image,pull_policy:'never',command:'celery -A geo.tasks:celery_app worker --loglevel=INFO --concurrency=2',
      environment:geoEnv,depends_on:{geo:{condition:'service_healthy'}}}}};
}
function ensureCompose(c){
  const path=join(c.dir,'desktop-ai03c-app.compose.json');
  const body=JSON.stringify(appCompose(c),null,2)+'\n';
  if(existsSync(path)){
    const current=readFileSync(path,'utf8');
    const initial=body.replaceAll('service_started','service_healthy');
    assert(current===body||current===initial,'owned app Compose file changed');
    if(current===initial)writeFileSync(path,body,{flag:'w',mode:0o600});
  }
  else writeFileSync(path,body,{flag:'wx',mode:0o600});
}
function processInfo(pid){
  const script=`$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($p) { $p | Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress }`;
  const value=command('powershell.exe',['-NoProfile','-Command',script]);
  return value?JSON.parse(value):null;
}
function recordPath(c,label){return join(c.dir,`desktop-ai03c-${label}.process.json`);}
function readProcess(c,label){
  const path=recordPath(c,label);
  if(!existsSync(path))return null;
  const record=JSON.parse(readFileSync(path,'utf8'));
  assert.equal(record.project,c.project);assert.equal(record.label,label);
  return record;
}
function owned(c,label){
  const record=readProcess(c,label);
  if(!record)return null;
  const info=processInfo(record.pid);
  if(!info)return null;
  assert.equal(info.CreationDate,record.creationDate,`${label} PID was reused`);
  assert.equal(resolve(info.ExecutablePath).toLowerCase(),process.execPath.toLowerCase());
  assert(info.CommandLine.includes(record.entry),`${label} command changed`);
  return record;
}
async function free(port){await new Promise((ok,bad)=>{const server=createServer();server.once('error',bad);
  server.listen(port,'127.0.0.1',()=>server.close(ok));});}
async function launch(c,label,entry){
  assert(labels.includes(label));
  assert(!owned(c,label),`${label} already running`);
  const previous=readProcess(c,label);
  assert(!previous||!processInfo(previous.pid),`${label} prior PID is occupied`);
  const log=openSync(join(c.dir,`desktop-ai03c-${label}.log`),'a',0o600);
  const runtimeEnv={...c.env,...(label==='api'?{TSX_TSCONFIG_PATH:join(root,'apps','api','tsconfig.json')}:{})};
  const child=spawn(process.execPath,['--import','tsx',entry],{cwd:root,env:safeEnv(runtimeEnv),
    detached:true,windowsHide:true,stdio:['ignore',log,log]});
  closeSync(log);assert(child.pid,`${label} failed to launch`);child.unref();
  let info=null;
  for(let i=0;i<20;i++){
    info=processInfo(child.pid);
    if(info?.CommandLine?.includes(entry))break;
    await new Promise(r=>setTimeout(r,100));
  }
  assert(info?.CommandLine?.includes(entry),`${label} launch identity unavailable`);
  writeFileSync(recordPath(c,label),JSON.stringify({project:c.project,label,pid:child.pid,
    creationDate:info.CreationDate,entry})+'\n',{flag:previous?'w':'wx',mode:0o600});
}
async function start(c){
  await free(28000);await free(3192);
  ensureCompose(c);
  const source=join(root,'services','geo');
  docker(c,['build','-t',image,source],900000);
  compose(c,['up','-d','--wait','--no-recreate','--no-build','geo','worker'],180000);
  await launch(c,'dispatcher',join(root,'scripts','dispatcher.ts'));
  await launch(c,'api',join(root,'apps','api','src','main.ts'));
  let health=null;
  for(let i=0;i<100;i++){
    assert(owned(c,'api')&&owned(c,'dispatcher'),'owned application process exited');
    try{const response=await fetch(c.env.ULPIN_TEST_URL+'api/v1/health',{signal:AbortSignal.timeout(2000)});
      if(response.ok){health=await response.json();if(health.ok)break;}}catch{}
    await new Promise(r=>setTimeout(r,1500));
  }
  assert(health?.ok,'full worker runtime did not become healthy');
  console.log(JSON.stringify({project:c.project,health:health.services,apiPort:3192}));
}
function status(c){
  const processes=Object.fromEntries(labels.map(label=>[label,!!owned(c,label)]));
  const containers=docker(c,['ps','--filter',`label=com.docker.compose.project=${c.project}`,'--format','{{.Names}} {{.Status}}']);
  console.log(JSON.stringify({project:c.project,processes,containers:containers.split('\n')}));
}
async function stop(c){
  for(const label of labels){const record=owned(c,label);if(record)process.kill(record.pid,'SIGTERM');}
  for(let i=0;i<30;i++){
    if(labels.every(label=>!owned(c,label)))break;
    await new Promise(r=>setTimeout(r,250));
  }
  assert(labels.every(label=>!owned(c,label)),'owned application process remains');
  if(existsSync(join(c.dir,'desktop-ai03c-app.compose.json')))
    compose(c,['stop','geo','worker'],60000);
  console.log(`Stopped owned application and processing services for ${c.project}; restored storage volumes remain running.`);
}
const [action,dir]=process.argv.slice(2);
try{
  assert(['preflight','start','status','stop'].includes(action)&&dir&&process.argv.length===4,
    'Usage: desktop-prefix-runtime.mjs preflight|start|status|stop <restored-runtime-directory>');
  const c=config(dir);
  if(action==='preflight')console.log(JSON.stringify({project:c.project,apiPort:3192,modelGateway:'disabled'}));
  if(action==='start')await start(c);
  if(action==='status')status(c);
  if(action==='stop')await stop(c);
}catch(error){console.error(error.message);process.exitCode=1;}

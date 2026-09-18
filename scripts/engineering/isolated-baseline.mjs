/** T001: real test-only restore/API baseline. Never selects a developer's environment. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, lstat, realpath, copyFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertIsolation, redact } from './isolation.mjs';
import { canonical, identifier, schema, loadBundle, installBundle, verifyBundle } from '../datasets/bundle.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const scope = assertIsolation(process.env); // Deliberately before clients/imports with configuration.
assert.equal(process.platform, 'linux', 'Actual hosted execution must be Linux');
await assert.rejects(lstat(resolve(root, '.env')), {code:'ENOENT'}, 'Never load a private root environment');
const temporary = await realpath(process.env.RUNNER_TEMP);
const envFile = await realpath(process.env.ULPIN_BASELINE_ENV_FILE);
assert.equal(relative(temporary, envFile), 'ulpin-t001.env', 'Unexpected runner environment file');
const output = resolve(root, '.runtime/engineering');
await mkdir(output, {recursive:true});
const report = {startedAt:new Date().toISOString(), scope, result:'RUNNING', checks:[], commands:[], limitations:[
  'Committed snapshot and synthetic API cases on isolated hosted services; not the private PC database.',
  'Browser uses software WebGL; no claim of target-GPU fidelity/performance or physical touch validation.',
  'The destructive named-demo registry and global-project worker-pause scripts are not run here.',
]};
const hash = value => createHash('sha256').update(value).digest('hex');
const pass = (name, details={}) => {report.checks.push({name,passed:true,...details});console.log('PASS '+name);};
const require = createRequire(resolve(root, 'apps/web/package.json'));
const {Pool} = require('pg');
const sdk = require('@aws-sdk/client-s3');
const pool = new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,query_timeout:30000,max:3});
const s3 = new sdk.S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION,forcePathStyle:true,
  credentials:{accessKeyId:process.env.S3_ACCESS_KEY,secretAccessKey:process.env.S3_SECRET_KEY},maxAttempts:2});
let ownsProject=false;
const services=[];
const composeArgs=['--context','default','compose','--project-directory',root,'--env-file',envFile,'-p',scope.project,'-f',resolve(root,'compose.yaml')];

async function command(label, executable, args, {input,timeout=180000,env=process.env}={}) {
  assert.match(label,/^[a-z0-9-]+$/);
  const start=Date.now(), chunks=[];
  let size=0, timedOut=false;
  const child=spawn(executable,args,{cwd:root,env,stdio:['pipe','pipe','pipe']});
  let killTimer;
  const terminate=()=>{timedOut=true;child.kill('SIGTERM');killTimer??=setTimeout(()=>child.kill('SIGKILL'),10000);};
  const timer=setTimeout(terminate,timeout);
  const receive=chunk=>{size+=chunk.length;if(size>32*1024*1024)terminate();else chunks.push(chunk);};
  child.stdout.on('data',receive);child.stderr.on('data',receive);
  child.stdin.on('error',()=>{});
  child.stdin.end(input);
  let code;
  try { code=await new Promise((resolveCode,reject)=>{child.on('error',reject);child.on('close',resolveCode);}); }
  finally {clearTimeout(timer);clearTimeout(killTimer);}
  const text=redact(Buffer.concat(chunks).toString('utf8'),env);
  await writeFile(resolve(output,label+'.log'),text);
  report.commands.push({name:label,exitCode:code,timedOut,durationMs:Date.now()-start});
  assert(!timedOut,`${label} exceeded its bounded duration/output limit`);
  assert.equal(code,0,`${label} failed: ${text.slice(-2500)}`);
  return text;
}
const compose=(label,args,options)=>command(label,'docker',[...composeArgs,...args],options);

function launch(label,args) {
  const child=spawn(process.execPath,args,{cwd:root,env:{...process.env},detached:true,stdio:['ignore','pipe','pipe']});
  const state={label,child,chunks:[],bytes:0,error:null};
  child.on('error',error=>{state.error=error;});
  const receive=chunk=>{if(state.bytes<8*1024*1024){state.chunks.push(chunk);state.bytes+=chunk.length;}};
  child.stdout.on('data',receive);child.stderr.on('data',receive);
  services.push(state);
  return state;
}
async function stopServices() {
  for(const state of services.reverse()) {
    if(state.child.pid && state.child.exitCode===null) {
      try {process.kill(-state.child.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
      await Promise.race([new Promise(r=>state.child.once('close',r)),new Promise(r=>setTimeout(r,5000))]);
      if(state.child.exitCode===null)try {process.kill(-state.child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
    }
    await writeFile(resolve(output,state.label+'.log'),redact(Buffer.concat(state.chunks).toString('utf8'),process.env));
  }
}

async function fixtureBytes(base,name,expected) {
  assert.equal(typeof name,'string');
  const file=resolve(base,name),rel=relative(base,file);
  assert(rel && !rel.startsWith('..') && !isAbsolute(rel),'Fixture path escapes its root');
  const info=await lstat(file);
  assert(info.isFile() && !info.isSymbolicLink(),'Fixture must be a regular file');
  assert(info.size<=100*1024*1024,'Fixture file exceeds the supported snapshot bound');
  const real=relative(await realpath(base),await realpath(file));
  assert(real && !real.startsWith('..') && !isAbsolute(real),'Fixture resolves outside its root');
  const bytes=await readFile(file);
  assert.equal(hash(bytes),expected.sha256,`Fixture checksum mismatch: ${name}`);
  if(expected.bytes!==undefined)assert.equal(bytes.length,expected.bytes,`Fixture size mismatch: ${name}`);
  return bytes;
}
async function snapshotManifest() {
  const base=resolve(root,'repo-data'),manifest=JSON.parse(await readFile(resolve(base,'manifest.json'),'utf8'));
  assert.equal(manifest.version,1);
  assert.equal(new Set(manifest.objects.map(o=>o.key)).size,manifest.objects.length,'Duplicate snapshot object key');
  assert(manifest.objects.length<10000 && manifest.tables.length<200,'Snapshot exceeds bounded baseline profile');
  for(const item of [manifest.database,...manifest.objects,...manifest.files||[]])await fixtureBytes(base,item.file,item);
  for(const item of manifest.assets)await fixtureBytes(root,item.file,item);
  pass('Committed database, original-file and presentation-asset checksums verified',{tables:manifest.tables.length,objects:manifest.objects.length});
  return manifest;
}
async function tableRows(client,table,columns) {
  const select=columns?columns.map(identifier).join(','):'*';
  return (await client.query(`SELECT row_to_json(t)::text AS body FROM (SELECT ${select} FROM public.${identifier(table)}) t`)).rows.map(row=>row.body);
}
async function fingerprints(client) {
  const current=await schema(client),result={};
  for(const [name,definition] of Object.entries(current.tables)) {
    const counts=new Map();
    for(const row of await tableRows(client,name,definition.columns)) {
      const key=hash(canonical(JSON.parse(row)));counts.set(key,(counts.get(key)||0)+1);
    }
    result[name]={columns:definition.columns,counts};
  }
  return result;
}
async function assertPreserved(client,before) {
  for(const [name,entry] of Object.entries(before)) {
    const counts=new Map();
    for(const row of await tableRows(client,name,entry.columns)) {
      const key=hash(canonical(JSON.parse(row)));counts.set(key,(counts.get(key)||0)+1);
    }
    for(const [key,count] of entry.counts)assert((counts.get(key)||0)>=count,`Protected row changed or disappeared in ${name}`);
  }
}
async function verifyObjects(manifest) {
  for(const item of manifest.objects) {
    const response=await s3.send(new sdk.GetObjectCommand({Bucket:scope.bucket,Key:item.key}));
    const bytes=await response.Body.transformToByteArray();
    assert.equal(hash(bytes),item.sha256,'Stored original checksum mismatch');
    assert.equal(bytes.length,item.bytes,'Stored original size mismatch');
    assert.equal(response.ContentType,item.contentType,'Stored content type mismatch');
    assert.equal(canonical(response.Metadata||{}),canonical(item.metadata||{}),'Stored source metadata mismatch');
  }
}
async function verifyOriginalLinks(client) {
  const rows=(await client.query('SELECT id,object_key,sha256,bytes FROM sources ORDER BY id')).rows;
  for(const row of rows) {
    const response=await s3.send(new sdk.GetObjectCommand({Bucket:scope.bucket,Key:row.object_key}));
    const bytes=await response.Body.transformToByteArray();
    assert.equal(hash(bytes),row.sha256,'Source row and retained object differ');
    assert.equal(bytes.length,Number(row.bytes),'Source row and object length differ');
  }
  return {count:rows.length,fingerprint:hash(canonical(rows.map(row=>({id:row.id,key:row.object_key,sha256:row.sha256,bytes:String(row.bytes)}))))};
}
async function waitReady() {
  for(let attempt=0;attempt<90;attempt++) {
    for(const state of services)assert(!state.error && state.child.exitCode===null,`${state.label} exited before readiness`);
    try {
      const response=await fetch(process.env.ULPIN_TEST_URL+'/api/v1/health',{signal:AbortSignal.timeout(4000)});
      const body=await response.json();
      if(response.ok&&body.ok&&body.dataMode==='linked')return;
    }catch{}
    await new Promise(r=>setTimeout(r,1000));
  }
  throw new Error('Isolated API/storage/worker readiness failed');
}

try {
  report.sourceCommit=(await command('source-commit','git',['rev-parse','HEAD'])).trim();
  const manifest=await snapshotManifest();
  const dockerHost=(await command('docker-context','docker',['context','inspect','default','--format','{{.Endpoints.docker.Host}}'])).trim();
  assert.equal(dockerHost,'unix:///var/run/docker.sock','Hosted Docker must be the local runner daemon');
  assert.equal((await command('existing-project','docker',['--context','default','ps','-a','--filter',`label=com.docker.compose.project=${scope.project}`,'--format','{{.ID}}'])).trim(),'','Existing project must not be adopted');
  assert.equal((await command('existing-volumes','docker',['--context','default','volume','ls','--filter',`label=com.docker.compose.project=${scope.project}`,'--format','{{.Name}}'])).trim(),'','Existing volumes must not be adopted');
  ownsProject=true; // Proven absent, so only this invocation can create this attempt's resources.
  await compose('services-start',['--profile','app','up','-d','--build','--wait'],{timeout:600000});
  const client=await pool.connect();
  try {
    await client.query("SET TIME ZONE 'UTC'");
    assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name,scope.database);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename<>'spatial_ref_sys'")).rows[0].n,0,'Restore target is not empty');
    assert.equal((await s3.send(new sdk.ListObjectsV2Command({Bucket:scope.bucket,MaxKeys:1}))).Contents?.length||0,0,'Restore bucket is not empty');
    for(const item of manifest.objects)await s3.send(new sdk.PutObjectCommand({Bucket:scope.bucket,Key:item.key,
      Body:await fixtureBytes(resolve(root,'repo-data'),item.file,item),ContentType:item.contentType,Metadata:item.metadata,IfNoneMatch:'*'}));
    await compose('snapshot-restore',['exec','-T','postgres','pg_restore','-U',process.env.POSTGRES_USER,'-d',scope.database,
      '--no-owner','--no-acl','--schema=public','--exit-on-error','--single-transaction'],{input:await fixtureBytes(resolve(root,'repo-data'),manifest.database.file,manifest.database)});
    for(const table of manifest.tables) {
      const rows=(await tableRows(client,table.name)).sort();
      assert.equal(rows.length,table.rows,`Restored count mismatch: ${table.name}`);
      assert.equal(hash(rows.join('\n')),table.sha256,`Restored row hash mismatch: ${table.name}`);
    }
    await verifyObjects(manifest);
    const original=await fingerprints(client);
    pass('Actual PostGIS restore and stored original bytes match the committed snapshot');
    await command('migration','node',['--import','tsx','scripts/migrate.ts']);
    await assertPreserved(client,original);
    const bundle=await loadBundle(resolve(root,'data-bundles/uttam-nagar'));
    const installed=await installBundle(client,s3,sdk,process.env,bundle);
    assert(!installed.alreadyInstalled);
    await assertPreserved(client,original);
    const current=await fingerprints(client);
    const replay=await installBundle(client,s3,sdk,process.env,bundle);
    assert(replay.alreadyInstalled);
    assert.deepEqual(await fingerprints(client),current,'Replay changed existing rows');
    await verifyBundle(client,s3,sdk,process.env,bundle,true);
    pass('Uttam Nagar transfers additively and an identical replay leaves rows and originals unchanged',{
      insertedRows:installed.insertedRows,uploadedObjects:installed.uploadedObjects,areas:bundle.manifest.areas.length});
    await command('repeat-migration','node',['--import','tsx','scripts/migrate.ts']);
    await assertPreserved(client,current);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM jobs WHERE status NOT IN ('succeeded','failed','stale')")).rows[0].n,0,'Historical jobs must be terminal before test dispatcher starts');
    report.originalsBefore=await verifyOriginalLinks(client);
    report.protectedTables=Object.entries(current).map(([name,value])=>({name,rows:[...value.counts.values()].reduce((a,b)=>a+b,0),fingerprint:hash(canonical([...value.counts].sort()))}));
    launch('server',['apps/web/node_modules/next/dist/bin/next','start','apps/web','--hostname','127.0.0.1','--port','3000']);
    launch('dispatcher',['--import','tsx','scripts/dispatcher.ts']);
    await waitReady();
    await command('api-negative','node',['--import','tsx','scripts/api-regression.ts'],{timeout:420000,
      env:{...process.env,ULPIN_API_EVIDENCE_FILE:'../.runtime/engineering/api-negative.md'}});
    await command('api-closed-ring','node',['--import','tsx','scripts/api-regression.ts','--closed-ring-only'],{timeout:180000,
      env:{...process.env,ULPIN_API_EVIDENCE_FILE:'../.runtime/engineering/api-closed-ring.md'}});
    await assertPreserved(client,current);
    await verifyObjects(manifest);await verifyBundle(client,s3,sdk,process.env,bundle,true);
    report.originalsAfter=await verifyOriginalLinks(client);
    pass('Real API negative/closed-ring regressions preserve every unrelated baseline row, identity and original');
    await command('browser','node',['scripts/spatial/browser.mjs'],{timeout:360000,env:{...process.env,SPATIAL_START_SERVER:'0'}});
    pass('Actual calibration browser suite passes against the same isolated production server');
  }finally{client.release();}

  const testContext=resolve(temporary,scope.id+'-python');
  await mkdir(testContext,{recursive:false});
  await copyFile(resolve(root,'services/geo/requirements.txt'),resolve(testContext,'requirements.txt'));
  await copyFile(resolve(root,'services/geo/requirements-dev.txt'),resolve(testContext,'requirements-dev.txt'));
  await writeFile(resolve(testContext,'Dockerfile'),'FROM ulpin-geo:local\nUSER root\nCOPY requirements.txt requirements-dev.txt /tmp/\nRUN pip install --no-cache-dir -r /tmp/requirements-dev.txt\nUSER processor\n');
  const testImage=`ulpin-t001-tests:${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  await command('python-test-image','docker',['--context','default','build','-t',testImage,testContext],{timeout:360000});
  await command('python-tests','docker',['--context','default','run','--rm','--network','none',
    '--mount',`type=bind,src=${root},dst=/workspace,readonly`,'--workdir','/workspace/services/geo',
    '--env','PYTHONPATH=/app','--env','PYTHONDONTWRITEBYTECODE=1',testImage,
    'python','-m','pytest','-q','tests','-p','no:cacheprovider'],{timeout:240000});
  pass('Pinned Python 3.12 geometry/processing tests pass with read-only sources and no network');
  report.result='PASS';
}catch(error) {
  report.result='FAIL';report.error=redact(error.stack||String(error),process.env);
  console.error(report.error);process.exitCode=1;
}finally {
  try {await stopServices();await pool.end();s3.destroy();}
  catch(error){report.result='FAIL';report.cleanupError=redact(String(error),process.env);process.exitCode=1;}
  if(ownsProject)try {
    assertIsolation(process.env);
    await compose('owned-project-cleanup',['--profile','app','down','--volumes','--remove-orphans'],{timeout:120000});
    pass('Only this attempt’s newly owned Compose project was removed');
  }catch(error){report.result='FAIL';report.cleanupError=redact(String(error),process.env);process.exitCode=1;}
  report.finishedAt=new Date().toISOString();
  await writeFile(resolve(output,'isolated-baseline.json'),JSON.stringify(report,null,2)+'\n');
  console.log('Isolated baseline: '+report.result);
}

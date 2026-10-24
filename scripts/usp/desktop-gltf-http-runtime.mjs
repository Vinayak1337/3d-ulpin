/** Scoped retained Windows runtime. Start/run-one/stop never drain a queue.
 * node --import tsx scripts/usp/desktop-gltf-http-runtime.mjs
 *   start|stop <prefix-profile> <fresh-private-state>
 *   run-one <prefix-profile> <private-state> Box.glb|Box.gltf
 * State owns at most one research case and one fresh job per manifest original.
 * Interrupted intake keeps its request key; execution requires its exact receipt.
 */
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,realpathSync,mkdirSync,readdirSync,openSync,closeSync} from 'node:fs';
import {createServer} from 'node:net';
import {basename,dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assertUspIsolation} from './local-isolation.mjs';

const self=fileURLToPath(import.meta.url),root=resolve(dirname(self),'../..');
const dockerFile='C:/Users/kvina/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe';
const python='C:/Python313/python.exe',node='C:/Program Files/nodejs/node.exe';
const environment='E:/BhuAayam-data/task-data/desktop-gltf-native/env';
const retainedPaths=['E:/BhuAayam-data/task-data/gltf-api-20261004-run01/profile.json',
  'E:/BhuAayam-data/task-data/gltf-api-20261004-run01/verification.json',
  'E:/BhuAayam-data/task-data/desktop-gltf-native/verification.json',
  'E:/BhuAayam-data/task-data/obj-http-20261004-run01/profile.json',
  'E:/BhuAayam-data/task-data/obj-http-20261004-run01/native-lock.json',
  'E:/BhuAayam-data/task-data/obj-http-20261004-run01/verification.json'];
const configFiles=['run.env.json','compose.env','compose.json','ownership.json','restore-completed.json',
  'desktop-ai03c-api.process.json','desktop-ai03c-dispatcher.process.json','desktop-ai03c-app.compose.json'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const pin=path=>{const bytes=readFileSync(path);return {path,bytes:bytes.length,sha256:sha(bytes)};};
const inside=(parent,path)=>{const r=relative(parent,path);return !r.startsWith('..')&&!isAbsolute(r);};
const hostPath=path=>path.replaceAll('\\','/').replace(/^\/run\/desktop\/mnt\/host\/([a-z])\//i,'$1:/').toLowerCase();
const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
let c,db,storage;
function redact(value){let text=String(value);for(const key of ['DATABASE_URL','POSTGRES_PASSWORD','S3_SECRET_KEY','GEO_SERVICE_TOKEN'])
  if(c?.env[key])text=text.replaceAll(c.env[key],'[redacted]');return text;}
function command(file,args,timeout=15000){
  try{return execFileSync(file,args,{cwd:root,env:c?.processEnv,encoding:'utf8',timeout,windowsHide:true,
    stdio:['ignore','pipe','pipe'],maxBuffer:4*1024**2}).trim();}
  catch(error){throw new Error(redact(`${basename(file)} failed (${error.status??error.code}): ${error.stderr||error.message}`));}
}
const docker=args=>command(dockerFile,['--context','desktop-linux',...args],20000);
const ps=script=>JSON.parse(command('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],10000)||'null');
const save=(name,value)=>writeFileSync(join(c.state,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const load=name=>json(join(c.state,name));
const has=name=>existsSync(join(c.state,name));
const clean=()=>assert.equal(command('git',['status','--porcelain']),'','Commit owned code before starting or running.');
function configure(profile,state){
  assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');
  const dir=realpathSync(profile),privateDir=realpathSync(state);assert.equal(basename(dir),'prefix-worker-20260929');
  assert(!inside(root,privateDir)&&!inside(dir,privateDir)&&!inside('C:/Python313',privateDir)&&!inside(environment,privateDir),'Use separate private state.');
  const env=json(join(dir,'run.env.json'));
  const processEnv=Object.fromEntries([...['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'].map(k=>[k,process.env[k]]),
    ...Object.entries(env),['ULPIN_FIXTURE_ROOT',join(root,'fixtures')],['TSX_TSCONFIG_PATH',join(root,'apps/api/tsconfig.json')]].filter(([,v])=>typeof v==='string'));
  c={dir,state:privateDir,env,processEnv};
  const scope=assertUspIsolation({...env,ULPIN_LOCAL_OPERATOR_SUBJECT:undefined});
  const sid=command('whoami.exe',['/user','/fo','csv','/nh'],3000).match(/,"(S-1-[0-9-]+)"$/i)?.[1];assert(sid);
  assert.equal(env.ULPIN_LOCAL_OPERATOR_SUBJECT,`local-windows:${sid}`);
  const path64=Buffer.from(privateDir).toString('base64');
  const acl=ps(`$a=Get-Acl -LiteralPath ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${path64}')));[pscustomobject]@{protected=$a.AreAccessRulesProtected;entries=@($a.Access | ForEach-Object {[pscustomobject]@{sid=$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;allow=($_.AccessControlType -eq 'Allow')}})} | ConvertTo-Json -Depth 4 -Compress`);
  assert(acl.protected&&acl.entries.length);assert(acl.entries.every(e=>e.allow&&[sid,'S-1-5-18','S-1-5-32-544'].includes(e.sid)),'Private ACL allows unrelated access.');
  c.project=scope.project;c.subject=env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  assert.equal(c.project,'ulpin-usptest-b050544f3d2cb99e');assert.equal(env.API_PORT,'3192');assert.equal(env.ULPIN_MODEL_GATEWAY_ENABLED,'0');
  assert(!existsSync(join(root,'.env')));assert.equal(docker(['context','show']),'desktop-linux');
  const owner=json(join(dir,'ownership.json'));assert.equal(owner.project,c.project);assert.equal(owner.operatorSubject,c.subject);
  assert.equal(owner.profile,'prefix-worker');assert.equal(json(join(dir,'restore-completed.json')).processingStarted,false);
  const services=json(join(dir,'compose.json')).services;assert.deepEqual(Object.keys(services).sort(),['minio','postgres','redis']);
  c.storage=['postgres','minio','redis'].map(service=>{
    const item=JSON.parse(docker(['inspect',`${c.project}-${service}-1`]))[0];
    assert.equal(item.Config.Labels['com.docker.compose.project'],c.project);assert.equal(item.Config.Labels['com.docker.compose.service'],service);
    assert.equal(item.Mounts.filter(m=>m.Type==='volume').length,1);assert.equal(item.Mounts.find(m=>m.Type==='volume').Name,owner.volumes[service]);
    assert.equal(item.Mounts.length,services[service].volumes.length);
    for(const value of services[service].volumes){const parsed=/^(.*):(\/[^:]+)(?::(ro|rw))?$/.exec(value);assert(parsed);
      const mount=item.Mounts.find(m=>m.Destination===parsed[2]);assert(mount);assert.equal(mount.RW,parsed[3]!=='ro');
      if(mount.Type==='volume')assert.equal(mount.Name,parsed[1]);else {assert.equal(mount.Type,'bind');assert.equal(mount.RW,false);assert.equal(hostPath(mount.Source),hostPath(parsed[1]));}}
    const ports=service==='postgres'?{'5432/tcp':'25432'}:service==='redis'?{'6379/tcp':'26379'}:{'9000/tcp':'29000','9001/tcp':'29001'};
    assert.deepEqual(Object.keys(item.HostConfig.PortBindings).sort(),Object.keys(ports).sort());
    for(const [port,hostPort] of Object.entries(ports))assert.deepEqual(item.HostConfig.PortBindings[port],[{HostIp:'127.0.0.1',HostPort:hostPort}]);
    return {id:item.Id,name:item.Name,image:item.Image,created:item.Created,mounts:item.Mounts,ports:item.HostConfig.PortBindings,running:item.State.Running};
  });
  if(has('start-intent.json')){
    const prior=load('start-intent.json');assert.equal(prior.project,c.project);assert.equal(prior.subject,c.subject);assert.equal(prior.root,root);
    assert.deepEqual(configFiles.map(f=>pin(join(c.dir,f))),prior.configPins,'Retained profile changed.');
    for(const item of c.storage){const old=prior.storage.find(v=>v.id===item.id);assert(old,'Storage replaced.');
      for(const key of ['name','image','created','mounts','ports'])assert.deepEqual(item[key],old[key]);}
  }
  if(has('profile-generated.json')){
    const record=load('profile-generated.json');assert.deepEqual(record.profile,pin(record.profile.path));
    Object.assign(c.processEnv,{ULPIN_GLTF_PROFILE:record.profile.path,ULPIN_GLTF_PROFILE_SHA256:record.profile.sha256});
  }
}
const processInfo=pid=>{assert(Number.isSafeInteger(pid)&&pid>0);return ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}';if($p){$p | Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress}`);};
function apiIdentity(record){const current=processInfo(record.pid);if(!current)return null;
  assert.equal(current.CreationDate,record.creationDate,'API PID reused.');assert.equal(hostPath(current.ExecutablePath),hostPath(node));
  assert(current.CommandLine.includes(record.entry),'API command changed.');return current;}
async function free(port){await new Promise((ok,bad)=>{const server=createServer();server.once('error',bad);server.listen(port,'127.0.0.1',()=>server.close(ok));});}
async function modules(){Object.assign(process.env,c.processEnv);
  db??=await import(pathToFileURL(join(root,'packages/server/src/infrastructure/db.ts')));
  storage??=await import(pathToFileURL(join(root,'packages/server/src/infrastructure/storage.ts')));}
async function snapshot(name){await modules();
  const tables=await db.transaction(async client=>{await client.query('SET TRANSACTION READ ONLY');
    const identity=(await client.query('SELECT current_database() database,current_user role')).rows[0];assert.equal(identity.database,c.env.POSTGRES_DB);assert.equal(identity.role,c.env.POSTGRES_USER);
    const names=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename),result={};
    for(const table of names){assert(/^[a-z_][a-z0-9_]*$/.test(table));result[table]=(await client.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.row);}
    return result;});
  assert(Buffer.byteLength(JSON.stringify(tables))<=64*1024**2,'Snapshot exceeds scoped limit.');
  save(name,{at:new Date().toISOString(),tables,counts:Object.fromEntries(Object.entries(tables).map(([t,r])=>[t,r.length]))});return tables;
}
async function http(label,path,options={},expected=200,binary=false){
  const response=await fetch(new URL(path,c.env.ULPIN_TEST_URL),{...options,signal:AbortSignal.timeout(60000)});
  const bytes=Buffer.from(await response.arrayBuffer());assert(bytes.length<=17*1024**2);
  const value=binary?null:JSON.parse(bytes.toString('utf8'));
  save(label+'.json',{at:new Date().toISOString(),path,method:options.method??'GET',status:response.status,
    cacheControl:response.headers.get('cache-control'),contentSha256:response.headers.get('x-content-sha256'),bytes:bytes.length,sha256:sha(bytes),body:value});
  assert.equal(response.status,expected,redact(JSON.stringify(value?.error??{})));
  if(path.includes('/gltf')&&expected<400)assert.equal(response.headers.get('cache-control'),'private, no-store');
  if(binary){assert.equal(response.headers.get('x-content-sha256'),sha(bytes));writeFileSync(join(c.state,label+'.bin'),bytes,{flag:'wx'});}return binary?bytes:value;
}
async function ready(){clean();const record=load('api-ownership.json');assert(apiIdentity(record),'Owned API absent.');
  const intent=load('start-intent.json');
  assert.equal(command('git',['rev-parse','HEAD']),intent.head);assert.deepEqual(pin(self),intent.helper);
  assert(c.storage.every(s=>s.running),'Retained storage stopped.');return record;
}
async function start(){
  clean();assert.equal(readdirSync(c.state).length,0,'Use a fresh empty private state.');await free(3192);
  const processes=ps(`@(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -ne ${process.pid} -and $_.Name -in 'node.exe','python.exe' -and $_.CommandLine -match 'apps[/\\\\]api[/\\\\]src[/\\\\]main|dispatcher|desktop-(gltf|obj)|(?:gltf|obj)[/\\\\]server.py'} | Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate) | ConvertTo-Json -Depth 3 -Compress`)??[];
  assert(!processes.length,'Reconcile existing API/dispatcher/native work before startup.');
  const memory=ps('Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory,TotalVisibleMemorySize | ConvertTo-Json -Compress');assert(memory.FreePhysicalMemory*1024>=2*1024**3);
  assert(c.storage.every(s=>!s.running),'This task requires stopped retained storage, with exclusive startup ownership.');
  for(const port of [25432,26379,29000,29001])await free(port);
  const intent={at:new Date().toISOString(),owner:randomUUID(),root,head:command('git',['rev-parse','HEAD']),project:c.project,subject:c.subject,
    helper:pin(self),configPins:configFiles.map(f=>pin(join(c.dir,f))),storage:c.storage,processes,memory,
    containerIds:docker(['ps','-a','--no-trunc','--format','{{.ID}}']).split('\n').filter(Boolean).sort(),
    volumeNames:docker(['volume','ls','--format','{{.Name}}']).split('\n').filter(Boolean).sort(),engine:JSON.parse(docker(['version','--format','json'])).Server,
    manifest:pin(join(root,'docs/evidence/usp/native-gltf/sources.json')),python:pin(python),retainedPins:retainedPaths.map(pin)};save('start-intent.json',intent);
  const scratch=join(c.state,'scratch');mkdirSync(scratch);
  const profile=join(c.state,'profile.json');assert.equal(realpathSync(environment).replaceAll('\\','/'),environment);
  const output=command(python,['-I','-S','-B',join(root,'scripts/usp/gltf/profile.py'),'--python',python,'--environment',environment,'--scratch',scratch,'--output',profile],30000);
  save('profile-generated.json',{at:new Date().toISOString(),exit:0,output:JSON.parse(output),profile:pin(profile),environment});
  Object.assign(c.processEnv,{ULPIN_GLTF_PROFILE:profile,ULPIN_GLTF_PROFILE_SHA256:pin(profile).sha256});Object.assign(process.env,c.processEnv);
  const config=await import(pathToFileURL(join(root,'packages/server/src/modules/usp/ingestion/gltf-config.ts')));save('tool-pins.json',config.gltfConfig().pins);
  save('storage-start-intent.json',{ids:c.storage.map(s=>s.id)});docker(['start',...c.storage.map(s=>s.id)]);
  save('storage-started.json',{at:new Date().toISOString(),ids:c.storage.map(s=>s.id),exit:0});
  const entry=join(root,'apps/api/src/main.ts'),out=openSync(join(c.state,'api.log'),'wx'),err=openSync(join(c.state,'api.stderr'),'wx');
  const child=spawn(node,['--import','tsx',entry],{cwd:root,env:c.processEnv,detached:true,windowsHide:true,stdio:['ignore',out,err]});closeSync(out);closeSync(err);assert(child.pid);child.unref();
  await wait(500);const current=processInfo(child.pid);assert(current&&current.CommandLine.includes(entry),'API launch identity unavailable.');
  save('api-ownership.json',{at:new Date().toISOString(),pid:child.pid,creationDate:current.CreationDate,entry,head:intent.head,owner:intent.owner,node:current.ExecutablePath});
  let available=false;for(let n=0;n<30;n++){assert(apiIdentity(load('api-ownership.json')),'Owned API exited during startup.');
    try{const response=await fetch(new URL('api/v1/cases',c.env.ULPIN_TEST_URL),{signal:AbortSignal.timeout(2000)});if(response.status===200){available=true;break;}}catch{}await wait(500);}
  assert(available,'Inspect retained API startup logs; no repeated launch.');await snapshot('database-before.json');
  const before=load('database-before.json');assert(before.tables.jobs.every(j=>!['queued','running','waiting_retry'].includes(j.status)),'Pending unrelated jobs require reconciliation.');
  save('started.json',{at:new Date().toISOString(),pid:child.pid,head:intent.head,apiPort:3192,dispatcherStarted:false,modelsStarted:false});
  console.log(JSON.stringify({started:true,pid:child.pid,containers:intent.containerIds.length,volumes:intent.volumeNames.length,profileSha256:pin(profile).sha256}));
}
async function ownedJob(id){
  assert(/^[a-f0-9-]{36}$/.test(id),'Expected exact job UUID.');await ready();
  const names=readdirSync(c.state).filter(n=>n.endsWith('.receipt.json')),owned=names.map(load).find(r=>r.receipt.jobId===id);assert(owned,'Refuse unrelated job: no owned HTTP receipt.');
  await modules();const {GltfInputSchema}=await import(pathToFileURL(join(root,'packages/contracts/src/usp/gltf-ingestion.ts')));
  const {assertGltfInputTx,assertGltfJobRow,boundedGltfObject}=await import(pathToFileURL(join(root,'packages/server/src/modules/usp/ingestion/gltf.ts')));
  const {assertGltfTools}=await import(pathToFileURL(join(root,'packages/server/src/modules/usp/ingestion/gltf-config.ts')));
  const job=await db.transaction(async client=>{await client.query('SET TRANSACTION READ ONLY');
    const row=(await client.query('SELECT j.*,m.input_sha256 FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id WHERE j.id=$1',[id])).rows[0];
    assert(row&&row.operation==='gltf-native','Refuse non-glTF job.');assert.equal(row.status,'queued','Refuse already run or stale job.');
    const input=GltfInputSchema.parse(row.payload);assertGltfJobRow(row,input);assert.equal(input.subject,c.subject);
    for(const k of ['jobId','caseId','caseRevision','sourceId','sourceRevision','sourceSha256'])assert.equal(input[k],owned.receipt[k]);
    assert.equal(input.sourceBytes,owned.receipt.bytes);await assertGltfInputTx(client,input);assertGltfTools(input.tools);
    const operation=(await client.query("SELECT result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='gltf-retain'",[input.caseId,'gltf-retain:'+owned.requestKey])).rows[0];assert.deepEqual(operation?.result,owned.receipt);return {...row,input};});
  const bytes=await boundedGltfObject(job.input.objectKey,job.input.sourceBytes);assert.equal(sha(bytes),job.input.sourceSha256);
  return job;
}
async function execute(id){await ownedJob(id);
  const {runGltfJob}=await import(pathToFileURL(join(root,'packages/server/src/modules/usp/ingestion/gltf-worker.ts')));
  await runGltfJob(id); // Exact canonical worker; unchanged production reader/config/storage.
  const row=(await db.query('SELECT j.status,j.error,m.result_ref FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id WHERE j.id=$1',[id])).rows[0];
  save(id+'.execution.json',{at:new Date().toISOString(),jobId:id,...row});assert.equal(row.status,'succeeded',row.error??'Canonical glTF did not succeed.');
  console.log(JSON.stringify({completed:true,jobId:id,resultSha256:row.result_ref.sha256}));
}
async function runOne(name){
  await ready();assert.deepEqual(pin(join(root,'docs/evidence/usp/native-gltf/sources.json')),load('start-intent.json').manifest);
  const manifest=json(join(root,'docs/evidence/usp/native-gltf/sources.json'));
  const original=manifest.sources.find(o=>basename(o.path)===name);assert(original&&manifest.purpose==='test_only','Only the two retained manifest originals are authorized.');
  assert.equal(manifest.sources.length,2);const bytes=readFileSync(original.path);assert.equal(bytes.length,original.bytes);assert.equal(sha(bytes),original.sha256);
  assert(!has(name+'.journey.json'),'Completed original stays closed.');
  if(!has('case-record.json')){
    assert(!has('case-intent.json'),'Uncertain prior case creation requires authoritative reconciliation; do not duplicate.');
    const body={name:'Khronos Cesium Box glTF context research',description:`test_only; ${manifest.publisher}; Box, copyright ${manifest.copyrightYear} ${manifest.artist}; revision ${manifest.repositoryRevision}; ${manifest.licence}; geography/global placement unknown; no property or learning qualification.`};save('case-intent.json',body);
    const created=await http('case-response','api/v1/cases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},201);save('case-record.json',created);
  }
  const caseRecord=load('case-record.json');let intent;
  if(has(name+'.intent.json'))intent=load(name+'.intent.json');
  else {await modules();const current=(await db.query('SELECT revision,description FROM cases WHERE id=$1',[caseRecord.id])).rows[0];assert(current?.description.includes(manifest.repositoryRevision));
    intent={requestKey:randomUUID(),caseId:caseRecord.id,expectedCaseRevision:current.revision,source:original,
      lineage:{issuer:manifest.publisher,originalUrl:original.originalUrl,acquiredAt:new Date(original.acquiredAt).toISOString(),permissionReference:manifest.licenceUrl,
        geography:manifest.geography,limitations:[manifest.purpose,manifest.classification,`repository revision: ${manifest.repositoryRevision}`,manifest.attribution,
          original.acquisitionTimeBasis,manifest.launchClearance,'External buffers/images are unfetched; Box0.bin was not acquired.',original.limitations]}};
    save(name+'.intent.json',intent);}
  assert.deepEqual(intent.source,original);let receipt;
  if(has(name+'.receipt.json'))receipt=load(name+'.receipt.json').receipt;
  else {const form=new FormData();form.set('file',new Blob([bytes],{type:'application/octet-stream'}),name);form.set('requestKey',intent.requestKey);
    form.set('expectedCaseRevision',String(intent.expectedCaseRevision));form.set('lineage',JSON.stringify(intent.lineage));
    const value=await http(name+'.upload','api/v1/ingestion/cases/'+intent.caseId+'/gltf',{method:'POST',body:form},201);
    const {GltfRetainReceiptSchema}=await import(pathToFileURL(join(root,'packages/contracts/src/usp/gltf-ingestion.ts')));receipt=GltfRetainReceiptSchema.parse(value);
    assert.equal(receipt.caseId,intent.caseId);assert.equal(receipt.caseRevision,intent.expectedCaseRevision+1);assert.equal(receipt.sourceSha256,original.sha256);assert.equal(receipt.bytes,original.bytes);
    save(name+'.receipt.json',{at:new Date().toISOString(),receipt,requestKey:intent.requestKey});}
  await ownedJob(receipt.jobId);await db.closePool();storage.closeStorageClient();db=storage=undefined;
  const output=command(node,['--max-old-space-size=512','--import','tsx',self,'_execute',c.dir,c.state,receipt.jobId],160000);
  const path=`api/v1/ingestion/cases/${receipt.caseId}/sources/${receipt.sourceId}/gltf/jobs/${receipt.jobId}`;
  const {GltfStatusSchema}=await import(pathToFileURL(join(root,'packages/contracts/src/usp/gltf-ingestion.ts')));
  const status=GltfStatusSchema.parse(await http(name+'.status',path));assert.equal(status.status,name==='Box.glb'?'completed':'partial');
  const native=await http(name+'.native',path+'/native',{},200,true),download=await http(name+'.original',`api/v1/ingestion/cases/${receipt.caseId}/sources/${receipt.sourceId}/gltf/original`,{},200,true);
  assert.equal(native.length,status.result.artifact.bytes);assert.equal(sha(native),status.result.artifact.sha256);assert.deepEqual(download,bytes);
  const parsed=JSON.parse(native.toString('utf8'));assert.equal(parsed.sourceSha256,original.sha256);assert.equal(parsed.counts.nodes,2);assert.equal(parsed.counts.primitives,1);
  assert.equal(parsed.counts.projectedPositions,name==='Box.glb'?24:0);assert.equal(parsed.counts.projectedIndices,name==='Box.glb'?36:0);
  assert.equal(status.result.summary.missingCompanionCount,name==='Box.glb'?0:1);assert(parsed.buffers.every(r=>r.fetched===false));
  if(name==='Box.gltf')assert(parsed.buffers.some(r=>r.status==='needs_input'));
  assert.equal(status.result.summary.measurements,false);assert.equal(status.result.summary.learningLabels,false);
  await modules();const stored=(await db.query('SELECT j.payload,m.result_ref,m.accepted_fence FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id WHERE j.id=$1',[receipt.jobId])).rows[0];
  const {readGltfResult,gltfResultBytes}=await import(pathToFileURL(join(root,'packages/server/src/modules/usp/ingestion/gltf.ts')));
  const result=await readGltfResult(stored.payload,stored.result_ref.sha256,gltfResultBytes(stored.result_ref,receipt.jobId));
  save(name+'.journey.json',{at:new Date().toISOString(),source:original,receipt,workerOutput:output,status,acceptedFence:stored.accepted_fence,resultSha256:stored.result_ref.sha256,result,
    originalBytesEqual:true,nativeHttpHashVerified:true,canonicalWorker:'runGltfJob(exact owned jobId)',humanAuthenticated:false,authority:'retained local Windows process subject; private loopback guards'});
  if(!has('private-denial.json'))await http('private-denial',path+'/native',{headers:{'sec-fetch-site':'cross-site'}},403);
  console.log(JSON.stringify({completed:true,jobId:receipt.jobId,status:status.status,...parsed.counts,missingCompanions:status.result.summary.missingCompanionCount}));
}
function preservation(after){
  const before=load('database-before.json').tables,receipts=readdirSync(c.state).filter(n=>n.endsWith('.receipt.json')).map(load),ownedCase=has('case-record.json')?load('case-record.json').id:null;
  const jobIds=receipts.map(r=>r.receipt.jobId),sourceIds=receipts.map(r=>r.receipt.sourceId),operations=receipts.map(r=>'gltf-retain:'+r.requestKey),deltas={};
  assert(receipts.length<=2,'More than two owned intakes.');
  assert.deepEqual(Object.keys(after),Object.keys(before));
  for(const [table,rows] of Object.entries(before)){const current=new Set(after[table].map(r=>JSON.stringify(r)));
    for(const row of rows)assert(current.has(JSON.stringify(row)),'Retained row changed/removed: '+table);
    const old=new Set(rows.map(r=>JSON.stringify(r))),added=after[table].filter(r=>!old.has(JSON.stringify(r)));
    for(const row of added){
      if(table==='cases')assert.equal(row.id,ownedCase);
      else if(table==='sources')assert(sourceIds.includes(row.id)&&row.case_id===ownedCase);
      else if(table==='jobs')assert(jobIds.includes(row.id)&&sourceIds.includes(row.source_id)&&row.case_id===ownedCase);
      else if(['usp_job_metadata','usp_job_attempts'].includes(table))assert(jobIds.includes(row.job_id));
      else if(table==='operations')assert(row.case_id===ownedCase&&row.kind==='gltf-retain'&&operations.includes(row.operation_key));
      else if(table==='usp_outbox')assert(row.body?.caseId===ownedCase||jobIds.some(id=>JSON.stringify(row.body).includes(id)));
      else if(table==='usp_outbox_streams')assert(after.usp_outbox.some(e=>e.stream_id===row.stream_id&&(e.body?.caseId===ownedCase||jobIds.some(id=>JSON.stringify(e.body).includes(id)))));
      else assert.fail('Unexpected added history: '+table);
    }deltas[table]={before:rows.length,after:after[table].length,added:added.length};
  }
  assert(after.jobs.every(j=>!['queued','running','waiting_retry'].includes(j.status)),'Pending job retained; report before cleanup.');
  assert(deltas.cases.added<=1);for(const table of ['sources','jobs','operations'])assert.equal(deltas[table].added,receipts.length);
  save('preservation.json',{at:new Date().toISOString(),allPriorRowsUnchanged:true,deltas,ownedCase,sourceIds,jobIds});
}
async function stop(){
  // Cleanup uses immutable owner identity and profile/storage guards even if Git changes.
  let failure;
  try{if(has('database-before.json')&&!has('database-after.json'))preservation(await snapshot('database-after.json'));}catch(error){failure=error;save('preservation-failure.json',{error:redact(error.stack)});}
  const intent=load('start-intent.json');
  if(has('api-ownership.json')){const record=load('api-ownership.json');if(apiIdentity(record)){process.kill(record.pid,'SIGTERM');await wait(1000);assert(!apiIdentity(record),'Owned API remains.');}}
  if(has('storage-start-intent.json')){const ids=load('storage-start-intent.json').ids;assert.deepEqual(ids,intent.storage.map(s=>s.id));docker(['stop','--time','10',...ids]);}
  assert.deepEqual(docker(['ps','-a','--no-trunc','--format','{{.ID}}']).split('\n').filter(Boolean).sort(),intent.containerIds);
  assert.deepEqual(docker(['volume','ls','--format','{{.Name}}']).split('\n').filter(Boolean).sort(),intent.volumeNames);
  assert.deepEqual(configFiles.map(f=>pin(join(c.dir,f))),intent.configPins);
  assert.deepEqual(retainedPaths.map(pin),intent.retainedPins,'Historical profiles/locks/proofs changed.');
  if(has('profile-generated.json'))assert.equal(readdirSync(join(c.state,'scratch')).length,0,'Native scratch retained; inspect before declaring cleanup.');
  const nativePids=[];for(const name of readdirSync(c.state).filter(n=>n.endsWith('.journey.json'))){const journey=load(name),pid=journey.result.supervision.workerPid;
    assert(!processInfo(pid),'Recorded native PID exists; reconcile rather than stop a reused PID.');nativePids.push(pid);
    const original=readFileSync(journey.source.path);assert.equal(sha(original),journey.source.sha256);assert.equal(original.length,journey.source.bytes);}
  await free(3192);const stopped=c.storage.map(s=>JSON.parse(docker(['inspect',s.id]))[0]);assert(stopped.every(s=>!s.State.Running));
  save('cleanup.json',{at:new Date().toISOString(),ownedApiAbsent:true,apiListenerAbsent:true,storageStopped:stopped.map(s=>s.Id),containerIdsUnchanged:true,volumeNamesUnchanged:true,
    profileFilesUnchanged:true,historicalProfilesLocksProofsUnchanged:true,nativeScratchEmpty:true,nativePidsAbsent:nativePids,originalsUnchanged:true,engineLeftAvailable:true,engine:JSON.parse(docker(['version','--format','json'])).Server.Version});
  console.log(JSON.stringify({stopped:true,priorHistoryUnchanged:!failure,containers:intent.containerIds.length,volumes:intent.volumeNames.length}));if(failure)throw failure;
}
try{
  const [action,profile,state,value]=process.argv.slice(2);assert(['start','run-one','stop','_execute'].includes(action)&&profile&&state);
  assert.equal(process.argv.length,['run-one','_execute'].includes(action)?6:5);configure(profile,state);
  if(action==='start')await start();if(action==='run-one')await runOne(value);if(action==='stop')await stop();if(action==='_execute')await execute(value);
}catch(error){console.error(redact(error.stack??error));process.exitCode=1;}
finally{if(db)await db.closePool();storage?.closeStorageClient();}

/** Processor-only Windows companion to the retained API-only runtime.
 * node --import tsx scripts/usp/desktop-document-http-runtime.mjs
 *   start|stop|queue|run-job <prefix-profile> <private-state-directory> [job-id]
 * queue pins one existing accepted native TEXT job and uses supported HTTP retry.
 * run-job accepts only that returned job. No queue scan or extractor injection.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {createServer} from 'node:net';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assertUspIsolation} from './local-isolation.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),self=fileURLToPath(import.meta.url);
const image='sha256:e71d87961be773c18685622eb570c034cf664bfa206e21f6fa3691d629b440c9';
const dockerFile='C:/Users/kvina/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe';
const bareKeys=['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const pin=path=>{const bytes=readFileSync(path);return {path,bytes:bytes.length,sha256:sha(bytes)};};
const hostPath=path=>path.replaceAll('\\','/').replace(/^\/run\/desktop\/mnt\/host\/([a-z])\//i,'$1:/').toLowerCase();
let db,storage,c;
function clean(){assert.equal(command('git',['status','--porcelain']),'','Commit owned code before starting the pinned runtime.');}
function redact(value){let text=String(value);for(const key of ['DATABASE_URL','POSTGRES_PASSWORD','S3_SECRET_KEY','GEO_SERVICE_TOKEN'])if(c?.env[key])text=text.replaceAll(c.env[key],'[redacted]');return text;}
function command(file,args,timeout=15000){
  try{return execFileSync(file,args,{cwd:root,env:c?.processEnv,encoding:'utf8',timeout,killSignal:'SIGKILL',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:1024**2}).trim();}
  catch(error){throw new Error(redact(`${basename(file)} failed (${error.status??error.code}): ${error.stderr||error.message}`));}
}
const docker=args=>command(dockerFile,['--context','desktop-linux',...args],20000);
const save=(name,value)=>writeFileSync(join(c.state,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const load=name=>json(join(c.state,name));
function configure(profile,state){
  assert.equal(process.platform,'win32','This retained runtime is Windows-only.');
  const dir=realpathSync(profile),privateDir=realpathSync(state);assert.equal(basename(dir),'prefix-worker-20260929');
  assert(privateDir.toLowerCase()!==root.toLowerCase()&&!privateDir.toLowerCase().startsWith(root.toLowerCase()+ '\\'),'State and private credentials must stay outside the repository.');
  const env=json(join(dir,'run.env.json'));
  const processEnv=Object.fromEntries([...bareKeys.map(key=>[key,process.env[key]]),...Object.entries(env),
    ['ULPIN_FIXTURE_ROOT',join(root,'fixtures')],['TSX_TSCONFIG_PATH',join(root,'apps/api/tsconfig.json')]].filter(([,value])=>typeof value==='string'));
  c={dir,state:privateDir,env,processEnv};
  const scope=assertUspIsolation({...env,ULPIN_LOCAL_OPERATOR_SUBJECT:undefined});
  const sid=command('whoami.exe',['/user','/fo','csv','/nh'],3000).match(/,"(S-1-[0-9-]+)"$/i)?.[1];assert(sid);assert.equal(env.ULPIN_LOCAL_OPERATOR_SUBJECT,`local-windows:${sid}`);
  const path64=Buffer.from(privateDir).toString('base64');
  const acl=jsonText(command('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    `$a=Get-Acl -LiteralPath ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${path64}')));[pscustomobject]@{protected=$a.AreAccessRulesProtected;entries=@($a.Access | ForEach-Object { [pscustomobject]@{sid=$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;allow=($_.AccessControlType -eq 'Allow')} })} | ConvertTo-Json -Depth 4 -Compress`],8000));
  assert(acl.protected);assert(acl.entries.every(entry=>entry.allow&&[sid,'S-1-5-18','S-1-5-32-544'].includes(entry.sid)),'Private state ACL permits an unrelated principal.');
  assert.equal(scope.project,'ulpin-usptest-b050544f3d2cb99e');assert.equal(env.API_PORT,'3192');assert.equal(env.ULPIN_MODEL_GATEWAY_ENABLED,'0');
  assert(!existsSync(join(root,'.env')));const owner=json(join(dir,'ownership.json'));assert.equal(owner.operatorSubject,env.ULPIN_LOCAL_OPERATOR_SUBJECT);assert.equal(owner.project,scope.project);
  c.project=scope.project;c.subject=env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  assert.equal(json(join(dir,'restore-completed.json')).processingStarted,false);
  const services=json(join(dir,'compose.json')).services;assert.deepEqual(Object.keys(services).sort(),['minio','postgres','redis']);
  for(const service of ['postgres','minio','redis']){
    const item=jsonText(docker(['inspect',`${scope.project}-${service}-1`]))[0];
    assert.equal(item.Config.Labels['com.docker.compose.project'],scope.project);assert.equal(item.Config.Labels['com.docker.compose.service'],service);
    assert.equal(item.Mounts.filter(m=>m.Type==='volume').length,1);assert.equal(item.Mounts.find(m=>m.Type==='volume').Name,owner.volumes[service]);
    const declared=services[service].volumes;assert.equal(item.Mounts.length,declared.length);
    for(const value of declared){const parsed=/^(.*):(\/[^:]+)(?::(ro|rw))?$/.exec(value);assert(parsed,'Unexpected saved mount declaration.');
      const mount=item.Mounts.find(m=>m.Destination===parsed[2]);assert(mount);assert.equal(mount.RW,parsed[3]!=='ro');
      if(mount.Type==='volume')assert.equal(mount.Name,parsed[1]);else {assert.equal(mount.Type,'bind');assert.equal(mount.RW,false,'Retained backup mounts must stay read-only.');assert.equal(hostPath(mount.Source),hostPath(parsed[1]));}}
    const ports=service==='postgres'?{'5432/tcp':'25432'}:service==='redis'?{'6379/tcp':'26379'}:{'9000/tcp':'29000','9001/tcp':'29001'};
    assert.deepEqual(Object.keys(item.HostConfig.PortBindings).sort(),Object.keys(ports).sort());
    for(const [port,hostPort] of Object.entries(ports))assert.deepEqual(item.HostConfig.PortBindings[port],[{HostIp:'127.0.0.1',HostPort:hostPort}]);
  }
}
const jsonText=text=>JSON.parse(text);
async function free(port){await new Promise((ok,bad)=>{const server=createServer();server.once('error',bad);server.listen(port,'127.0.0.1',()=>server.close(ok));});}
function current(){
  const record=load('processor-ownership.json');assert.equal(record.project,c.project);assert.equal(record.subject,c.subject);
  const item=jsonText(docker(['inspect',record.containerId]))[0];assert.equal(item.Image,image);assert.equal(item.Created,record.created);
  assert.equal(item.Config.Labels['bhu.document-http.owner'],record.owner);assert.equal(item.Config.Labels['bhu.document-http.project'],c.project);
  assert.deepEqual(item.HostConfig.PortBindings,{'8000/tcp':[{HostIp:'127.0.0.1',HostPort:'28000'}]});
  assert(item.HostConfig.ReadonlyRootfs);assert.equal(item.HostConfig.Memory,768*1024**2);assert.equal(item.HostConfig.PidsLimit,64);
  assert.equal(item.HostConfig.NanoCpus,1e9);assert(item.HostConfig.CapDrop.includes('ALL'));assert.equal(Object.keys(item.NetworkSettings.Networks).length,1);
  assert.equal(item.Config.User,'10001:10001');assert.equal(item.HostConfig.RestartPolicy.Name,'no');assert(item.HostConfig.SecurityOpt.includes('no-new-privileges'));
  const mount=item.Mounts.find(m=>m.Destination==='/app');assert(mount&&!mount.RW&&mount.Type==='bind');
  assert.equal(hostPath(mount.Source),hostPath(join(root,'services/geo')));
  const network=jsonText(docker(['network','inspect',record.networkId]))[0];assert(network.Internal);assert.equal(network.Labels['bhu.document-http.owner'],record.owner);
  return {record,item,network};
}
async function ready(){const {record,item}=current();assert(item.State.Running,'Owned processor is stopped.');assert(Date.now()+120000<record.deadlineAt,'Start a fresh owned processor before queuing work.');
  assert.equal(record.head,command('git',['rev-parse','HEAD']));assert.deepEqual(record.helper,pin(self));assert.deepEqual(record.api,pin(join(root,'services/geo/geo/api.py')));assert.deepEqual(record.area,pin(join(root,'services/geo/geo/area.py')));
  const response=await fetch(c.env.GEO_URL+'health',{signal:AbortSignal.timeout(2000)});assert.equal(response.status,200);assert.equal((await response.json()).ok,true);return record;
}
async function start(){
  clean();assert(!existsSync(join(c.state,'processor-ownership.json')),'Use a fresh private state directory.');await free(28000);
  assert.equal(jsonText(docker(['image','inspect',image]))[0].Id,image);
  const owner=randomUUID(),name='ulpin-document-http-'+owner,networkName=name+'-private';
  const intent={owner,name,networkName,project:c.project,subject:c.subject,image,head:command('git',['rev-parse','HEAD']),helper:pin(self),
    api:pin(join(root,'services/geo/geo/api.py')),area:pin(join(root,'services/geo/geo/area.py'))};save('processor-intent.json',intent);
  let networkId,containerId;
  try {
    networkId=docker(['network','create','--internal','--label',`bhu.document-http.owner=${owner}`,networkName]);
    save('network-ownership.json',{networkId,owner,networkName});
    // Startup wrapper only: the unchanged production FastAPI app handles extraction.
    // SIGALRM supplies an independent finite service lifetime even after CLI exit.
    const python="import signal,sys;signal.alarm(600);sys.path.insert(0,'/app');import uvicorn;uvicorn.run('geo.api:app',host='0.0.0.0',port=8000,workers=1,limit_concurrency=2,timeout_keep_alive=2,timeout_graceful_shutdown=5)";
    const began=Date.now();
    containerId=docker(['run','-d','--pull','never','--name',name,'--label',`bhu.document-http.owner=${owner}`,'--label',`bhu.document-http.project=${c.project}`,
      '--network',networkName,'--publish','127.0.0.1:28000:8000','--read-only','--user','10001:10001','--cpus','1','--memory','768m','--memory-swap','768m','--pids-limit','64',
      '--cap-drop','ALL','--security-opt','no-new-privileges','--restart','no','--stop-timeout','5','--log-opt','max-size=1m','--log-opt','max-file=1',
      '--env','GEO_SERVICE_TOKEN','--env','PROJ_NETWORK=OFF','--env','PYTHONDONTWRITEBYTECODE=1',
      '--mount',`type=bind,source=${join(root,'services/geo')},target=/app,readonly`,'--tmpfs','/tmp:rw,noexec,nosuid,size=16m,uid=10001,gid=10001',
      '--entrypoint','python',image,'-I','-B','-c',python]);
    const item=jsonText(docker(['inspect',containerId]))[0];save('processor-ownership.json',{...intent,networkId,containerId,created:item.Created,startedAt:began,deadlineAt:began+600000,
      lifetimeSeconds:600,limits:{memoryBytes:768*1024**2,cpus:1,pids:64,readOnly:true,network:'owned internal bridge'},pythonStartup:python});
    current();let healthy=false;const deadline=Date.now()+15000;
    while(Date.now()<deadline){const owned=current();if(!owned.item.State.Running)break;
      try{const response=await fetch(c.env.GEO_URL+'health',{signal:AbortSignal.timeout(2000)});if(response.ok&&(await response.json()).ok===true){healthy=true;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,300));}
    if(!healthy){writeFileSync(join(c.state,'processor-start.log'),docker(['logs','--tail','80',containerId]),{flag:'wx'});throw new Error('Owned production processor did not start; inspect private processor-start.log.');}
    save('processor-started.json',{at:new Date().toISOString(),containerId,networkId,health:200,processorUrl:c.env.GEO_URL,defaultEndpoint:c.env.GEO_URL+'internal/area/extract',image});
    console.log(JSON.stringify({started:true,containerId,port:28000,lifetimeSeconds:600}));
  }catch(error){
    // Only resources created by this invocation, identified by immutable IDs/labels.
    if(containerId){const item=jsonText(docker(['inspect',containerId]))[0];assert.equal(item.Config.Labels['bhu.document-http.owner'],owner);docker(['rm','-f',containerId]);}
    if(networkId){const network=jsonText(docker(['network','inspect',networkId]))[0];assert.equal(network.Labels['bhu.document-http.owner'],owner);docker(['network','rm',networkId]);}
    throw error;
  }
}
async function modules(){Object.assign(process.env,c.processEnv);db??=await import(pathToFileURL(join(root,'packages/server/src/infrastructure/db.ts')));storage??=await import(pathToFileURL(join(root,'packages/server/src/infrastructure/storage.ts')));}
async function inspectJob(id,expectedStatus){
  assert(/^[0-9a-f-]{36}$/.test(id));await modules();
  const {DocumentInputSchema}=await import(pathToFileURL(join(root,'packages/contracts/src/usp/document-ingestion.ts')));
  const {assertDocumentInputTx}=await import(pathToFileURL(join(root,'packages/server/src/modules/usp/ingestion/document-context.ts')));
  const {documentFormat}=await import(pathToFileURL(join(root,'packages/server/src/modules/usp/ingestion/document-native.ts')));
  const job=await db.transaction(async client=>{await client.query('SET TRANSACTION READ ONLY');const row=(await client.query('SELECT * FROM jobs WHERE id=$1',[id])).rows[0];
    assert(row&&row.operation==='document-extraction','Not a document job.');assert.equal(row.status,expectedStatus);
    const input=DocumentInputSchema.parse(row.payload);assert.equal(input.jobId,row.id);assert.equal(input.caseId,row.case_id);assert.equal(input.sourceId,row.source_id);
    assert.equal(input.subject,c.subject,'Unrelated operator job.');assert.equal(input.mode,'native_only','Only native_only is supported.');assert.equal(input.ocrSelection,undefined);assert.equal(input.archiveSelection,undefined);
    assert(input.sourceBytes>0&&input.sourceBytes<=10*1024**2);await assertDocumentInputTx(client,input);return {...row,input};});
  const original=await storage.readObject(job.input.objectKey);assert.equal(original.length,job.input.sourceBytes);assert.equal(sha(original),job.input.sourceSha256);assert.equal(documentFormat(original),'text','Only unchanged native TEXT originals are supported.');return job;
}
async function queue(id){
  clean();const processor=await ready();assert(!existsSync(join(c.state,'owned-job.json')),'This state already owns a job; do not enqueue another.');
  const job=await inspectJob(id,'succeeded'),input=job.input;
  let requestKey;if(existsSync(join(c.state,'queue-intent.json'))){const prior=load('queue-intent.json');assert.equal(prior.priorJobId,id);assert.deepEqual(prior.input,input);requestKey=prior.requestKey;}
  else {requestKey=randomUUID();save('queue-intent.json',{requestKey,priorJobId:id,input,head:processor.head,subject:c.subject});}
  const {DocumentReceiptSchema}=await import(pathToFileURL(join(root,'packages/contracts/src/usp/document-ingestion.ts')));
  const response=await fetch(c.env.ULPIN_TEST_URL+`api/v1/ingestion/cases/${input.caseId}/sources/${input.sourceId}/documents/retry`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({requestKey,expectedCaseRevision:input.caseRevision,expectedSourceRevision:input.sourceRevision,sourceSha256:input.sourceSha256,mode:'native_only'}),signal:AbortSignal.timeout(15000)});
  const value=await response.json();assert.equal(response.status,201,redact(JSON.stringify(value)));const receipt=DocumentReceiptSchema.parse(value);
  for(const key of ['caseId','caseRevision','sourceId','sourceRevision','sourceSha256'])assert.equal(receipt[key],input[key]);assert.notEqual(receipt.jobId,id);assert.equal(receipt.bytes,input.sourceBytes);
  save('owned-job.json',{at:new Date().toISOString(),receipt,requestKey,subject:c.subject,head:processor.head,processorOwner:processor.owner,priorJobId:id});
  console.log(JSON.stringify({queued:true,jobId:receipt.jobId,caseId:receipt.caseId,sourceId:receipt.sourceId}));
}
async function ownedJob(id){const owned=load('owned-job.json');assert.equal(id,owned.receipt.jobId,'Refuse unrelated job: this state owns a different exact job.');assert.equal(owned.subject,c.subject);
  const processor=await ready();assert.equal(owned.head,processor.head);assert.equal(owned.processorOwner,processor.owner);
  const job=await inspectJob(id,'queued');for(const key of ['caseId','caseRevision','sourceId','sourceRevision','sourceSha256'])assert.equal(job.input[key],owned.receipt[key]);
  const remembered=(await db.query("SELECT result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='source-document'",[job.case_id,'document-retry:'+owned.requestKey])).rows[0];assert.deepEqual(remembered?.result,owned.receipt);return job;
}
async function execute(id){
  clean();await ownedJob(id);
  const {runDocumentJob}=await import(pathToFileURL(join(root,'packages/server/src/modules/usp/ingestion/document-worker.ts')));
  await runDocumentJob(id); // DEFAULT transport; no dependency/reader/extractor override.
  const job=await inspectJob(id,'succeeded'),metadata=(await db.query('SELECT result_ref FROM usp_job_metadata WHERE job_id=$1',[id])).rows[0];
  const {readDocumentResult}=await import(pathToFileURL(join(root,'packages/server/src/modules/usp/ingestion/documents.ts')));
  const result=await readDocumentResult(job.input,metadata.result_ref.sha256);assert.equal(result.native.status,'extracted');assert.equal(result.native.format,'text');assert.equal(result.native.code,null);
  assert.equal(result.model.status,'not_requested');assert.equal(result.model.calls.length,0);
  save('owned-job-result.json',{at:new Date().toISOString(),jobId:id,caseId:job.case_id,sourceId:job.source_id,resultSha256:metadata.result_ref.sha256,
    sourceSha256:job.input.sourceSha256,sourceBytes:job.input.sourceBytes,readerSha256:job.input.readerSha256,nativeStatus:result.native.status,nativeFormat:result.native.format,
    parts:result.native.parts.length,warnings:result.native.warnings,modelStatus:result.model.status,modelCalls:0,transport:'default authenticated production HTTP /internal/area/extract'});
  console.log(JSON.stringify({completed:true,jobId:id,resultSha256:metadata.result_ref.sha256,parts:result.native.parts.length}));
}
async function run(id){
  clean();await ownedJob(id);await db.closePool();storage.closeStorageClient();db=storage=undefined;
  const output=command(process.execPath,['--max-old-space-size=512','--import','tsx',self,'_execute',c.dir,c.state,id],145000);
  console.log(output);
}
async function stop(){
  const {record,item}=current();writeFileSync(join(c.state,'processor.log'),docker(['logs','--tail','100',record.containerId]),{flag:'wx'});
  if(item.State.Running)docker(['stop','--time','5',record.containerId]);docker(['rm',record.containerId]);docker(['network','rm',record.networkId]);
  save('processor-cleanup.json',{at:new Date().toISOString(),containerId:record.containerId,networkId:record.networkId,ownedContainerAndNetworkRemoved:true,engineStopped:false});console.log(JSON.stringify({stopped:true,removedOwnedContainer:record.containerId}));
}
try {
  const [action,profile,state,id]=process.argv.slice(2);assert(['start','stop','queue','run-job','_execute'].includes(action)&&profile&&state,'Expected start|stop|queue|run-job <profile> <private-state> [exact-job-id].');
  assert.equal(process.argv.length,['queue','run-job','_execute'].includes(action)?6:5);configure(profile,state);
  if(action==='start')await start();if(action==='stop')await stop();if(action==='queue')await queue(id);if(action==='run-job')await run(id);if(action==='_execute')await execute(id);
}catch(error){console.error(redact(error.stack??error));process.exitCode=1;}finally{if(db)await db.closePool();storage?.closeStorageClient();}

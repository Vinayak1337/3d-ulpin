/** Uses the existing USP isolation contract; starts only a nonce-owned PostgreSQL service. */
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, lstat, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { assertUspIsolation } from '../local-isolation.mjs';
import { redact } from '../../engineering/isolation.mjs';

const root=resolve('.');
await assert.rejects(lstat(join(root,'.env')),{code:'ENOENT'});
const timestamp=new Date().toISOString().replaceAll(':','-');
const output=join(root,'.runtime','usp-fnd04',timestamp);await mkdir(output,{recursive:true});
const results=[];
for (const mode of ['fresh','retained']) {
  const temporary=await mkdtemp(join(tmpdir(),'ulpin-fnd04-'));
  const nonce=randomBytes(8).toString('hex');const colima=process.platform==='darwin';
  const password=randomBytes(32).toString('hex');
  const env={...process.env,ULPIN_ISOLATION_PROFILE:colima?'local-colima':'local-docker',ULPIN_LOCAL_NONCE:nonce,
    DOCKER_CONTEXT:colima?'colima-ulpin':'default',REPO_DATA:'false',ULPIN_BASELINE_PROJECT:`ulpin-usptest-${nonce}`,
    POSTGRES_DB:`ulpin_usptest_${nonce}`,POSTGRES_USER:'ulpin_usptest',POSTGRES_PASSWORD:password,POSTGRES_PORT:'25432',
    DATABASE_URL:`postgresql://ulpin_usptest:${password}@127.0.0.1:25432/ulpin_usptest_${nonce}`,
    S3_ACCESS_KEY:'ulpin_usptest',S3_SECRET_KEY:randomBytes(32).toString('hex'),S3_BUCKET:`ulpin-usptest-${nonce}`,
    S3_ENDPOINT:'http://127.0.0.1:29000',S3_REGION:'us-east-1',S3_PORT:'29000',S3_CONSOLE_PORT:'29001',
    REDIS_URL:'redis://127.0.0.1:26379/0',REDIS_PORT:'26379',GEO_URL:'http://127.0.0.1:28000',GEO_PORT:'28000',
    GEO_SERVICE_TOKEN:randomBytes(32).toString('hex'),ULPIN_TEST_URL:`http://127.0.0.1:${colima?3000:23000}`,
    FND04_MODE:mode,FND04_REPORT:join(output,`${mode}.json`)};
  for (const key of ['DOCKER_HOST','DOCKER_CERT_PATH','NOUS_API_KEY','OPENROUTER_API_KEY']) delete env[key];
  const scope=assertUspIsolation(env);let owns=false;
  const commands=[];
  async function command(label,bin,args,input) {
    const began=new Date().toISOString();const chunks=[];
    const child=spawn(bin,args,{cwd:root,env,stdio:['pipe','pipe','pipe']});
    let bytes=0;for(const pipe of [child.stdout,child.stderr]) pipe.on('data',chunk=>{
      bytes+=chunk.length;if(bytes>8*1024*1024)child.kill('SIGTERM');else chunks.push(chunk);
    });
    child.stdin.on('error',()=>{});child.stdin.end(input);
    const timer=setTimeout(()=>child.kill('SIGTERM'),180000);
    let exitCode;try{exitCode=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done);});}finally{clearTimeout(timer);}
    const text=redact(Buffer.concat(chunks).toString(),env);commands.push({label,command:[bin,...args],exitCode,startedAt:began,finishedAt:new Date().toISOString()});
    if(exitCode!==0)throw new Error(`${label}: exit ${exitCode}: ${text.slice(-1800)}`);
    return text;
  }
  const envFile=join(temporary,'ulpin-local.env');
  await writeFile(envFile,Object.entries(env).filter(([key])=>['POSTGRES_DB','POSTGRES_USER','POSTGRES_PASSWORD','POSTGRES_PORT',
    'S3_ACCESS_KEY','S3_SECRET_KEY','S3_BUCKET','GEO_SERVICE_TOKEN'].includes(key)).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
  const composeBin=colima?'docker-compose':'docker';const composeArgs=[...(colima?[]:['--context','default','compose']),
    '--project-directory',root,'--env-file',envFile,'-p',scope.project,'-f',join(root,'compose.yaml')];
  const compose=(label,args,input)=>command(label,composeBin,[...composeArgs,...args],input);
  try {
    const endpoint=(await command('docker-context','docker',['context','inspect',env.DOCKER_CONTEXT,'--format','{{.Endpoints.docker.Host}}'])).trim();
    assert.equal(endpoint,colima?`unix://${process.env.HOME}/.colima/ulpin/docker.sock`:'unix:///var/run/docker.sock');
    for(const [kind,format] of [['ps','{{.ID}}'],['volume','{{.Name}}']]) {
      const args=kind==='ps'?['ps','-a']:['volume','ls'];
      assert.equal((await command(`empty-${kind}`,'docker',['--context',env.DOCKER_CONTEXT,...args,'--filter',`label=com.docker.compose.project=${scope.project}`,'--format',format])).trim(),'');
    }
    const port=createServer();await new Promise((done,reject)=>{port.once('error',reject);port.listen(25432,'127.0.0.1',done);});
    await new Promise((done,reject)=>port.close(error=>error?reject(error):done()));
    owns=true;await compose('owned-postgres-start',['up','-d','--wait','postgres']);
    if(mode==='retained') {
      const manifest=JSON.parse(await readFile(join(root,'repo-data/manifest.json'),'utf8'));
      const file=join(root,'repo-data',manifest.database.file);assert.equal(await realpath(file),file);
      const bytes=await readFile(file);assert.equal(bytes.length,manifest.database.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.database.sha256);
      await compose('restore-unchanged-retained-regression',['exec','-T','postgres','pg_restore','-U',env.POSTGRES_USER,'-d',scope.database,
        '--no-owner','--no-acl','--schema=public','--exit-on-error','--single-transaction'],bytes);
      const baseline=await command('read-pinned-baseline-migration','git',['show','1a6baf0d832117932c291fa6bfc08a536d8bd26e:apps/web/lib/server/usp/migrations.ts']);
      const baselineFile=join(temporary,'baseline-migration.mjs');
      await writeFile(baselineFile,baseline.replace("'../db'",JSON.stringify(pathToFileURL(join(root,'apps/web/lib/server/db.ts')).href)));
      env.FND04_BASELINE_MIGRATION=baselineFile;
    }
    await command('sql-verification','pnpm',['exec','tsx','--tsconfig','apps/web/tsconfig.json','scripts/usp/gf/FND-04-sql.ts']);
    results.push({mode,status:'passed',commands});
  } catch(error) {results.push({mode,status:'failed',commands,error:redact(String(error),env)});throw error;}
  finally {
    if(owns)await compose('owned-postgres-cleanup',['down','--volumes','--remove-orphans']);
    await writeFile(join(output,'run.json'),JSON.stringify({results,limitation:'Only nonce-owned SQL services; no web server, model provider, reseed or official-source qualification.'},null,2)+'\n');
    await rm(temporary,{recursive:true,force:true});
  }
}
console.log(JSON.stringify({status:'passed',output,modes:results.map(r=>r.mode)}));

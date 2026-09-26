/** Fresh nonce-owned SQL controls only. No .env, seed, snapshot, source material or provider call. */
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
if(existsSync(new URL('../../.env',import.meta.url))) throw new Error('Refusing SQL controls with a root .env present');
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const context=docker('context','show');
if(!['colima-ulpin','default'].includes(context)) throw new Error('An approved local Docker context is required');
const endpoint=docker('context','inspect',context,'--format','{{.Endpoints.docker.Host}}');
if(!endpoint.startsWith('unix://')) throw new Error('This runner refuses remote Docker engines');
const image=docker('image','inspect','postgis/postgis:17-3.5','--format','{{.Id}}');
if(!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('A local pinned PostgreSQL image is required');
const nonce=randomBytes(8).toString('hex'),container=`ulpin-model-control-${nonce}`,
  volume=`ulpin-model-control-${nonce}`,database=`model_control_${nonce}`;
const label=['--label','io.ulpin.task=DEPLOY-01','--label',`io.ulpin.nonce=${nonce}`];
let started=false;let created=false;let exitCode=1;
try {
  docker('volume','create',...label,volume);created=true;
  docker('run','--detach','--name',container,...label,'--network','bridge','--publish','127.0.0.1::5432',
    '--env','POSTGRES_HOST_AUTH_METHOD=trust','--env','POSTGRES_USER=model_control','--env',`POSTGRES_DB=${database}`,
    '--volume',`${volume}:/var/lib/postgresql/data`,image);started=true;
  for(let attempt=0;attempt<30;attempt++) {
    const ready=spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','model_control','-d',database],{stdio:'ignore'});
    if(ready.status===0) break;
    if(attempt===29) throw new Error('Owned PostgreSQL controls did not become ready');
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  const info=JSON.parse(docker('inspect',container))[0];
  if(info.Config.Labels['io.ulpin.nonce']!==nonce) throw new Error('Container ownership changed');
  const binding=info.NetworkSettings.Ports['5432/tcp'][0];
  if(binding.HostIp!=='127.0.0.1') throw new Error('SQL control port is not loopback');
  const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,
    ULPIN_MODEL_SQL_URL:`postgresql://model_control@127.0.0.1:${binding.HostPort}/${database}`,
    ULPIN_MODEL_SQL_NONCE:nonce};
  console.log(JSON.stringify({task:'DEPLOY-01',nonce,context,image,container,volume,database,port:binding.HostPort,scope:'control-plane only'}));
  const result=spawnSync('pnpm',['exec','tsx','--test','tests/model-gateway/sql.test.ts'],{cwd:root,env,stdio:'inherit'});
  exitCode=result.status??1;
} finally {
  if(started) {
    const info=JSON.parse(docker('inspect',container))[0];
    if(info.Config.Labels['io.ulpin.nonce']!==nonce || info.Config.Labels['io.ulpin.task']!=='DEPLOY-01')
      throw new Error('Refusing to stop a service whose ownership changed');
    docker('stop','--time','10',container);
  }
  console.log(JSON.stringify({task:'DEPLOY-01',container,stopped:started,volume,preserved:created,exitCode}));
}
process.exitCode=exitCode;

import assert from 'node:assert/strict';
import test from 'node:test';
import {resolve} from 'node:path';
import {assertUspIsolation,localNestApiPort,localOperatorProcessProvenance} from '../scripts/usp/local-isolation.mjs';
import {assertIsolation, generatedEnvironment, hostedScope, redact, testProcessEnvironment} from '../scripts/engineering/isolation.mjs';

const runner = () => ({
  GITHUB_ACTIONS:'true', RUNNER_ENVIRONMENT:'github-hosted', RUNNER_OS:'Linux',
  GITHUB_REPOSITORY:'Vinayak1337/3d-ulpin', GITHUB_RUN_ID:'123456789', GITHUB_RUN_ATTEMPT:'2',
});
const environment = () => { const base=runner(); return {...base,...generatedEnvironment(base,()=> 'a'.repeat(64))}; };

test('generated runner resources have a unique declared scope and explicit test endpoints', () => {
  const env=environment(), scope=assertIsolation(env);
  assert.equal(scope.database,'ulpin_t001_123456789_2');
  assert.equal(scope.project,'ulpin-t001-123456789-2');
  assert.notEqual(hostedScope({...runner(), GITHUB_RUN_ATTEMPT:'3'}).project,scope.project);
});

for (const [key,value] of Object.entries({
  GITHUB_ACTIONS:'false', RUNNER_ENVIRONMENT:'self-hosted', RUNNER_OS:'Windows',
  GITHUB_REPOSITORY:'other/3d-ulpin', GITHUB_RUN_ID:'123;exec', GITHUB_RUN_ATTEMPT:'0',
  REPO_DATA:'true', ULPIN_BASELINE_PROJECT:'ulpin-repo', POSTGRES_DB:'ulpin',
  S3_BUCKET:'ulpin-repo', POSTGRES_USER:'ulpin', POSTGRES_PASSWORD:'existing-secret',
  S3_SECRET_KEY:'', GEO_SERVICE_TOKEN:'', POSTGRES_PORT:'15433', S3_PORT:'19010',
  DOCKER_HOST:'tcp://remote:2375', DOCKER_CONTEXT:'production', NOUS_API_KEY:'private-token',
})) test(`rejects unsafe or inconsistent ${key}`, () => assert.throws(()=>assertIsolation({...environment(),[key]:value})));

for (const [key,value] of [
  ['DATABASE_URL','postgresql://ulpin_t001:wrong@127.0.0.1:25432/ulpin_t001_123456789_2'],
  ['DATABASE_URL','postgresql://ulpin:secret@127.0.0.1:15433/ulpin'],
  ['S3_ENDPOINT','https://storage.example.com:29000/'],
  ['S3_ENDPOINT','http://127.0.0.1:29000/?bucket=private'],
  ['S3_ENDPOINT','http://user:secret@127.0.0.1:29000/'],
  ['GEO_URL','http://localhost:28000/'],
  ['REDIS_URL','redis://127.0.0.1:26379/1'],
  ['ULPIN_TEST_URL','http://127.0.0.1:3000/legacy'],
]) test(`rejects substituted endpoint ${key}: ${new URL(value).pathname}`, () => assert.throws(()=>assertIsolation({...environment(),[key]:value})));

test('reports redact complete credential-bearing URLs and individual secrets', () => {
  const env=environment();
  const input=`database ${env.DATABASE_URL} storage ${env.S3_SECRET_KEY} token ${env.GEO_SERVICE_TOKEN}`;
  const output=redact(input,env);
  assert(!output.includes(env.POSTGRES_PASSWORD));
  assert(!output.includes('postgresql://'));
  assert(output.includes('[redacted]'));
});

test('preparation refuses invalid random-secret providers instead of weakening validation', () => {
  assert.throws(()=>generatedEnvironment(runner(),()=> 'short'));
});

test('child processes resolve fixtures inside the explicit checkout instead of their working directory', () => {
  const env=environment(), root=resolve('test-checkout');
  const child=testProcessEnvironment({...env,ULPIN_FIXTURE_ROOT:'/unrelated/path'},root);
  assert.equal(child.ULPIN_FIXTURE_ROOT,resolve(root,'fixtures'));
  assert.equal(child.DATABASE_URL,env.DATABASE_URL);
  assert.equal(env.ULPIN_FIXTURE_ROOT,undefined);
  assert.throws(()=>testProcessEnvironment(env,'relative-root'));
});

const nonce='a'.repeat(16),secret='a'.repeat(64),subject=localOperatorProcessProvenance().subject;
const nestEnvironment=port=>({REPO_DATA:'false',ULPIN_ISOLATION_PROFILE:'local-nest',DOCKER_CONTEXT:process.platform==='win32'?'desktop-linux':process.platform==='darwin'?'colima-ulpin':'default',ULPIN_LOCAL_NONCE:nonce,ULPIN_BASELINE_PROJECT:`ulpin-usptest-${nonce}`,
  POSTGRES_DB:`ulpin_usptest_${nonce}`,POSTGRES_USER:'ulpin_usptest',POSTGRES_PASSWORD:secret,POSTGRES_PORT:'25432',DATABASE_URL:`postgresql://ulpin_usptest:${secret}@127.0.0.1:25432/ulpin_usptest_${nonce}`,
  S3_ACCESS_KEY:'ulpin_usptest',S3_SECRET_KEY:secret,S3_BUCKET:`ulpin-usptest-${nonce}`,S3_ENDPOINT:'http://127.0.0.1:29000/',S3_PORT:'29000',S3_CONSOLE_PORT:'29001',GEO_PORT:'28000',GEO_URL:'http://127.0.0.1:28000/',GEO_SERVICE_TOKEN:secret,REDIS_URL:'redis://127.0.0.1:26379/0',REDIS_PORT:'26379',
  HOST:'127.0.0.1',ULPIN_NEST_API_PORT:port,PORT:port,API_PORT:port,ULPIN_LOOPBACK_PORTS:port,ULPIN_TEST_URL:`http://127.0.0.1:${port}/`,ULPIN_LOCAL_OPERATOR_SUBJECT:subject});
test('saved explicit API port stays consistent with every loopback guard',()=>{
  assert.equal(localNestApiPort(),3188);assert.equal(localNestApiPort('3189'),3189);
  assert.doesNotThrow(()=>assertUspIsolation(nestEnvironment('3189')));
  const prior=nestEnvironment('3188');delete prior.ULPIN_NEST_API_PORT;assert.doesNotThrow(()=>assertUspIsolation(prior));
  for(const [key,value] of [['PORT','3188'],['API_PORT','3188'],['ULPIN_LOOPBACK_PORTS','3188'],['ULPIN_TEST_URL','http://127.0.0.1:3188/'],['HOST','0.0.0.0'],['ULPIN_TEST_URL','http://localhost:3189/']])
    assert.throws(()=>assertUspIsolation({...nestEnvironment('3189'),[key]:value}));
});
test('invalid, privileged and reserved service API port choices are rejected',()=>{
  for(const value of ['0','80','1023','65536','03189','3189.0','3189;exec','25432','29000','29001','26379','28000','5432','6379','8000','9000','9001'])assert.throws(()=>localNestApiPort(value));
});

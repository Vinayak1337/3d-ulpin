import assert from 'node:assert/strict';
import test from 'node:test';
import {resolve} from 'node:path';
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

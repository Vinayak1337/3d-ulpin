// Every file here is a temporary one with made-up values; no runtime's own folder or settings are opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  definedRuntime, demoDir, demoDocumentFile, demoFile, demoOcrFile, demoOcrProfileFile, demoProject, demoRuntime,
  demoTabularFile, readDemo, readDemoSettings, runtimeDefinition, runtimeSettings,
} from './demo-config.mjs';

const secretKeys = ['POSTGRES_PASSWORD', 'S3_SECRET_KEY', 'GEO_SERVICE_TOKEN'];
const madeUpSecrets = () => {
  const values = ['a1', 'b2', 'c3'].map(pair => pair.repeat(32));
  return () => values.shift();
};
/** Secrets are compared by presence and length only: each is replaced by its length before any comparison. */
function withoutSecrets(env) {
  const secrets = secretKeys.map(key => env[key]);
  assert.ok(secrets.every(value => typeof value === 'string' && value.length > 0));
  return Object.entries(env).map(([key, value]) =>
    [key, secrets.reduce((text, secret) => text.replaceAll(secret, `<${secret.length}>`), value)]);
}
function settingsFile(env) {
  // Not named *.env: the guard these tests run under refuses every file of that kind, made-up or not.
  const file = join(mkdtempSync(join(tmpdir(), 'runtime-name-')), 'settings.txt');
  writeFileSync(file, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
  return file;
}

const demoFolder = 'E:/BhuAayam-data/runtime/ulpin-demo';
const demoPorts = {
  POSTGRES_PORT: '15434', S3_PORT: '19020', S3_CONSOLE_PORT: '19021', REDIS_PORT: '16381', GEO_PORT: '18002',
  API_PORT: '3194',
};

test('ulpin-demo resolves to the values it was created with, and the old names still export them', () => {
  const expected = {
    name: 'ulpin-demo', rehearsal: false, dir: demoFolder, project: 'ulpin-demo', bucket: 'ulpin-demo',
    database: 'ulpin_demo', databaseUser: 'ulpin_demo', objectAccessKey: 'ulpindemo',
    operatorSubject: 'selection-demo-runtime', ports: demoPorts, file: join(demoFolder, 'demo.env'),
    marker: join(demoFolder, 'bootstrap.complete.json'), ocrFile: join(demoFolder, 'ocr-paths.json'),
    ocrProfileFile: join(demoFolder, 'ocr-paths-profile.json'),
    tabularFile: join(demoFolder, 'tabular-paths.json'),
    documentFile: join(demoFolder, 'document-runtime-paths.json'), modelDir: `${demoFolder}/models`,
    servingCheckout: 'E:/Projects/ulpin-wt/demo', composeFile: 'scripts/platform/demo.compose.json',
    processorImage: 'ulpin-geo:demo-s03', buildsProcessorImage: true,
  };
  for (const definition of [runtimeDefinition(), runtimeDefinition('ulpin-demo'), definedRuntime()]) {
    assert.deepEqual({ ...definition, ports: { ...definition.ports } }, expected);
  }
  assert.deepEqual(
    [demoRuntime, demoDir, demoProject, demoFile, demoOcrFile, demoOcrProfileFile, demoTabularFile, demoDocumentFile],
    ['ulpin-demo', demoFolder, 'ulpin-demo', expected.file, expected.ocrFile, expected.ocrProfileFile,
      expected.tabularFile, expected.documentFile],
  );
});

test('the settings written for ulpin-demo are today\'s, key for key and in order; secrets by length only', () => {
  const env = runtimeSettings('ulpin-demo', madeUpSecrets());
  assert.deepEqual(withoutSecrets(env), [
    ...Object.entries(demoPorts), ['ULPIN_PROFILE', 'demo'], ['COMPOSE_PROJECT_NAME', 'ulpin-demo'],
    ['REPO_DATA', 'false'], ['POSTGRES_DB', 'ulpin_demo'], ['POSTGRES_USER', 'ulpin_demo'],
    ['POSTGRES_PASSWORD', '<64>'], ['DATABASE_URL', 'postgresql://ulpin_demo:<64>@127.0.0.1:15434/ulpin_demo'],
    ['S3_ENDPOINT', 'http://127.0.0.1:19020'], ['S3_ACCESS_KEY', 'ulpindemo'], ['S3_SECRET_KEY', '<64>'],
    ['S3_BUCKET', 'ulpin-demo'], ['S3_REGION', 'us-east-1'], ['GEO_SERVICE_TOKEN', '<64>'],
    ['GEO_URL', 'http://127.0.0.1:18002'], ['REDIS_URL', 'redis://127.0.0.1:16381/0'],
    ['ULPIN_LOCAL_OPERATOR_SUBJECT', 'selection-demo-runtime'], ['ULPIN_MODEL_GATEWAY_ENABLED', '0'],
    ['ULPIN_DEMO_MODEL_DIR', `${demoFolder}/models`],
  ]);
  assert.equal(new Set(secretKeys.map(key => env[key])).size, 3);
  const file = settingsFile(env);
  assert.deepEqual(withoutSecrets(readDemoSettings(file)), withoutSecrets(env));
  assert.throws(() => readDemoSettings(file, 'ulpin-reh-01'), /Unexpected demo setting [A-Z0-9_]+; refusing/);
});

test('ulpin-reh-01 and ulpin-reh-02 have their own folder, project, bucket, database, subject and ports', () => {
  const [first, second] = ['ulpin-reh-01', 'ulpin-reh-02'].map(name => runtimeDefinition(name));
  assert.deepEqual({ ...first.ports }, {
    POSTGRES_PORT: '21011', S3_PORT: '21012', S3_CONSOLE_PORT: '21013', REDIS_PORT: '21014', GEO_PORT: '21015',
    API_PORT: '21016',
  });
  assert.deepEqual(Object.values(second.ports), ['21021', '21022', '21023', '21024', '21025', '21026']);
  assert.deepEqual(
    [first.dir, first.project, first.bucket, first.database, first.databaseUser, first.operatorSubject],
    ['E:/BhuAayam-data/runtime/ulpin-reh-01', 'ulpin-reh-01', 'ulpin-reh-01', 'ulpin_reh_01', 'ulpin_reh_01',
      'rehearsal-runtime-ulpin-reh-01'],
  );
  assert.equal(first.file, join(first.dir, 'runtime.env'));
  const runtimes = [runtimeDefinition(), first, second];
  const distinct = ['dir', 'project', 'bucket', 'database', 'databaseUser', 'objectAccessKey', 'operatorSubject',
    'file', 'marker', 'ocrFile', 'ocrProfileFile', 'tabularFile', 'documentFile', 'modelDir', 'servingCheckout'];
  for (const key of distinct) assert.equal(new Set(runtimes.map(runtime => runtime[key])).size, 3, key);
  assert.equal(new Set(runtimes.flatMap(runtime => Object.values(runtime.ports))).size, 18);
  assert.ok(first.rehearsal && second.rehearsal && !runtimes[0].rehearsal);
});

test('no rehearsal number shares a port with the demo, with 3194 or with another rehearsal', () => {
  const numbers = Array.from({ length: 100 }, (_unused, index) => String(index).padStart(2, '0'));
  const ports = numbers.flatMap(number => Object.values(runtimeDefinition(`ulpin-reh-${number}`).ports));
  assert.equal(new Set(ports).size, 600);
  assert.ok(ports.every(port => Number(port) >= 21001 && Number(port) <= 21996));
  assert.ok(ports.every(port => !Object.values(demoPorts).includes(port) && port !== '3194'));
});

test('a rehearsal\'s settings are accepted under its own name only, and carry its operator subject', () => {
  const env = runtimeSettings('ulpin-reh-01', madeUpSecrets());
  assert.equal(env.ULPIN_LOCAL_OPERATOR_SUBJECT, 'rehearsal-runtime-ulpin-reh-01');
  assert.equal(env.ULPIN_MODEL_GATEWAY_ENABLED, '0');
  assert.deepEqual([env.COMPOSE_PROJECT_NAME, env.S3_BUCKET, env.POSTGRES_DB, env.API_PORT, env.S3_ACCESS_KEY],
    ['ulpin-reh-01', 'ulpin-reh-01', 'ulpin_reh_01', '21016', 'ulpinreh01']);
  assert.equal(env.ULPIN_DEMO_MODEL_DIR, 'E:/BhuAayam-data/runtime/ulpin-reh-01/models');
  const file = settingsFile(env);
  assert.equal(readDemoSettings(file, 'ulpin-reh-01').COMPOSE_PROJECT_NAME, 'ulpin-reh-01');
  for (const other of [undefined, 'ulpin-demo', 'ulpin-reh-02']) {
    assert.throws(() => readDemoSettings(file, other), /Unexpected demo setting [A-Z0-9_]+; refusing/);
  }
});

test('any other name is refused before anything is read', () => {
  const refused = ['', 'ulpin', 'ulpin-demo ', 'ULPIN-DEMO', 'ulpin-demo-2', 'ulpin-reh-1', 'ulpin-reh-001',
    'ulpin-reh-0a', 'ulpin-reh-01/..', '../ulpin-demo', 'ulpin-reh-01\n', null, 7, ['ulpin-demo']];
  for (const name of refused) {
    assert.throws(() => runtimeDefinition(name), /^Error: Unknown runtime name: use ulpin-demo or ulpin-reh-NN/);
  }
  for (const reader of [readDemo, name => readDemoSettings('unread.txt', name), name => runtimeSettings(name)]) {
    assert.throws(() => reader('ulpin-prod'), /Unknown runtime name/);
    assert.throws(() => reader({ ...runtimeDefinition('ulpin-reh-01') }), /only a validated runtime name/);
  }
});

test('a definition on a synthetic folder is the same runtime in another place', () => {
  const folder = mkdtempSync(join(tmpdir(), 'runtime-name-'));
  const synthetic = runtimeDefinition('ulpin-reh-01', folder);
  const { dir, file, marker, ocrFile, ocrProfileFile, tabularFile, documentFile, modelDir, ...rest } = synthetic;
  const real = runtimeDefinition('ulpin-reh-01');
  assert.equal(dir, `${folder}/ulpin-reh-01`);
  for (const path of [file, marker, ocrFile, ocrProfileFile, tabularFile, documentFile, modelDir]) {
    assert.match(relative(dir, path), /^[a-z][a-z.-]+$/, path);
  }
  for (const [key, value] of Object.entries(rest)) assert.deepEqual(value, real[key], key);
  assert.equal(definedRuntime(synthetic), synthetic);
});

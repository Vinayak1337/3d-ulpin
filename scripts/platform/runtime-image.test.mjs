// No Docker command is run here: steps are compared as lists, and process records are made-up files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtimeDefinition } from './demo-config.mjs';
import { assertServingCheckout, bootstrapSteps, composeArguments } from './demo.mjs';
import { buildDocumentRuntime, runtimeBuildFolder, switchOcrPython } from './demo-document-runtime.mjs';

const rehearsals = ['ulpin-reh-01', 'ulpin-reh-02'];
const refusal = /never builds or tags a processor image: it reuses the reviewed ulpin-geo:demo-k3b\./;
const stopped = () => null;

test('given a rehearsal name, no compose step can build or tag an image', () => {
  const steps = [
    ['build', 'geo'], ['-f', 'made-up-overlay.json', 'build', 'geo'], ['build'], ['watch'], ['push', 'geo'],
    ['commit', 'geo', 'ulpin-geo:demo-k3b'], ['publish', 'made-up/repository'],
    ['--profile', 'app', 'up', '-d', '--build'], ['--profile', 'app', 'up', '-d', '--no-build', '--build'],
    ['run', '--build', '--rm', 'minio-init'], ['up', '-d', 'postgres'], ['--profile', 'app', 'create'],
  ];
  for (const name of rehearsals) {
    for (const step of steps) assert.throws(() => composeArguments('made-up-context', step, name), refusal);
  }
  // The demo keeps every step it has today, its own build and K3b's overlay build included.
  for (const step of steps) assert.doesNotThrow(() => composeArguments('made-up-context', step));
});

test('a rehearsal\'s create steps hold no build and check the reviewed image; the demo\'s steps are today\'s', () => {
  assert.deepEqual(bootstrapSteps(), [
    { compose: ['up', '-d', '--no-recreate', '--wait', '--wait-timeout', '90', 'postgres', 'minio', 'redis'] },
    { compose: ['run', '--rm', 'minio-init'] },
    { migrate: true },
    { compose: ['build', 'geo'], timeout: 900000 },
    { compose: ['--profile', 'app', 'up', '-d', '--no-build', '--no-recreate', '--wait', '--wait-timeout', '120'] },
  ]);
  for (const name of rehearsals) {
    const steps = bootstrapSteps(name);
    const composed = steps.filter(step => step.compose).map(step => step.compose);
    assert.equal(composed.length, 3);
    assert.equal(composed.flat().some(arg => arg === 'build' || arg === '--build'), false);
    assert.ok(composed.filter(args => args.includes('up')).every(args => args.includes('--no-build')));
    assert.deepEqual(steps[3], { reviewedImage: 'ulpin-geo:demo-k3b' });
    for (const args of composed) assert.doesNotThrow(() => composeArguments('made-up-context', args, name));
  }
});

test('the rehearsal definition names the reviewed image with no build section; the demo\'s file is as it was', () => {
  const rehearsal = runtimeDefinition('ulpin-reh-01');
  assert.deepEqual([rehearsal.processorImage, rehearsal.buildsProcessorImage, rehearsal.composeFile],
    ['ulpin-geo:demo-k3b', false, 'scripts/platform/rehearsal.compose.yaml']);
  const lines = readFileSync(new URL('./rehearsal.compose.yaml', import.meta.url), 'utf8').split(/\r?\n/)
    .filter(line => line.trim() && !line.startsWith('#'));
  const count = text => lines.filter(line => line.trim() === text).length;
  assert.equal(count(`image: ${rehearsal.processorImage}`), 2);
  assert.equal(count('pull_policy: never'), 2);
  assert.equal(count('ULPIN_PROFILE: demo'), 2);
  assert.deepEqual(lines.filter(line => /build|image:/.test(line)).map(line => line.trim()),
    ['image: ulpin-geo:demo-k3b', 'build: !reset null', 'image: ulpin-geo:demo-k3b']);
  const volume = [{ type: 'bind', source: '${ULPIN_DEMO_MODEL_DIR:?Demo model directory missing}',
    target: '/models', read_only: true }];
  const demoFile = JSON.parse(readFileSync(new URL('./demo.compose.json', import.meta.url), 'utf8'));
  assert.deepEqual(demoFile, { services: {
    geo: { image: 'ulpin-geo:demo-s03', volumes: volume }, worker: { image: 'ulpin-geo:demo-s03', volumes: volume },
  } });
  assert.deepEqual([runtimeDefinition().processorImage, runtimeDefinition().buildsProcessorImage],
    ['ulpin-geo:demo-s03', true]);
});

test('the document runtime builder checks the named runtime\'s own checkout and its own process records', () => {
  const asked = [];
  const owned = (label, runtime) => { asked.push(`${runtime.name}/${label}`); return null; };
  const own = 'E:/Projects/ulpin-wt/ulpin-reh-01';
  assert.equal(runtimeBuildFolder('ulpin-reh-01', undefined, { checkout: own, owned }),
    'E:/BhuAayam-data/runtime/ulpin-reh-01');
  assert.equal(runtimeBuildFolder('ulpin-demo', undefined, { checkout: 'E:/Projects/ulpin-wt/demo', owned }),
    'E:/BhuAayam-data/runtime/ulpin-demo');
  assert.deepEqual(asked, ['ulpin-reh-01/api', 'ulpin-reh-01/dispatcher', 'ulpin-demo/api', 'ulpin-demo/dispatcher']);
  const elsewhere = { checkout: 'E:/Projects/ulpin-wt/demo', owned: stopped };
  assert.throws(() => runtimeBuildFolder('ulpin-reh-01', undefined, elsewhere),
    /^Error: Normal document runtime build requires the ulpin-reh-01 serving checkout; use --dry-run --out/);
  assert.throws(() => runtimeBuildFolder('ulpin-demo', undefined, { checkout: own, owned: stopped }),
    /^Error: Normal document runtime build requires the demo serving checkout; use --dry-run --out elsewhere\.$/);
  const running = (_label, runtime) => runtime.name === 'ulpin-reh-01' ? { pid: 1 } : null;
  assert.throws(() => runtimeBuildFolder('ulpin-reh-01', undefined, { checkout: own, owned: running }),
    /^Error: Stop the recorded ulpin-reh-01 native processes before rebuilding document runtime keys\.$/);
  assert.equal(runtimeBuildFolder('ulpin-reh-02', undefined,
    { checkout: 'E:/Projects/ulpin-wt/ulpin-reh-02', owned: running }), 'E:/BhuAayam-data/runtime/ulpin-reh-02');
});

test('with the real record reader, the builder reads the records in that runtime\'s folder and no other', () => {
  const folder = mkdtempSync(join(tmpdir(), 'runtime-image-'));
  const [first, second] = rehearsals.map(name => runtimeDefinition(name, folder));
  for (const runtime of [first, second]) mkdirSync(runtime.dir, { recursive: true });
  // A record that could only be refused if it is read: another runtime's name inside the second's folder.
  const stray = { project: first.project, label: 'api', pid: 1, creationDate: 'made-up', executable: 'made-up',
    entry: 'made-up', preload: 'made-up' };
  writeFileSync(join(second.dir, 'api.process.json'), JSON.stringify(stray) + '\n');
  assert.equal(runtimeBuildFolder(first, undefined, { checkout: first.servingCheckout }), first.dir);
  assert.throws(() => runtimeBuildFolder(second, undefined, { checkout: second.servingCheckout }),
    /Unexpected process ownership record/);
});

test('the builder and the switch refuse an unknown name, and a rehearsal name outside its own checkout', () => {
  for (const action of [buildDocumentRuntime, switchOcrPython]) {
    assert.throws(() => action({ runtime: 'ulpin-prod', python: 'made-up' }), /Unknown runtime name/);
    assert.throws(() => action({ runtime: 'ulpin-reh-01', python: 'made-up' }),
      /requires the ulpin-reh-01 serving checkout/);
    assert.throws(() => action({ python: 'made-up' }), /requires the demo serving checkout/);
  }
});

test('a rehearsal starts from its own checkout only; the demo\'s start is not given a new condition', () => {
  assert.doesNotThrow(() => assertServingCheckout('ulpin-reh-01', 'E:/Projects/ulpin-wt/ulpin-reh-01'));
  assert.doesNotThrow(() => assertServingCheckout('ulpin-reh-01', 'e:\\projects\\ulpin-wt\\ulpin-reh-01\\'));
  for (const checkout of ['E:/Projects/ulpin-wt/demo', 'E:/Projects/ulpin-wt/ulpin-reh-02', 'E:/Projects/3d-ulpin']) {
    assert.throws(() => assertServingCheckout('ulpin-reh-01', checkout),
      /^Error: ulpin-reh-01 is served from E:\/Projects\/ulpin-wt\/ulpin-reh-01 only; start it from there\.$/);
    assert.doesNotThrow(() => assertServingCheckout('ulpin-demo', checkout));
  }
});

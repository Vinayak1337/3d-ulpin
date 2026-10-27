// No Docker command is run here: steps are compared as lists, and process records are made-up files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtimeDefinition } from './demo-config.mjs';
import { assertPinnedImage, assertServingCheckout, bootstrapSteps, composeArguments } from './demo.mjs';
import { readPin, revisionLabel, treeLabel } from './processor-image-pin.mjs';
import { buildDocumentRuntime, runtimeBuildFolder, switchOcrPython } from './demo-document-runtime.mjs';

const rehearsals = ['ulpin-reh-01', 'ulpin-reh-02'];
const runtimes = ['ulpin-demo', ...rehearsals];
const pinned = 'ulpin-geo:git-22003ea3d878';
const refusal = /never builds or tags a processor image: it runs the pinned ulpin-geo:git-22003ea3d878\./;
const stopped = () => null;

test('for every runtime, the demo included, no compose step can build or tag an image', () => {
  const steps = [
    ['build', 'geo'], ['-f', 'made-up-overlay.json', 'build', 'geo'], ['build'], ['watch'], ['push', 'geo'],
    ['commit', 'geo', 'ulpin-geo:demo-k3b'], ['publish', 'made-up/repository'],
    ['--profile', 'app', 'up', '-d', '--build'], ['--profile', 'app', 'up', '-d', '--no-build', '--build'],
    ['run', '--build', '--rm', 'minio-init'], ['up', '-d', 'postgres'], ['--profile', 'app', 'create'],
  ];
  for (const name of runtimes) {
    for (const step of steps) assert.throws(() => composeArguments('made-up-context', step, name), refusal);
  }
  assert.throws(() => composeArguments('made-up-context', ['build', 'geo']), refusal);
});

test('every runtime\'s create steps are the same, hold no build and check the pinned image', () => {
  for (const name of runtimes) {
    const steps = bootstrapSteps(name);
    const composed = steps.filter(step => step.compose).map(step => step.compose);
    assert.deepEqual(steps, [
      { compose: ['up', '-d', '--no-build', '--no-recreate', '--wait', '--wait-timeout', '90', 'postgres', 'minio',
        'redis'] },
      { compose: ['run', '--rm', 'minio-init'] },
      { migrate: true },
      { pinnedImage: pinned },
      { compose: ['--profile', 'app', 'up', '-d', '--no-build', '--no-recreate', '--wait', '--wait-timeout', '120'] },
    ]);
    for (const args of composed) assert.doesNotThrow(() => composeArguments('made-up-context', args, name));
  }
});

test('one processors file names the pin\'s image by variable, with no build section; demo and rehearsals share it', () => {
  for (const name of runtimes) {
    const definition = runtimeDefinition(name);
    assert.deepEqual([definition.processorImage, definition.composeFile],
      [pinned, 'scripts/platform/processors.compose.yaml']);
    assert.equal('buildsProcessorImage' in definition, false);
  }
  const lines = readFileSync(new URL('./processors.compose.yaml', import.meta.url), 'utf8').split(/\r?\n/)
    .filter(line => line.trim() && !line.startsWith('#'));
  const count = text => lines.filter(line => line.trim() === text).length;
  const image = 'image: ${ULPIN_PROCESSOR_IMAGE:?Processor image pin missing}';
  assert.equal(count(image), 2);
  assert.equal(count('pull_policy: never'), 2);
  assert.equal(count('ULPIN_PROFILE: demo'), 2);
  assert.deepEqual(lines.filter(line => /build|image:/.test(line)).map(line => line.trim()),
    [image, 'build: !reset null', image]);
  assert.equal(existsSync(new URL('./demo.compose.json', import.meta.url)), false);
});

test('the pinned image is checked by its labels before processors are created; a stray or missing one is refused', () => {
  const pin = readPin();
  const engineWith = labels => ({ docker: (...args) => {
    assert.deepEqual(args, ['image', 'inspect', pinned, '--format', '{{json .Config.Labels}}']);
    if (labels === undefined) throw new Error('No such image');
    return JSON.stringify(labels);
  } });
  const good = { [revisionLabel]: pin.commit, [treeLabel]: pin.servicesTree, 'made-up': 'kept out' };
  assert.doesNotThrow(() => assertPinnedImage(engineWith(good), pin));
  assert.throws(() => assertPinnedImage(engineWith(undefined), pin),
    /^Error: The pinned image ulpin-geo:git-22003ea3d878 is not on this engine; build it with processor-image\.mjs\.$/);
  assert.throws(() => assertPinnedImage(engineWith(null), pin), /carries no build commit.*Nothing was created\.$/);
  assert.throws(() => assertPinnedImage(engineWith({ ...good, [treeLabel]: 'f'.repeat(40) }), pin),
    /was built from 22003ea3d878, not the pinned 22003ea3d878\./);
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

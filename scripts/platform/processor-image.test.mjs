// No Docker command is run here: images and containers are made-up records, and git answers are given.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './runtime.mjs';
import { composeArguments } from './demo.mjs';
import {
  imageTag, parsePin, processorImageProblems, readPin, revisionLabel, treeLabel,
} from './processor-image-pin.mjs';
import { buildArguments, buildProblems, parseArguments, rollNeeded, rollSteps } from './processor-image.mjs';

const commit = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const pin = parsePin({ commit, servicesTree: tree, image: 'ulpin-geo:git-aaaaaaaaaaaa' });
const built = { [revisionLabel]: commit, [treeLabel]: tree };
const processors = (image = pin.image, labels = built) => ['geo', 'worker'].map(service => ({ service, image, labels }));

test('the committed pin names its image by its commit, and the commit holds the pinned services tree', () => {
  const committed = readPin();
  assert.equal(committed.image, imageTag(committed.commit));
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(new URL('./processor-image.json', import.meta.url), 'utf8'))),
    ['commit', 'servicesTree', 'image']);
  let held;
  try { held = execFileSync('git', ['-C', root, 'rev-parse', `${committed.commit}:services/geo`], { encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { held = null; }
  if (held !== null) assert.equal(held, committed.servicesTree);
});

test('a pin is refused unless it holds exactly a full commit, its tree and the tag named by that commit', () => {
  assert.equal(imageTag(commit), 'ulpin-geo:git-aaaaaaaaaaaa');
  for (const value of [
    null, [], { commit, servicesTree: tree }, { ...pin, extra: 1 }, { ...pin, commit: 'a'.repeat(12) },
    { ...pin, servicesTree: 'HEAD' }, { ...pin, image: 'ulpin-geo:demo-k3b' }, { ...pin, image: 'ulpin-geo:git-aaaaaaaaaaab' },
  ]) assert.throws(() => parsePin(value));
});

test('processors on the pinned build of this checkout\'s services pass', () => {
  assert.deepEqual(processorImageProblems(processors(), pin, tree), []);
});

test('the doctor sees a stale image, an unpinned one, an unlabelled one and a pin that lags the checkout', () => {
  const later = 'c'.repeat(40);
  // REH2: the old reviewed image, made before builds carried labels.
  assert.deepEqual(processorImageProblems(processors('ulpin-geo:demo-k3b', {}), pin, tree), [
    'geo runs ulpin-geo:demo-k3b, not the pinned ulpin-geo:git-aaaaaaaaaaaa.',
    'geo\'s image carries no build commit; it is not a pinned build.',
    'worker runs ulpin-geo:demo-k3b, not the pinned ulpin-geo:git-aaaaaaaaaaaa.',
    'worker\'s image carries no build commit; it is not a pinned build.',
  ]);
  // The checkout moved on in services/geo; the pin and the image did not.
  assert.deepEqual(processorImageProblems(processors(), pin, later), [
    'The pin (aaaaaaaaaaaa) lags this checkout: its services/geo differs; pin an image built from this commit.',
    'geo\'s image is stale: its services/geo (bbbbbbbbbbbb) differs from this checkout\'s (cccccccccccc).',
    'worker\'s image is stale: its services/geo (bbbbbbbbbbbb) differs from this checkout\'s (cccccccccccc).',
  ]);
  // The pin moved on and the checkout with it; the containers were not rolled.
  const old = { [revisionLabel]: 'd'.repeat(40), [treeLabel]: 'e'.repeat(40) };
  const problems = processorImageProblems(processors('ulpin-geo:git-dddddddddddd', old), pin, tree);
  assert.equal(problems.length, 6);
  assert.ok(problems.includes('geo\'s image was built from dddddddddddd, not the pinned aaaaaaaaaaaa.'));
  // The tag is the pinned one but the image under it was built from other files, or was removed.
  assert.deepEqual(processorImageProblems(processors(pin.image, { ...built, [treeLabel]: later }), pin, tree).length, 4);
  assert.match(processorImageProblems(processors(pin.image, null), pin, tree)[0], /carries no build commit/);
  // One worker, or two geo containers, is not a runtime the doctor can vouch for.
  assert.deepEqual(processorImageProblems(processors().slice(0, 1), pin, tree), ['Expected one worker container.']);
});

test('the build is one docker build of services/geo with the pinned tag and both labels', () => {
  assert.deepEqual(buildArguments('made-up-context', pin, 'made-up-checkout'), ['--context', 'made-up-context', 'build',
    '--label', `${revisionLabel}=${commit}`, '--label', `${treeLabel}=${tree}`,
    '--tag', 'ulpin-geo:git-aaaaaaaaaaaa', join('made-up-checkout', 'services/geo')]);
});

test('the build is refused from another services tree, a changed one, or a pin whose commit lacks the tree', () => {
  const git = answers => args => {
    const key = args.join(' ');
    if (!(key in answers)) throw new Error('unknown revision');
    return answers[key];
  };
  const clean = {
    'rev-parse HEAD:services/geo': tree, 'status --porcelain --untracked-files=all -- services/geo': '',
    [`rev-parse ${commit}:services/geo`]: tree,
  };
  assert.deepEqual(buildProblems(pin, git(clean)), []);
  assert.deepEqual(buildProblems(pin, git({ ...clean, 'rev-parse HEAD:services/geo': 'c'.repeat(40) })),
    ['This checkout\'s services/geo is not the pinned tree; check out the pinned commit.']);
  assert.deepEqual(buildProblems(pin, git({ ...clean, 'status --porcelain --untracked-files=all -- services/geo':
    '?? services/geo/made-up.py' })),
  ['services/geo has local changes or untracked files; an image is built from committed files only.']);
  const missing = { ...clean };
  delete missing[`rev-parse ${commit}:services/geo`];
  assert.deepEqual(buildProblems(pin, git(missing)), ['The pinned commit does not hold the pinned services tree.']);
});

test('a roll keeps the stores and recreates only geo and worker, with no build, through each runtime\'s own project', () => {
  assert.deepEqual(rollSteps(), [
    ['up', '-d', '--no-build', '--no-recreate', '--wait', '--wait-timeout', '90', 'postgres', 'minio', 'redis'],
    ['--profile', 'app', 'up', '-d', '--no-build', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '120',
      'geo', 'worker'],
  ]);
  for (const name of ['ulpin-demo', 'ulpin-reh-02']) {
    for (const step of rollSteps()) {
      const args = composeArguments('made-up-context', step, name);
      assert.equal(args[args.indexOf('-p') + 1], name);
    }
  }
});

test('a roll onto the image the processors already run recreates nothing; any other state rolls', () => {
  assert.equal(rollNeeded(processors(), pin, tree), false);
  assert.equal(rollNeeded(processors('ulpin-geo:demo-k3b', {}), pin, tree), true);
  assert.equal(rollNeeded(processors(pin.image, { ...built, [treeLabel]: 'c'.repeat(40) }), pin, tree), true);
  assert.equal(rollNeeded(processors().slice(0, 1), pin, tree), true);
  assert.equal(rollNeeded([], pin, tree), true);
});

test('the command line takes build, or roll with one runtime name, and refuses anything else', () => {
  assert.deepEqual(parseArguments(['build']), { action: 'build' });
  assert.equal(parseArguments(['roll']).runtime.name, 'ulpin-demo');
  assert.equal(parseArguments(['roll', '--runtime', 'ulpin-reh-03']).runtime.name, 'ulpin-reh-03');
  for (const refused of [[], ['build', '--runtime', 'ulpin-demo'], ['roll', '--runtime'], ['roll', 'ulpin-demo'],
    ['tag'], ['roll', '--runtime', 'ulpin-demo', '--force']]) {
    assert.throws(() => parseArguments(refused), /^Error: Usage: processor-image\.mjs build \| roll/);
  }
  assert.throws(() => parseArguments(['roll', '--runtime', 'ulpin-prod']), /Unknown runtime name/);
});

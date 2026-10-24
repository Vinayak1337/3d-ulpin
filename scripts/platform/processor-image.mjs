// Builds the one pinned processor image, and moves a runtime's processors onto it. Nothing else builds one.
//   build                 from a checkout whose services/geo is the pinned tree, clean; once per pin
//   roll [--runtime <n>]  recreates that runtime's geo and worker on the pinned image; storage is kept;
//                         processors already on it are left as they are
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  command, dockerRuntime, engine, imageLabels, inventory, processorImages, root, servicesTree, startProblems,
} from './runtime.mjs';
import { definedRuntime, demoRuntime, readDemo, runtimeDefinition } from './demo-config.mjs';
import { assertPinnedImage, assertServingCheckout, demoCompose } from './demo.mjs';
import { ownedProcess } from './processes.mjs';
import { pinLabels, processorImageProblems, readPin } from './processor-image-pin.mjs';

const usage = 'Usage: processor-image.mjs build | roll [--runtime <name>]';

/** The one docker build: the services/geo context, the pinned tag and the two labels that name its source. */
export function buildArguments(context, pin, checkout = root) {
  const labels = Object.entries(pinLabels(pin)).flatMap(([key, value]) => ['--label', `${key}=${value}`]);
  return ['--context', context, 'build', ...labels, '--tag', pin.image, join(checkout, 'services/geo')];
}

/** The pin must describe this checkout: its services/geo is the pinned tree, unchanged, and the commit has it. */
export function buildProblems(pin, git) {
  const problems = [];
  if (git(['rev-parse', 'HEAD:services/geo']) !== pin.servicesTree) {
    problems.push('This checkout\'s services/geo is not the pinned tree; check out the pinned commit.');
  }
  if (git(['status', '--porcelain', '--untracked-files=all', '--', 'services/geo']) !== '') {
    problems.push('services/geo has local changes or untracked files; an image is built from committed files only.');
  }
  let pinnedTree = null;
  try { pinnedTree = git(['rev-parse', `${pin.commit}:services/geo`]); } catch { /* not in this clone */ }
  if (pinnedTree !== pin.servicesTree) problems.push('The pinned commit does not hold the pinned services tree.');
  return problems;
}

/** Stores up (never recreated), then geo and worker recreated on the pinned image, with no other service. */
export function rollSteps() {
  return [
    ['up', '-d', '--no-build', '--no-recreate', '--wait', '--wait-timeout', '90', 'postgres', 'minio', 'redis'],
    ['--profile', 'app', 'up', '-d', '--no-build', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '120',
      'geo', 'worker'],
  ];
}

/** A roll is needed unless geo and worker already run the pinned image built from the serving checkout. */
export function rollNeeded(processors, pin, servingTree) {
  return processorImageProblems(processors, pin, servingTree).length > 0;
}

function build() {
  const pin = readPin();
  const problems = buildProblems(pin, args => command('git', ['-C', root, ...args]));
  if (problems.length) throw new Error(problems.join(' '));
  const runtime = dockerRuntime(); engine(runtime);
  let present = true;
  try { imageLabels(runtime, pin.image); } catch { present = false; }
  if (present) {
    // Never retagged or rebuilt over: a present tag either is the pinned build or is refused.
    assertPinnedImage(runtime, pin);
    console.log(`${pin.image} is already on this engine, built from ${pin.commit}; nothing built.`);
    return;
  }
  console.log(`Building ${pin.image} from services/geo at ${pin.commit}.`);
  execFileSync('docker', buildArguments(runtime.context, pin), { cwd: root, windowsHide: true, timeout: 1800000,
    stdio: ['ignore', 'inherit', 'inherit'] });
  assertPinnedImage(runtime, pin);
  console.log(`${pin.image} built with the pinned commit and services tree as labels.`);
}

function roll(name) {
  const definition = definedRuntime(name);
  assertServingCheckout(definition);
  const pin = readPin();
  if (servicesTree() !== pin.servicesTree) {
    throw new Error('This checkout\'s services/geo is not the pinned tree; roll from a checkout at the pinned services.');
  }
  for (const label of ['api', 'dispatcher']) {
    if (ownedProcess(label, definition)) {
      throw new Error(`Stop ${definition.name} first (platform:stop); its ${label} is running.`);
    }
  }
  const runtime = dockerRuntime(); engine(runtime);
  assertPinnedImage(runtime, pin);
  const snapshot = inventory(runtime, definition.project);
  const problems = startProblems(snapshot, false, definition.project);
  if (problems.length) throw new Error(`Roll refused: ${problems.join(' ')} No replacements will be created.`);
  if (!rollNeeded(processorImages(runtime, snapshot.containers), pin, servicesTree())) {
    console.log(`${definition.name}: geo and worker already run ${pin.image}; nothing recreated.`);
    return;
  }
  const env = readDemo(definition);
  for (const step of rollSteps()) demoCompose(runtime, env, step, 300000, definition);
  console.log(`${definition.name}: geo and worker recreated on ${pin.image}; volumes kept. Start it, then run `
    + 'its doctor.');
}

/** The action and the runtime name, checked before anything is read. */
export function parseArguments([action, ...flags]) {
  if (action === 'build' && flags.length === 0) return { action };
  if (action !== 'roll') throw new Error(usage);
  if (flags.length === 0) return { action, runtime: runtimeDefinition(demoRuntime) };
  if (flags.length === 2 && flags[0] === '--runtime') return { action, runtime: runtimeDefinition(flags[1]) };
  throw new Error(usage);
}

const entry = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (entry === fileURLToPath(import.meta.url).toLowerCase()) {
  try {
    const { action, runtime } = parseArguments(process.argv.slice(2));
    if (action === 'build') build();
    else roll(runtime);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

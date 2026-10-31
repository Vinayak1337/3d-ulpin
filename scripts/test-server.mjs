import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const patterns = [
  'packages/server/src/modules/usp/ingestion/*.test.ts',
  'packages/server/src/modules/areas/*.test.ts',
  'packages/server/src/modules/officer/*.test.ts',
  'tests/manual-author.test.ts',
  'tests/ingestion-events.test.ts',
  'packages/server/src/modules/cases/processing.test.ts',
  'packages/server/src/modules/cases/dispatch-stall.test.ts',
  'tests/usp-packet-pdf.test.ts',
  'tests/intake-ledger.test.ts',
  'tests/intake-zip-layers.test.ts',
  'tests/large-original.test.ts',
];

export function serverTestFiles() {
  return patterns.flatMap(pattern => {
    if (!pattern.includes('*')) return [pattern];
    const directory = dirname(pattern);
    const suffix = basename(pattern).slice(1);
    return readdirSync(resolve(root, directory)).filter(name => name.endsWith(suffix))
      .sort().map(name => `${directory}/${name}`);
  });
}

const args = [fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url)),
  '--tsconfig', 'apps/api/tsconfig.json', '--test', '--test-reporter=tap'];
// Include quotes and escaping conservatively; stay below even cmd.exe's 8,191-character limit.
const commandSize = values => values.reduce((size, value) => size + value.length * 2 + 3, 0);

export function testBatches(files) {
  const batches = [];
  let batch = [];
  for (const file of files) {
    if (commandSize([process.execPath, ...args, file]) > 6000) throw new Error(`Test path too long: ${file}`);
    if (commandSize([process.execPath, ...args, ...batch, file]) > 6000) {
      batches.push(batch);
      batch = [];
    }
    batch.push(file);
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function runServerTests(files = serverTestFiles()) {
  const batches = testBatches(files);
  const totals = { tests: 0, pass: 0, fail: 0, skipped: 0, cancelled: 0 };
  let failed = files.length === 0;
  console.log(`Server tests: ${files.length} files in ${batches.length} batches`);
  for (const [index, batch] of batches.entries()) {
    console.log(`Batch ${index + 1}/${batches.length}: ${batch.length} files`);
    const result = spawnSync(process.execPath, [...args, ...batch], {
      cwd: root,
      // No test's Python child writes bytecode into the checkout: the CityGML tool inventory pins those caches.
      env: { ...process.env, NODE_OPTIONS: '--require=./scripts/platform/isolated-env.cjs',
        ULPIN_PROFILE: 'demo', REPO_DATA: 'false', PYTHONDONTWRITEBYTECODE: '1' },
      stdio: ['inherit', 'pipe', 'inherit'],
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const counts = {};
    const output = (result.stdout ?? '').replace(
      /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) ([\d.]+)\r?\n/gm,
      (_line, name, value) => {
        counts[name] = Number(value);
        return '';
      });
    process.stdout.write(output);
    for (const name of Object.keys(totals)) totals[name] += counts[name] ?? 0;
    if (result.error) console.error(result.error.message);
    if (Object.keys(totals).some(name => counts[name] === undefined)) {
      console.error(`Batch ${index + 1} did not produce a complete test summary.`);
      failed = true;
    }
    if (result.status !== 0 || result.error || counts.fail || counts.cancelled) failed = true;
  }
  console.log(`Server summary: files ${files.length}, tests ${totals.tests}, pass ${totals.pass}, `
    + `fail ${totals.fail}, skip ${totals.skipped}, cancelled ${totals.cancelled}`);
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runServerTests();
}

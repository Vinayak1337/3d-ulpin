import assert from 'node:assert/strict';
import { constants, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBatch } from './batch';
import { repo } from './inputs';
import { Reader, readMode, POST_READS, type Step, type State } from './read';
import type { Context } from './context';
import { doctor, installedStep, canonical, roofprints, storeys, recorded } from './story';
import { tables, register, geometry, exchange, invariants } from './govern';
import { identity, card } from './identity-card';

export function options(args: string[]) {
  assert(!args.includes('--write'), 'Write mode is not built; the batch check permits GET only.');
  const result = { caseId: undefined as string | undefined, legacy: false,
    output: join(repo, 'docs/evidence/jrn2/demo-check.json') };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    assert(!seen.has(flag), `Repeated option ${flag}`);
    seen.add(flag);
    if (flag === '--legacy') {
      result.legacy = true;
      continue;
    }
    assert(['--profile', '--case', '--output'].includes(flag), `Unknown option ${flag}`);
    const value = args[++index];
    assert(value && !value.startsWith('--'), `${flag} needs a value`);
    if (flag === '--profile') assert.equal(value, 'demo', 'Only the demo profile is supported');
    if (flag === '--case') {
      assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value), 'Use a case UUID');
      result.caseId = value;
    }
    if (flag === '--output') result.output = resolve(value);
  }
  assert(!result.legacy || !result.caseId, '--case selects the batch story, not the legacy story');
  return result;
}

function table(steps: Step[]) {
  console.log('STEP          STATE        WHAT WAS READ');
  for (const step of steps) {
    const observed = step.observed as { words?: string; reason?: string };
    const words = (observed.words ?? observed.reason ?? step.title).replace(/\s+/g, ' ').slice(0, 96);
    console.log(`${step.id.padEnd(13)} ${step.state.padEnd(12)} ${words}`);
    console.log(`  ${step.expected}`);
  }
}

function compactEvidence(value: unknown): string {
  const lines: string[] = [];
  let current = '';
  for (const line of JSON.stringify(value, null, 2).split('\n')) {
    const token = line.trim();
    if (current.length + token.length + 1 > 120) {
      lines.push(current);
      current = '';
    }
    current += (current ? ' ' : '') + token;
  }
  lines.push(current);
  return lines.join('\n') + '\n';
}

function saveJourney(directory: string, result: unknown) {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'journey.json');
  if (existsSync(file)) {
    let attempt = 1;
    while (existsSync(join(directory, `attempt-${attempt}.json`))) attempt++;
    copyFileSync(file, join(directory, `attempt-${attempt}.json`), constants.COPYFILE_EXCL);
  }
  writeFileSync(file, compactEvidence(result));
}

async function legacyJourney() {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const context: Context = { reader: new Reader(), servedCommit: null, roofVerified: false, recordedVerified: false };
  const steps: Step[] = [];
  for (const run of [doctor, installedStep, canonical, roofprints, storeys, recorded, tables, register,
    identity, geometry, exchange, card, invariants]) {
    steps.push(await run(context));
  }
  const summary: Record<State, number> = { pass: 0, fail: 0, blocked: 0, undecidable: 0, skipped: 0 };
  steps.forEach(step => summary[step.state]++);
  const result = { servedCommit: context.servedCommit, startedAt, totalMs: Math.round(performance.now() - started),
    mode: readMode, namedPostReads: POST_READS, steps, summary };
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(startedAt));
  const directory = join(repo, 'docs/evidence/gf5', date.replaceAll('-', ''));
  saveJourney(directory, result);
  table(steps);
  console.log(JSON.stringify(summary));
  process.exitCode = summary.fail ? 1 : 0;
}

async function main() {
  const config = options(process.argv.slice(2));
  if (config.legacy) return legacyJourney();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const reader = new Reader('http://127.0.0.1:3194', true);
  const steps = await runBatch(reader, config.caseId);
  const summary = { pass: 0, fail: 0, undecidable: 0, skipped: 0 };
  for (const step of steps) {
    assert(step.state !== 'blocked', 'Batch checks use undecidable, not the legacy blocked state');
    summary[step.state]++;
  }
  const result = { task: 'JRN2', mode: 'GET only', api: 'http://127.0.0.1:3194', startedAt,
    totalMs: Math.round(performance.now() - started), requestedCaseId: config.caseId ?? null,
    requests: reader.requestCount, steps, summary };
  mkdirSync(join(config.output, '..'), { recursive: true });
  writeFileSync(config.output, compactEvidence(result));
  table(steps);
  console.log(JSON.stringify(summary));
  console.log(`JSON: ${config.output}`);
  process.exitCode = summary.fail ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Journey failed before checks could run.');
    process.exitCode = 1;
  });
}

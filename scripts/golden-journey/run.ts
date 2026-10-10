import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repo } from './inputs';
import { Reader, type Step, type State } from './read';
import type { Context } from './context';
import { doctor, installedStep, canonical, roofprints, storeys, recorded } from './story';
import { tables, register, identity, geometry, exchange, card, invariants } from './govern';

function options(args: string[]) {
  assert(!args.includes('--write'), 'Write mode is not built; check mode sends GET requests only.');
  assert.deepEqual(args, ['--profile', 'demo'], 'Use --profile demo; no other profile or mode is built.');
}

function table(steps: Step[]) {
  console.log('STEP         STATE     MS     PROMPT / FIX');
  for (const step of steps) {
    console.log(`${step.id.padEnd(12)} ${step.state.padEnd(9)} ${String(step.ms).padEnd(6)} ${step.promptId}`);
  }
}

async function main() {
  options(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const context: Context = { reader: new Reader(), servedCommit: null, roofVerified: false, recordedVerified: false };
  const steps: Step[] = [];
  for (const run of [doctor, installedStep, canonical, roofprints, storeys, recorded, tables, register,
    identity, geometry, exchange, card, invariants]) {
    steps.push(await run(context));
  }
  const summary: Record<State, number> = { pass: 0, fail: 0, blocked: 0, skipped: 0 };
  steps.forEach(step => summary[step.state]++);
  const result = { servedCommit: context.servedCommit, startedAt, totalMs: Math.round(performance.now() - started),
    steps, summary };
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(startedAt));
  const directory = join(repo, 'docs/evidence/gf5', date.replaceAll('-', ''));
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'journey.json'), JSON.stringify(result, null, 2) + '\n');
  table(steps);
  console.log(JSON.stringify(summary));
  process.exitCode = summary.fail ? 1 : 0;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Journey failed before checks could run.');
  process.exitCode = 1;
});

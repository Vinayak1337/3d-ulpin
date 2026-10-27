import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../../packages/server/src/infrastructure/errors';
import { ModelGateway } from '../../packages/server/src/modules/model-gateway/gateway';
import { ReplayAdapter, type ProviderAdapter } from '../../packages/server/src/modules/model-gateway/adapter';
import { TabularChunkMapper } from '../../packages/server/src/modules/usp/ingestion/chunk-mapping-agent';
import { controlConfig, ControlLedger, options } from './control-runtime';
import { developmentManifest, sourceTables, digest } from './t1-sources';
import { saveNew } from './t1-profiles';

function failureAdapter(code: string): ProviderAdapter {
  return { kind: 'replay', propose: async () => {
    throw new AppError(503, code, 'Software-only replay failure control; no provider request.');
  } };
}

async function checkFailure(adapter: ProviderAdapter, expected: string) {
  const asset = developmentManifest().assets.find(asset => asset.id === 'mi-d10-01.csv');
  assert(asset);
  const table = sourceTables(asset)[0];
  const ledger = new ControlLedger();
  const gateway = new ModelGateway(controlConfig(), ledger, adapter);
  const draft = await new TabularChunkMapper().map({ jobId: randomUUID(), chunkIndex: 0,
    headers: table.headers, rows: table.rows.slice(0, 13), sourceRef: asset.original.externalPath }, {
    ...options(gateway), maxAttempts: 1,
    memoryPath: `E:/BhuAayam-data/task-data/a3/controls/empty-${randomUUID()}.jsonl`,
  });
  assert(draft.questions.every(question => question.reason === expected));
  assert.equal(draft.dryRun.counts.candidate, 0);
  assert.equal(ledger.dispatched, 0);
  assert.equal(ledger.reserved, 0);
  return { failure: expected, questions: draft.questions.length, candidateCells: draft.dryRun.counts.candidate,
    providerDispatches: ledger.dispatched, reservations: ledger.reserved, teacherAttempts: draft.metrics.teacherCalls };
}

async function main() {
  const controls = [
    await checkFailure(new ReplayAdapter(async () => undefined), 'TEACHER_REPLAY_UNAVAILABLE'),
    await checkFailure(failureAdapter('MODEL_PROVIDER_UNAVAILABLE'), 'TEACHER_UNAVAILABLE'),
    await checkFailure(failureAdapter('MODEL_PROJECT_CAP'), 'TEACHER_BUDGET_EXHAUSTED'),
  ];
  const runtime = 'packages/server/src/modules/model-gateway/runtime.ts';
  const match = readFileSync(runtime, 'utf8').match(/secretReference: '([^']+)'/);
  assert(match);
  const output = `E:/BhuAayam-data/task-data/a3/failures-${randomUUID()}`;
  saveNew(join(output, 'controls.json'), controls);
  const result = { output, controls, keyVariableName: match[1], keyNameSource: runtime,
    qualification: 'Software-only replay controls; not observed live provider or PostgreSQL credit behaviour.',
    controlsSha256: digest(join(output, 'controls.json')), providerCalls: 0, registryWrites: 0 };
  writeFileSync('docs/evidence/gf-agent/a3/failures.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(result));
}

main();

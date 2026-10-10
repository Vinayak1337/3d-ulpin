import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { ImportPackage, SpatialMlBatch } from '../../../../packages/contracts/src/index';

const base = 'http://127.0.0.1:3194/api/v1';
const evidence = 'docs/evidence/gf-backend/k2c';
const modelId = 'rfdetr-ramp-ka-seg-medium-b3-v1';
const pkg: ImportPackage = JSON.parse(readFileSync(`${evidence}/imagery-import.json`, 'utf8'));

function save(name: string, value: unknown): void {
  writeFileSync(`${evidence}/${name}.json`, JSON.stringify(value) + '\n', { flag: 'wx' });
}

async function api<T>(path: string, input?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, input ? { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  } : undefined);
  const value: unknown = await response.json();
  assert(response.ok, `${response.status}: ${JSON.stringify(value)}`);
  return value as T;
}

async function queue(): Promise<void> {
  assert(!existsSync(`${evidence}/batches.json`), 'Batches already enrolled; read them instead of running inference again.');
  const batchIds: string[] = [];
  for (let offset = 0; offset < pkg.parts.length; offset += 12) {
    const input = { packageId: pkg.id, expectedRevision: pkg.revision, requestKey: randomUUID(),
      items: pkg.parts.slice(offset, offset + 12).map(part => ({ sourceRevisionId: part.sourceRevisionId,
        partId: part.id, page: 1, task: 'building', modelId })) };
    save(`batch-request-${offset}`, input);
    const batch = await api<SpatialMlBatch>('/spatial-ml/batches', input);
    batchIds.push(batch.id);
    save(`batch-queued-${offset}`, { id: batch.id, states: batch.items.map(item => item.state) });
  }
  save('batches', { batchIds, modelId, executionProvider: 'CPUExecutionProvider',
    purpose: 'display and candidates only', evaluationCalls: 0, truthPolygonsImported: 0 });
  console.log(`Queued ${pkg.parts.length} original image chips in ${batchIds.length} bounded CPU batches.`);
}

async function capture(): Promise<void> {
  const { batchIds } = JSON.parse(readFileSync(`${evidence}/batches.json`, 'utf8'));
  const batches: SpatialMlBatch[] = [];
  for (const id of batchIds) batches.push(await api<SpatialMlBatch>(`/spatial-ml/batches/${id}`));
  const items = batches.flatMap(batch => batch.items);
  save('inference-items', items);
  const states = items.map(item => item.state);
  assert(states.every(state => state === 'succeeded' || state === 'empty'), JSON.stringify(states));
  save('inference-summary', { chips: items.length,
    nonempty: items.filter(item => item.state === 'succeeded').length,
    emptyPredictions: items.filter(item => item.state === 'empty').length,
    candidates: items.reduce((total, item) => total + (item.result?.components.length ?? 0), 0),
    scored: false, gpuUsed: false, confidence: 'uncalibrated' });
  console.log('Captured completed CPU pixel candidates; no evaluation metrics computed.');
}

if (process.argv[2] === 'queue') await queue();
else if (process.argv[2] === 'capture') await capture();
else throw new Error('Use queue or capture; no polling or inference retries.');

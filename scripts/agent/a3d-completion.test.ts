import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { PoolClient } from 'pg';
import type { ChunkMappingInput } from '../../packages/contracts/src/usp';
import { chunkMappingCompletionStatus, finishChunkMappingTx } from
  '../../packages/server/src/modules/usp/ingestion/chunk-mapping-worker';

type Kind = 'tabular' | 'gis';
type State = { quarantined: number; refused: boolean; unresolved: number; duplicate_keys: number;
  schema_drift_chunks: number };

const clean: State = { quarantined: 0, refused: false, unresolved: 0, duplicate_keys: 0, schema_drift_chunks: 0 };

async function completion(label: string, kind: Kind, state: State, expected: string) {
  assert.equal(chunkMappingCompletionStatus(kind, state), expected, label);
  const writes: any[][] = [];
  const events: any[] = [];
  const client = { query: async (sql: string, args: any[] = []) => {
    if (sql.startsWith('SELECT quarantined,unresolved')) return { rows: [state] };
    if (sql.startsWith('UPDATE usp_chunk_mapping_imports')) {
      assert(!sql.includes('unresolved='), 'Finishing a draft must never erase its unresolved count.');
      writes.push(args);
    }
    if (sql.startsWith('SELECT revision')) return { rows: [{ revision: 0 }] };
    if (sql.startsWith('UPDATE usp_outbox_streams')) return { rows: [{ sequence: '1' }] };
    if (sql.startsWith('INSERT INTO usp_outbox(')) events.push(args[2]);
    return { rows: [] };
  } } as unknown as PoolClient;
  const input = { caseId: randomUUID(), sourceId: randomUUID(), sourceRevision: 1, jobId: randomUUID(),
    rawJobId: randomUUID(), subject: 'a3d-completion-control', ...(kind === 'tabular' ? { tabular: {} } : {}),
  } as ChunkMappingInput;
  await finishChunkMappingTx(client, input);
  assert.equal(writes[0][1], expected, label);
  assert.equal(events[0].change.status, expected, label);
}

const cases: [string, Kind, State, string][] = [
  ['table of drafts', 'tabular', { ...clean, unresolved: 33 }, 'completed'],
  ['table with quarantined rows', 'tabular', { ...clean, quarantined: 2, unresolved: 31 }, 'completed_with_rejections'],
  ['table with a zero-row refusal', 'tabular', { ...clean, refused: true }, 'completed_with_rejections'],
  ['clean GIS', 'gis', clean, 'completed'],
  ['GIS with unresolved records', 'gis', { ...clean, unresolved: 3 }, 'completed_with_rejections'],
  ['GIS with duplicate keys', 'gis', { ...clean, duplicate_keys: 1 }, 'completed_with_rejections'],
  ['GIS with schema drift', 'gis', { ...clean, schema_drift_chunks: 1 }, 'completed_with_rejections'],
];

test('the draft rule is for tables; GIS keeps rejections for unresolved, duplicate, drifted records', async () => {
  const prior = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'a3d-completion-control';
  try {
    for (const [label, kind, state, expected] of cases) await completion(label, kind, state, expected);
  } finally {
    if (prior === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = prior;
  }
});

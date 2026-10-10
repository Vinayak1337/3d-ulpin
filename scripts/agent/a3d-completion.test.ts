import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { PoolClient } from 'pg';
import type { ChunkMappingInput } from '../../packages/contracts/src/usp';
import { chunkMappingCompletionStatus, finishChunkMappingTx } from
  '../../packages/server/src/modules/usp/ingestion/chunk-mapping-worker';

async function completion(state: { quarantined: number; refused: boolean; unresolved: number }) {
  const expected = state.quarantined || state.refused ? 'completed_with_rejections' : 'completed';
  assert.equal(chunkMappingCompletionStatus(state), expected);
  const writes: any[][] = [];
  const events: any[] = [];
  const client = { query: async (sql: string, args: any[] = []) => {
    if (sql.startsWith('SELECT quarantined,EXISTS')) return { rows: [state] };
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
    rawJobId: randomUUID(), subject: 'a3d-completion-control' } as ChunkMappingInput;
  await finishChunkMappingTx(client, input);
  assert.equal(writes[0][1], expected);
  assert.equal(events[0].change.status, expected);
}

test('draft-only completion preserves unresolved counts; actual quarantines and zero-row refusal markers differ', async () => {
  const prior = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'a3d-completion-control';
  try {
    for (const state of [{ quarantined: 0, refused: false, unresolved: 33 },
      { quarantined: 2, refused: false, unresolved: 31 }, { quarantined: 0, refused: true, unresolved: 0 }]) {
      await completion(state);
    }
  } finally {
    if (prior === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = prior;
  }
});

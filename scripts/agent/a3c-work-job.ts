import assert from 'node:assert/strict';
import { closePool, query } from '../../packages/server/src/infrastructure/db';
import { closeStorageClient } from '../../packages/server/src/infrastructure/storage';
import { runStreamingVectorJob } from '../../packages/server/src/modules/usp/ingestion/streaming-vector-worker';
import { runChunkMappingJob } from '../../packages/server/src/modules/usp/ingestion/chunk-mapping-worker';

/** Execute only the exact API-enrolled A3c job using its existing attempt/fence authority, not a new dispatcher. */
async function main() {
  const [kind, jobId, caseId] = process.argv.slice(2);
  assert(['streaming-vector', 'chunk-mapping'].includes(kind), 'A3C_WORKER_KIND_DENIED');
  assert([jobId, caseId].every(value => /^[a-f0-9-]{36}$/.test(value)), 'A3C_JOB_ID_REQUIRED');
  assert.equal(process.env.ULPIN_MODEL_GATEWAY_ENABLED, '0', 'A3C_GATEWAY_MUST_BE_OFF');
  try {
    const row = (await query('SELECT j.operation,c.name FROM jobs j JOIN cases c ON c.id=j.case_id ' +
      'WHERE j.id=$1 AND j.case_id=$2', [jobId, caseId])).rows[0];
    assert(row?.operation === kind && row.name.startsWith('A3c live check'), 'A3C_JOB_SCOPE_DENIED');
    if (kind === 'streaming-vector') await runStreamingVectorJob(jobId);
    else await runChunkMappingJob(jobId);
    console.log(JSON.stringify({ kind, jobId, worker: 'existing fenced job runner', finished: true }));
  } finally {
    await closePool();
    closeStorageClient();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ code: error.code ?? 'A3C_WORKER_FAILED', message: error.message }));
  process.exitCode = 1;
});

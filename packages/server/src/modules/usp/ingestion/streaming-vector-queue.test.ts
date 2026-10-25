import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { beforeEach, afterEach } from 'node:test';
import { DispatchReservations, DISPATCH_LANES } from '../../cases/dispatch-lanes';
import { cancelUspJob, claimUspJobAttempt } from '../jobs';
import { localOperatorSubject } from '../principal';
import { StreamingVectorService, assertStreamingInputTx } from './streaming-vector';

let savedSubject: string | undefined;
beforeEach(() => {
  savedSubject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'stream-queue-test-only';
});
afterEach(() => {
  if (savedSubject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = savedSubject;
});

/** test_only metadata store: no original, object storage, provider or runtime I/O. */
function store(queued = 0, otherCase = false) {
  const caseId = randomUUID(), sourceId = randomUUID(), family = randomUUID();
  const source = { id: sourceId, case_id: caseId, family_id: family, revision: 1,
    profile: 'geojson-manual-v1', sha256: 'a'.repeat(64), bytes: 100, object_key: 'test_only',
    inspection: { actor: localOperatorSubject() } };
  const jobs: any[] = Array.from({ length: queued }, () => ({ id: randomUUID(),
    case_id: otherCase ? randomUUID() : caseId, status: 'queued' }));
  const operations = new Map<unknown, any>(), imports = new Map<unknown, any>(), metadata = new Map<unknown, any>();
  let latest = 1, running = DISPATCH_LANES.stream.concurrency;
  const one = (row?: object) => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
  const query = async (sql: string, v: any[] = []) => {
    if (sql.includes('FROM cases')) return one({ id: caseId, revision: 0, archived: false });
    if (sql.includes('SELECT max(revision)')) return one({ revision: latest });
    if (sql.includes('FROM sources')) return one(source);
    if (sql.includes('SELECT payload_hash,result FROM operations')) return one(operations.get(v[1]));
    if (sql.includes('count(*)') && sql.includes('usp_streaming_vector_imports')) {
      if (sql.includes("state IN ('queued','running')")) return one({ n: running + jobs.length });
      assert.match(sql, /JOIN jobs j ON j.id=i.job_id WHERE i.state='queued' AND j.status='queued'/);
      assert.match(sql, /count\(\*\) FILTER \(WHERE i.case_id=\$1\)::int case_queued/);
      const waiting = jobs.filter(job => job.status === 'queued');
      return one({ queued: waiting.length, case_queued: waiting.filter(job => job.case_id === v[0]).length });
    }
    if (sql.includes('count(*)') && sql.includes('operations')) return one({ n: operations.size });
    if (sql.startsWith('INSERT INTO jobs')) jobs.push({ id: v[0], case_id: v[1], source_id: v[2],
      operation: 'streaming-vector', case_revision: v[3], input_fingerprint: v[4], payload: v[5], status: 'queued' });
    if (sql.includes('FROM jobs')) return one(jobs.find(job => job.id === v[0]));
    if (sql.includes('FROM usp_job_metadata')) return one(metadata.get(v[0]));
    if (sql.startsWith('INSERT INTO usp_job_metadata')) metadata.set(v[0], { version: 1,
      logical_state: 'queued', input_sha256: v[2] });
    if (sql.startsWith('INSERT INTO usp_streaming_vector_imports')) imports.set(v[0], { state: 'queued',
      next_publish_index: 0, sealed_chunks: null, records: 0, accepted: 0, quarantined: 0,
      issue_code: null, unknown_remainder: true });
    if (sql.startsWith('SELECT * FROM usp_streaming_vector_imports')) return one(imports.get(v[0]));
    if (sql.startsWith('INSERT INTO operations')) operations.set(v[1], { payload_hash: v[2], result: v[3] });
    if (sql.startsWith('UPDATE usp_outbox_streams')) return one({ sequence: '1' });
    if (sql.startsWith('INSERT INTO usp_job_attempts')) return one({ lease_until: new Date(Date.now() + 180000) });
    if (sql.startsWith('UPDATE usp_job_metadata')) metadata.get(v[0]).logical_state =
      sql.includes("logical_state='cancelled'") ? 'cancelled' : 'running';
    if (sql.startsWith('UPDATE jobs')) jobs.find(job => job.id === v[0]).status =
      sql.includes("status='failed'") ? 'failed' : 'running';
    return one();
  };
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown }, saved = globals.ulpinPool;
  globals.ulpinPool = { query, connect: async () => ({ query, release() {} }) };
  const service = new StreamingVectorService();
  const enqueue = (key = randomUUID()) => service.enqueue(caseId, sourceId, { requestKey: key,
    expectedCaseRevision: 0, expectedSourceRevision: 1, sourceSha256: source.sha256, framing: 'feature-collection' });
  return { jobs, metadata, enqueue, source, service, caseId, sourceId,
    supersede: () => { latest++; }, clearRunning: () => { running = 0; },
    restore: () => { globals.ulpinPool = saved; } };
}

test('a full lane queues work, replays its key at the queue bound, then starts on release', async () => {
  const s = store();
  try {
    const reservations = new DispatchReservations();
    const holding = Array.from({ length: DISPATCH_LANES.stream.concurrency }, () => ({ id: randomUUID(),
      operation: 'streamed-profile', created_at: new Date() }));
    for (const job of holding) assert.equal(reservations.admit(job, Infinity, [], Date.now()), true);
    const key = randomUUID(), receipt = await s.enqueue(key), job = s.jobs.at(-1);
    assert.equal(receipt.status, 'queued');
    job.created_at = new Date();
    assert.equal(reservations.admit(job, Infinity, [], Date.now()), false);
    assert.equal(job.status, 'queued');
    for (let i = 0; i < 15; i++) await s.enqueue();
    assert.equal((await s.enqueue(key)).jobId, receipt.jobId);
    assert.equal(s.jobs.length, 16);
    reservations.release(holding[0].id);
    assert.equal(reservations.admit(job, Infinity, [], Date.now()), true);
    await claimUspJobAttempt(job.id, 'test_only', client => assertStreamingInputTx(client, job.payload).then(() => {}));
    assert.equal(job.status, 'running');
  } finally { s.restore(); }
});

for (const [n, other, scope] of [[16, false, 'case'], [64, true, 'service']] as const) {
  test(`${scope} queue refuses at its bound with plain words and renewable details`, async () => {
    const s = store(n, other);
    try {
      s.clearRunning();
      await assert.rejects(s.enqueue(), { status: 429, code: 'STREAMING_CAPACITY',
        message: `This ${scope} has ${n} streaming imports waiting to be read, its queue limit; `
          + 'a slot frees when one starts reading or is cancelled.',
        details: { limit: other ? 'queued_imports' : 'case_queued_imports', freesAt: null } });
      s.jobs[0].status = 'running';
      assert.equal((await s.enqueue()).status, 'queued', 'starting a job frees queue capacity');
    } finally { s.restore(); }
  });
}

test('cancelling a queued import prevents its claim and frees its slot without deleting its receipt', async () => {
  const s = store(15);
  try {
    const receipt = await s.enqueue(), job = s.jobs.at(-1);
    await cancelUspJob(job.id, 1);
    assert.equal(job.status, 'failed');
    assert.equal(s.metadata.get(job.id).logical_state, 'cancelled');
    await assert.rejects(claimUspJobAttempt(job.id, 'test_only'), { code: 'STALE_REVISION' });
    assert.equal((await s.enqueue()).status, 'queued');
    assert.equal((await s.service.status(s.caseId, s.sourceId, receipt.jobId)).jobId, receipt.jobId);
  } finally { s.restore(); }
});

test('superseding a queued source keeps its receipt but prevents a reader claim', async () => {
  const s = store();
  try {
    const receipt = await s.enqueue(), job = s.jobs.at(-1);
    s.supersede();
    const status = await s.service.status(s.caseId, s.sourceId, receipt.jobId);
    assert.equal(status.current, false);
    assert.deepEqual(status.reasons, ['source_superseded']);
    await assert.rejects(claimUspJobAttempt(job.id, 'test_only',
      client => assertStreamingInputTx(client, job.payload).then(() => {})), { code: 'STALE_REVISION' });
    assert.equal(job.status, 'queued', 'no stale reader started');
  } finally { s.restore(); }
});

import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { createRequire } from 'node:module';
import type { PoolClient } from 'pg';
import { DocumentInputSchema, type DocumentResult } from '@ulpin/contracts/usp';
import { settings } from '../../../infrastructure/config';
import { sha256 } from '../../../infrastructure/storage';
import { ingestionBinding } from './events';
import { queueBatchDocumentTx } from './documents';
import { runDocumentJob } from './document-worker';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'ca0-protocol-operator';
const caseId = '30000000-0000-4000-8000-000000000001';
const sourceId = '30000000-0000-4000-8000-000000000002';
const siteId = '30000000-0000-4000-8000-000000000003';
const binding = ingestionBinding(caseId);
// Synthetic test_only bytes: no Word package is opened; the native reader is replaced below.
const bytes = Buffer.from('test_only Word document control');
const text = 'test_only paragraph';
const reading = 'Reading the paragraphs and table cells of this Word document. '
  + 'Nothing is recorded until you confirm it.';
const staleWords = 'This Word document or its batch changed while it was read; nothing was kept from that read.';

type Row = Record<string, any>;
type State = { case: Row; sources: Row[]; item: Row; jobs: Row[]; meta: Map<string, Row>; attempts: Row[];
  operations: Row[]; objects: Map<string, Uint8Array>; events: number };

function initial(): State {
  const documentOriginal = { version: 'source-document/1', subject: binding.subject, format: 'docx',
    sha256: sha256(bytes), bytes: bytes.length, receivedAt: '2026-10-30T00:00:00.000Z' };
  return {
    case: { id: caseId, revision: 7, archived: false, frame: { id: 'UNASSIGNED' }, context: {}, site_id: null },
    sources: [{ id: sourceId, case_id: caseId, family_id: sourceId, revision: 1, name: 'test_only.docx',
      sha256: sha256(bytes), bytes: bytes.length, object_key: `sources/${sourceId}/${sha256(bytes)}`,
      status: 'received', inspection: { documentOriginal } }],
    item: { item_id: sourceId, source_id: sourceId, case_id: caseId, parent_item_id: null, state: 'probed',
      placement: 'undecided', plan_ref: null, records_seen: 0, limit_reason: null,
      card: { format: 'docx', family: 'document' } },
    jobs: [], meta: new Map(), attempts: [], operations: [], objects: new Map(), events: 0,
  };
}

const latestJobs = (state: State, limit: number) => [...state.jobs].reverse().slice(0, limit);

function read(sql: string, values: any[], state: State): Row[] | null {
  const job = state.jobs.find(row => row.id === values?.[0]);
  if (sql.startsWith('SELECT id,revision,archived,frame,context,site_id FROM cases')) return [state.case];
  if (sql.startsWith('SELECT revision FROM cases')) return [state.case];
  if (sql.startsWith('SELECT c.id FROM cases c JOIN jobs j')) return job ? [{ id: state.case.id }] : [];
  if (sql.startsWith('SELECT * FROM sources WHERE case_id=$1 AND id=$2')
    || sql.startsWith('SELECT sha256,bytes,inspection FROM sources'))
    return state.sources.filter(row => row.id === values[1]);
  if (sql.startsWith('SELECT max(revision) revision FROM sources'))
    return [{ revision: Math.max(...state.sources.map(row => row.revision)) }];
  if (sql.startsWith('SELECT id,status FROM jobs WHERE case_id=$1 AND source_id=$2'))
    return latestJobs(state, sql.includes('LIMIT $3') ? values[2] : 1);
  if (sql.startsWith('SELECT id,status,payload FROM jobs WHERE case_id=$1')) return latestJobs(state, 33);
  if (sql.startsWith('SELECT payload,input_fingerprint FROM jobs') || sql.startsWith('SELECT * FROM jobs WHERE id=$1')
    || sql.startsWith('SELECT status FROM jobs WHERE id=$1')) return job ? [job] : [];
  if (sql.startsWith('SELECT * FROM usp_job_metadata'))
    return state.meta.has(values[0]) ? [state.meta.get(values[0])!] : [];
  if (sql.startsWith('SELECT * FROM usp_job_attempts WHERE job_id=$1 ORDER BY'))
    return state.attempts.filter(row => row.job_id === values[0]).slice(-1);
  if (sql.startsWith('SELECT * FROM usp_job_attempts WHERE job_id=$1 AND number=$2'))
    return state.attempts.filter(row => row.job_id === values[0] && row.number === values[1]);
  if (sql.startsWith('SELECT 1 FROM usp_job_attempts'))
    return state.attempts.filter(row => row.job_id === values[0] && row.state === 'active');
  if (sql.startsWith('SELECT count(*)::int n FROM usp_job_attempts')) return [{ n: 0 }];
  if (sql.startsWith('SELECT 1 FROM operations'))
    return state.operations.filter(row => row.case_id === values[0] && row.result.jobId === values[2]);
  if (sql.startsWith('SELECT * FROM usp_intake_items WHERE source_id=$1')) return [state.item];
  if (sql.startsWith('SELECT state,placement,plan_ref,records_seen,limit_reason FROM usp_intake_items'))
    return [state.item];
  if (sql.startsWith('SELECT item_id AS')) return [{ itemId: sourceId, state: state.item.state, family: 'document',
    format: 'docx', sizeClass: 'S', wave: 1, pinnedByOfficer: false }];
  if (sql.startsWith('SELECT pg_advisory')) return [];
  return null;
}

function write(sql: string, values: any[], state: State): Row[] | null {
  const job = state.jobs.find(row => row.id === values?.[0]);
  if (/^(BEGIN|COMMIT|ROLLBACK$|RELEASE)/.test(sql)) return [];
  if (sql.startsWith('INSERT INTO jobs')) {
    state.jobs.push({ id: values[0], case_id: values[1], source_id: values[2], operation: 'document-extraction',
      status: 'queued', case_revision: values[3], input_fingerprint: values[4], payload: values[5], error: null });
    return [];
  }
  if (sql.startsWith('INSERT INTO usp_job_metadata')) {
    state.meta.set(values[0], { job_id: values[0], logical_state: 'queued', input_manifest_id: values[1],
      input_sha256: values[2] });
    return [];
  }
  if (sql.startsWith('INSERT INTO usp_job_attempts')) {
    const row = { job_id: values[0], number: values[1], fence: values[2], owner: values[3], input_sha256: values[4],
      state: 'active', lease_until: new Date(Date.now() + 180000).toISOString() };
    state.attempts.push(row);
    return [row];
  }
  if (sql.startsWith('UPDATE usp_job_attempts SET state=')) {
    const next = /state='([a-z]+)'/.exec(sql)![1];
    for (const row of state.attempts) if (row.job_id === values[0] && row.state === 'active') row.state = next;
    return [];
  }
  if (sql.startsWith('UPDATE usp_job_metadata SET logical_state=')) {
    const meta = state.meta.get(values[0])!;
    meta.logical_state = /logical_state='([a-z]+)'/.exec(sql)![1];
    if (values[1]) Object.assign(meta, { result_ref: values[1], accepted_fence: values[2] });
    return [];
  }
  if (sql.startsWith('UPDATE jobs SET status=$2')) Object.assign(job!, { status: values[1], error: values[2] });
  else if (sql.startsWith('UPDATE jobs SET status=')) job!.status = /status='([a-z]+)'/.exec(sql)![1];
  else if (sql.startsWith('UPDATE usp_intake_items SET state=')) Object.assign(state.item, { state: values[2],
    placement: values[3], plan_ref: values[4], records_seen: values[5], limit_reason: values[6] });
  else if (sql.startsWith('UPDATE sources SET status=')) state.sources[0].status = values[1];
  else if (sql.startsWith('UPDATE usp_outbox_streams')) return [{ sequence: '1' }];
  else if (sql.startsWith('INSERT INTO usp_outbox(')) state.events++;
  else if (!sql.startsWith('INSERT INTO usp_outbox_streams')) return null;
  return [];
}

/** A fake PostgreSQL with savepoint snapshots; any statement it does not know fails the test. */
function documentProtocol() {
  let state = initial();
  const statements: string[] = [], savepoints: string[] = [];
  const query = async (raw: string, values: any[] = []) => {
    const sql = raw.trim();
    statements.push(sql);
    if (sql === 'SAVEPOINT document_requeue') savepoints.push(JSON.stringify(state, (_, value) =>
      value instanceof Map ? { $map: [...value] } : value instanceof Uint8Array ? { $bytes: [...value] } : value));
    else if (sql === 'ROLLBACK TO SAVEPOINT document_requeue') state = JSON.parse(savepoints.at(-1)!, (_, value) =>
      value?.$map ? new Map(value.$map) : value?.$bytes ? Uint8Array.from(value.$bytes) : value);
    if (sql === 'RELEASE SAVEPOINT document_requeue') savepoints.pop();
    const rows = /SAVEPOINT/.test(sql) ? [] : read(sql, values, state) ?? write(sql, values, state);
    if (!rows) throw new Error(`Unexpected protocol SQL: ${sql}`);
    return { rows, rowCount: rows.length };
  };
  return { statements, query, get state() { return state; } };
}

type Fixture = ReturnType<typeof documentProtocol>;
type Pins = { readerSha256: string; sourceId: string; sourceSha256: string };
const extracted = (input: Pins): DocumentResult['native'] => ({
  status: 'extracted', format: 'docx', readerSha256: input.readerSha256, code: null, warnings: [],
  parts: [{ id: '30000000-0000-4000-8000-000000000004', sourceId: input.sourceId, sourceRevision: 1,
    sourceSha256: input.sourceSha256, text, sha256: sha256(text), method: 'native_text',
    locator: { label: 'Paragraph 1', paragraph: 1, characterStart: 0, characterEnd: text.length } }],
});

/** Install the fake as the pool and as private storage for the run. */
async function withDocumentProtocol(fixture: Fixture, run: () => Promise<void>) {
  const globals = globalThis as any;
  const previous = globals.ulpinPool;
  globals.ulpinPool = { query: fixture.query, connect: async () => ({ query: fixture.query, release() {} }) };
  const require = createRequire(new URL('../../../../package.json', import.meta.url));
  const { S3Client } = require('@aws-sdk/client-s3');
  for (const key of ['s3Endpoint', 's3Region', 's3Bucket', 's3AccessKey', 's3SecretKey'] as const)
    mock.getter(settings, key, () => key === 's3Endpoint' ? 'http://127.0.0.1:1' : 'document-protocol');
  mock.method(S3Client.prototype, 'send', async (command: any) => {
    const { Key, Body } = command.input;
    if (Body) fixture.state.objects.set(Key, Uint8Array.from(Body));
    const stored = fixture.state.objects.get(Key)!;
    return { Body: { transformToByteArray: async () => stored }, ContentLength: stored?.length };
  });
  try {
    await run();
  } finally {
    globals.ulpinPool = previous;
    mock.restoreAll();
  }
}

/** The batch's first map part binds the case to its site while the Word document is being read (run 5). A later
 * move here binds another synthetic site, so each read in a chain can see the context move. */
function bindSite(fixture: Fixture) {
  const revision = ++fixture.state.case.revision;
  fixture.state.case.site_id = revision === 8 ? siteId : `${siteId.slice(0, -2)}${String(revision).padStart(2, '0')}`;
}

/** Queue the batch read, then run each job in turn; the first `stale` runs see the case move mid-read. */
async function staleRuns(stale: number, change: (fixture: Fixture) => void = bindSite) {
  const fixture = documentProtocol();
  const seen: string[] = [];
  await withDocumentProtocol(fixture, async () => {
    const client = { query: fixture.query } as unknown as PoolClient;
    await queueBatchDocumentTx(client, caseId, sourceId, 'docx');
    Object.assign(fixture.state.item, { state: 'reading', limit_reason: reading }); // As queueBatchPdfTx writes.
    for (let run = 0; run < fixture.state.jobs.length && run <= stale; run++) {
      const input = DocumentInputSchema.parse(fixture.state.jobs[run].payload);
      seen.push(fixture.state.item.limit_reason);
      await runDocumentJob(input.jobId, { read: async () => bytes, extract: async () => {
        if (run < stale) change(fixture);
        return extracted(input);
      } });
    }
  });
  const jobs = fixture.state.jobs;
  return { fixture, jobs, inputs: jobs.map(job => DocumentInputSchema.parse(job.payload)), seen };
}

test('a stale batch document job is queued once more under the current case pins and its item settles read',
  async () => {
    const { fixture, jobs, inputs, seen } = await staleRuns(1);
    assert.equal(jobs.length, 2);
    assert.deepEqual([jobs[0].status, jobs[0].error], ['stale', 'DOCUMENT_INPUT_STALE']);
    assert.deepEqual(fixture.state.attempts.map(row => row.state), ['fenced', 'accepted']);
    assert.notEqual(inputs[1].caseContextSha256, inputs[0].caseContextSha256);
    assert.equal(inputs[1].caseRevision, fixture.state.case.revision);
    assert(inputs[1].caseRevision > inputs[0].caseRevision);
    for (const pin of ['sourceId', 'familyId', 'sourceRevision', 'sourceSha256', 'sourceBytes', 'objectKey', 'subject',
      'accessSha256', 'readerSha256', 'policyVersion', 'mode'] as const)
      assert.equal(inputs[1][pin], inputs[0][pin], pin);
    assert.deepEqual(seen, [reading, reading], 'The re-queued item says its reading words, not the stale words.');
    assert.equal(jobs[1].status, 'succeeded');
    assert.equal(fixture.state.item.state, 'read');
    assert.match(fixture.state.item.limit_reason, /^1 paragraph and 0 table cells read\./);
    assert.equal(fixture.state.sources[0].sha256, sha256(bytes));
  });

test('a stale end locks the case before its job row and its case stream (S9.6r)', async () => {
  const { fixture } = await staleRuns(1);
  const at = (prefix: string) => fixture.statements.findIndex(sql => sql.startsWith(prefix));
  const caseLock = at('SELECT c.id FROM cases c JOIN jobs j');
  assert(caseLock >= 0);
  assert(caseLock < at(`SELECT * FROM jobs WHERE id=$1 AND operation='document-extraction' FOR UPDATE`));
  assert(caseLock < fixture.statements.findIndex((sql, index) => index > caseLock
    && sql.startsWith('INSERT INTO usp_outbox_streams')));
});

test('a third stale end of the same batch read is kept as it is, after two re-queues', async () => {
  const { fixture, jobs } = await staleRuns(3);
  assert.equal(jobs.length, 3);
  assert.deepEqual(jobs.map(job => [job.status, job.error]), Array(3).fill(['stale', 'DOCUMENT_INPUT_STALE']));
  assert.deepEqual([fixture.state.item.state, fixture.state.item.placement, fixture.state.item.limit_reason],
    ['failed_part', 'not_understood', staleWords]);
});

test('a changed source keeps the stale end, rolled back to the savepoint, without another job', async () => {
  const changes = {
    superseded: (fixture: Fixture) => fixture.state.sources.push({ ...fixture.state.sources[0],
      id: '30000000-0000-4000-8000-000000000005', revision: 2 }),
    bytes: (fixture: Fixture) => {
      const changed = 'b'.repeat(64);
      fixture.state.sources[0].sha256 = changed;
      fixture.state.sources[0].inspection.documentOriginal.sha256 = changed;
    },
  };
  for (const [name, change] of Object.entries(changes)) {
    const { fixture, jobs } = await staleRuns(1, change);
    assert.equal(jobs.length, 1, name);
    assert.deepEqual([jobs[0].status, jobs[0].error], ['stale', 'DOCUMENT_INPUT_STALE'], name);
    assert(fixture.statements.includes('ROLLBACK TO SAVEPOINT document_requeue'), name);
    assert.equal(fixture.state.item.limit_reason, staleWords, name);
  }
});

test('an officer request, OCR page or archive member read that ends stale is not queued again', async () => {
  const requests = {
    officer: (fixture: Fixture) => fixture.state.operations.push({ case_id: caseId,
      result: { jobId: fixture.state.jobs[0].id } }),
    ocr: (fixture: Fixture) => Object.assign(fixture.state.jobs[0].payload, { ocrSelection: { page: 1 },
      ocrConfigSha256: 'c'.repeat(64) }),
    archive: (fixture: Fixture) => Object.assign(fixture.state.jobs[0].payload, { archiveSelection: { ordinal: 0,
      memberSha256: 'd'.repeat(64), memberBytes: 1 } }),
  };
  for (const [name, request] of Object.entries(requests)) {
    const { fixture, jobs } = await staleRuns(1, current => {
      request(current);
      bindSite(current);
    });
    assert.equal(jobs.length, 1, name);
    assert.equal(jobs[0].status, 'stale', name);
    assert.doesNotThrow(() => DocumentInputSchema.parse(jobs[0].payload), name);
    assert(fixture.statements.includes('SAVEPOINT document_requeue'), name);
    assert.equal(fixture.state.item.limit_reason, staleWords, name);
  }
});

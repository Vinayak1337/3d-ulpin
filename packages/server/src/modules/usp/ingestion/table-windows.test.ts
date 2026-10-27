import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';
import type { Pool, PoolClient } from 'pg';
import { TABULAR_LIMITS, TableProfileJobSchema, TabularSourceProfileSchema, type AnyStreamingInput,
  type ChunkMappingInput, type TabularMappingPlan, type TabularSourceProfile } from '@ulpin/contracts/usp';
import { createContractValidator } from '../../../../../../apps/studio/src/local/contract';
import { CONTROL_SHEET, controlWorkbook } from '../../../../../../tests/fixtures/xlsx-control';
import { odsWorkbook } from '../../../../../../tests/fixtures/ods-control';
import { settings } from '../../../infrastructure/config';
import { transaction } from '../../../infrastructure/db';
import { AppError } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import type { UspJobAttempt } from '../jobs';
import { mapTableWindow, publishTableWindowTx } from './chunk-mapping-tabular';
import { manualTeacherPlan } from './mapping-teacher';
import { ManualIngestionService } from './service';
import { TableProfileInputSchema, runTableProfileJob } from './table-profile-worker';
import { TableRowsService, isWindowedTable, readTableWindowTx, writeTableWindowTx } from './table-windows';
import { officerMappingMethod, validateStreamedTabularRecipe } from './tabular-recipe';
import { readTabularSource } from './tabular-source';
import { readTableWindows, readTabularWindows } from './tabular-stream';

const subject = 'g13-table-windows-control';
const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };
const globals = globalThis as unknown as { ulpinPool?: Pool };
const validate = createContractValidator(JSON.parse(readFileSync('docs/api/openapi.json', 'utf8')));
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
// The workbook reader needs the native reader's packages (services/geo).
const geoPython = 'E:/BhuAayam-data/ml/venv-k3a-geo/Scripts/python.exe';
let savedPool: Pool | undefined, savedSubject: string | undefined;

beforeEach(() => {
  savedPool = globals.ulpinPool;
  savedSubject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = subject;
});
afterEach(() => {
  globals.ulpinPool = savedPool;
  if (savedSubject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = savedSubject;
  mock.restoreAll();
});

/** A generated test_only register, built in memory and never written to disk: 200,000 records above 16 MiB, with
 * empty and absent cells kept as written. */
function generatedCsv(records: number) {
  const parts = ['Building Address,Record,Area (sq m),Note\n'];
  for (let row = 1; row <= records; row++) {
    const area = row % 9 === 0 ? '' : `${row % 500}.25`;
    parts.push(row % 13 === 0 ? `"Plot ${row}, Ward ${row % 40}",G-${row}\n`
      : `"Plot ${row}, Ward ${row % 40}",G-${row},${area},"generated test_only row ${row} ${'x'.repeat(40)}"\n`);
  }
  return Buffer.from(parts.join(''));
}

type Window = { job_id: string; window_index: number; first_record: number; last_record: number; records: number;
  byte_start: number; byte_end: number; window_sha256: string; rows: string };
type Mapped = { job_id: string; raw_job_id: string; window_index: number; status: string; rows: string | null;
  issue_code: string | null; issue: string | null; records: number };

/** The tables this path reads and writes, answering only the statements it issues. */
class Store {
  caseId = randomUUID(); sourceId = randomUUID(); familyId = randomUUID();
  rawJobId = randomUUID(); mappingJobId = randomUUID();
  caseRevision = 0; sequence = 0;
  source: Record<string, any>;
  operations = new Map<string, { payload_hash: unknown; result: unknown }>();
  raw = { state: 'running', source_revision: 1, input_sha256: 'a'.repeat(64), next_publish_index: 0, records: 0 };
  mapping = { state: 'running', next_publish_index: 0, records: 0, unresolved: 0, quarantined: 0 };
  windows: Window[] = []; mappings: Mapped[] = []; events: string[] = []; statements = 0;
  // TP1: the job authority's rows for the table read.
  jobs: Record<string, any>[] = []; attempts: Record<string, any>[] = [];
  metadata = new Map<string, Record<string, any>>();
  // TP1: what else happens in the workspace while the job reads the object; a later revision of the same family.
  whileReading = () => {}; familyRevision: number | null = null;
  constructor(readonly bytes: Buffer) {
    this.source = { id: this.sourceId, case_id: this.caseId, family_id: this.familyId, revision: 1,
      profile: 'large-original-v1', mime_type: 'text/csv', bytes: String(bytes.length), sha256: sha(bytes),
      object_key: `large-originals/${this.sourceId}`,
      inspection: { largeOriginal: { operatorSubject: subject, objectEtag: '"g13-control"' } } };
  }
  query = async (sql: string, args: any[] = []) => {
    this.statements++;
    const rows = this.answer(sql.replace(/\s+/g, ' ').trim(), args);
    return { rows, rowCount: rows.length };
  };
  private window(index: number) { return this.windows.find(item => item.window_index === index); }
  private answer(sql: string, args: any[]): any[] {
    if (sql.startsWith('BEGIN') || sql === 'COMMIT' || sql === 'ROLLBACK') return [];
    const job = this.jobAnswer(sql, args);
    if (job) return job;
    if (sql.includes('registry_case_feature_mappings') || sql.includes('FROM import_packages')) return [];
    if (sql.startsWith('SELECT id,revision FROM cases') || sql.startsWith('SELECT revision FROM cases'))
      return [{ id: this.caseId, revision: this.caseRevision }];
    if (sql.startsWith('SELECT id,family_id,revision,sha256 FROM sources')) {
      const { id, family_id, revision, sha256 } = this.source;
      return [{ id, family_id, revision, sha256 }];
    }
    if (sql.startsWith('SELECT * FROM sources WHERE id=$1 AND case_id=$2'))
      return args[0] === this.sourceId && args[1] === this.caseId ? [structuredClone(this.source)] : [];
    if (sql.includes('max(revision)')) return [{ revision: this.familyRevision ?? this.source.revision }];
    if (sql.startsWith('SELECT payload_hash,result FROM operations')) {
      const prior = this.operations.get(String(args[1]));
      return prior ? [prior] : [];
    }
    if (sql.startsWith('INSERT INTO operations')) {
      this.operations.set(String(args[1]), { payload_hash: args[2], result: structuredClone(args[3]) });
      return [];
    }
    if (sql.startsWith('UPDATE sources SET inspection=inspection||$2::jsonb')) {
      this.source.inspection = { ...this.source.inspection, ...JSON.parse(args[1]) };
      return [];
    }
    if (sql.startsWith('UPDATE cases SET revision=revision+1')) { this.caseRevision++; return []; }
    if (sql.startsWith('INSERT INTO usp_outbox_streams')) return [];
    if (sql.startsWith('UPDATE usp_outbox_streams')) return [{ sequence: String(++this.sequence) }];
    if (sql.startsWith('INSERT INTO usp_outbox(')) {
      this.events.push(args[2].change?.kind ?? args[2].type);
      return [];
    }
    if (sql.startsWith('SELECT * FROM usp_streaming_vector_imports')) return [{ ...this.raw }];
    if (sql.startsWith('SELECT first_record,records,window_sha256,byte_start,byte_end FROM usp_table_windows')) {
      const prior = this.window(args[1]);
      return prior ? [prior] : [];
    }
    if (sql.startsWith('INSERT INTO usp_table_windows')) {
      this.windows.push({ job_id: args[0], window_index: args[3], first_record: args[4], last_record: args[5],
        records: args[6], byte_start: args[7], byte_end: args[8], window_sha256: args[9], rows: args[10] });
      return [];
    }
    if (sql.startsWith('UPDATE usp_streaming_vector_imports SET records=records+$2')) {
      this.raw.records += args[1]; this.raw.next_publish_index++;
      return [];
    }
    if (sql.startsWith('SELECT window_index,first_record,records,window_sha256,rows FROM usp_table_windows')) {
      const found = this.window(args[1]);
      return found ? [{ ...found, rows: JSON.parse(found.rows) }] : [];
    }
    if (sql.startsWith('SELECT * FROM usp_chunk_mapping_imports')) return [{ ...this.mapping }];
    if (sql.startsWith('SELECT window_sha256 FROM usp_table_windows'))
      return [{ window_sha256: this.window(args[1])!.window_sha256 }];
    if (sql.startsWith('INSERT INTO usp_table_window_mappings')) {
      this.mappings.push({ job_id: args[0], raw_job_id: args[1], window_index: args[2], records: args[5],
        status: args[6], rows: args[7], issue_code: args[8], issue: args[9] });
      return [];
    }
    if (sql.startsWith('UPDATE usp_chunk_mapping_imports SET next_publish_index=next_publish_index+1')) {
      this.mapping.next_publish_index++; this.mapping.records += args[1];
      this.mapping.unresolved += args[2]; this.mapping.quarantined += args[3];
      return [];
    }
    if (sql.startsWith('SELECT j.id FROM jobs j')) return this.windows.length ? [{ id: this.rawJobId }] : [];
    if (sql.startsWith('SELECT job_id FROM usp_chunk_mapping_imports'))
      return this.mappings.length ? [{ job_id: this.mappingJobId }] : [];
    if (sql.startsWith('SELECT w.window_index,w.first_record,w.last_record')) {
      return this.windows.map(item => {
        const mapped = this.mappings.find(row => row.job_id === args[1] && row.window_index === item.window_index);
        return { window_index: item.window_index, first_record: item.first_record, last_record: item.last_record,
          records: item.records, status: mapped?.status ?? null, issue_code: mapped?.issue_code ?? null,
          issue: mapped?.issue ?? null };
      });
    }
    if (sql.startsWith('SELECT (SELECT jsonb_agg(w.rows->g ORDER BY g)')) {
      const [, index, start, end, mappingJob] = args;
      const mapped = this.mappings.find(row => row.job_id === mappingJob && row.window_index === index
        && row.status === 'mapped');
      return [{ rows: JSON.parse(this.window(index)!.rows).slice(start, end + 1),
        mapped: mapped ? JSON.parse(mapped.rows!).slice(start, end + 1) : null }];
    }
    throw new Error(`Unexpected statement: ${sql.slice(0, 120)}`);
  }
  /** TP1: the statements of the table read's queue, status, claim, acceptance and stop. */
  private jobAnswer(sql: string, args: any[]): any[] | null {
    const job = this.jobs.find(row => row.id === args[0]), meta = this.metadata.get(args[0]);
    const attempt = this.attempts.filter(row => row.job_id === args[0]).at(-1);
    if (sql.startsWith('SELECT id FROM cases')) return [{ id: this.caseId }];
    if (sql.startsWith("SELECT id FROM jobs WHERE source_id=$1 AND operation='table-profile'"))
      return this.jobs.filter(row => row.source_id === args[0] && ['queued', 'running'].includes(row.status));
    if (sql.startsWith('INSERT INTO jobs(')) {
      this.jobs.push({ id: args[0], case_id: args[1], source_id: args[2], operation: 'table-profile', status: 'queued',
        case_revision: args[3], input_fingerprint: args[4], payload: structuredClone(args[5]), error: null });
      return [];
    }
    if (sql.startsWith('SELECT * FROM jobs') || sql.startsWith('SELECT status FROM jobs')) return job ? [job] : [];
    if (sql.startsWith('UPDATE jobs SET status=$2')) {
      Object.assign(job!, { status: args[1], error: args[2] });
      return [];
    }
    if (sql.startsWith('UPDATE jobs SET status=')) { job!.status = /status='(\w+)'/.exec(sql)![1]; return []; }
    if (sql.startsWith('INSERT INTO usp_job_metadata')) {
      this.metadata.set(args[0], { job_id: args[0], input_manifest_id: args[1], input_sha256: args[2], scope: args[3],
        logical_state: 'queued', version: 1 });
      return [];
    }
    if (sql.includes('FROM usp_job_metadata')) return meta ? [meta] : [];
    if (sql.startsWith('UPDATE usp_job_metadata')) {
      Object.assign(meta!, { logical_state: /logical_state='(\w+)'/.exec(sql)![1], version: meta!.version + 1 });
      return [];
    }
    if (sql.startsWith('SELECT * FROM usp_job_attempts')) return attempt ? [attempt] : [];
    if (sql.startsWith('SELECT 1 FROM usp_job_attempts')) return attempt?.state === 'active' ? [attempt] : [];
    if (sql.startsWith('INSERT INTO usp_job_attempts')) {
      const lease_until = new Date(Date.now() + 180_000);
      this.attempts.push({ job_id: args[0], number: args[1], fence: args[2], owner: args[3], input_sha256: args[4],
        state: 'active', lease_until });
      return [{ lease_until }];
    }
    if (sql.startsWith('UPDATE usp_job_attempts SET lease_until')) return [{ lease_until: attempt!.lease_until }];
    if (sql.startsWith('UPDATE usp_job_attempts SET state=')) {
      attempt!.state = /state='(\w+)'/.exec(sql)![1];
      return [];
    }
    return null;
  }
  install() {
    globals.ulpinPool = { query: this.query, connect: async () => ({ query: this.query, release() {} }) } as never;
    for (const [name, value] of [['s3Endpoint', 'http://127.0.0.1:1'], ['s3Region', 'us-east-1'],
      ['s3Bucket', 'g13-control'], ['s3AccessKey', 'g13-control'], ['s3SecretKey', 'g13-control']] as const)
      mock.getter(settings, name, () => value);
    mock.method(S3Client.prototype, 'send', async (command: { constructor: { name: string }; input: any }) => {
      assert.equal(command.constructor.name, 'GetObjectCommand');
      if (command.input.Range) {
        const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(command.input.Range)!;
        const bytes = this.bytes.subarray(Number(start), Number(end) + 1);
        return { Body: Readable.from([bytes]), ContentLength: bytes.length,
          ContentRange: `bytes ${start}-${end}/${this.bytes.length}`, $metadata: { httpStatusCode: 206 } };
      }
      assert.equal(command.input.IfMatch, '"g13-control"');
      this.whileReading();
      return { Body: this.stream(), ContentLength: this.bytes.length, ETag: '"g13-control"' };
    });
  }
  stream() {
    const bytes = this.bytes;
    return Readable.from((function* () {
      for (let at = 0; at < bytes.length; at += 64 * 1024) yield bytes.subarray(at, at + 64 * 1024);
    })());
  }
}

function approvedPlan(profile: TabularSourceProfile, header = 'Building Address'): TabularMappingPlan {
  const mapping = manualTeacherPlan(profile.profile, 'MAPPING_REVIEW_REQUIRED').plan;
  mapping.method = officerMappingMethod(subject);
  const address = mapping.fields.findIndex(field => field.sourceField.endsWith(`|${header}`));
  mapping.fields[address] = { ...mapping.fields[address], target: 'building.addressLiteral', confidence: 1,
    rationale: 'Keep the stated address text unresolved.' };
  return { version: 'manual-tabular/1', mode: 'manual_mapping', source: profile.source, caseId: profile.caseId,
    workspaceRevision: profile.workspaceRevision, workspaceFingerprint: profile.workspaceFingerprint,
    tabular: profile.tabular, mapping, decisions: mapping.fields.map(field => ({ sourceField: field.sourceField,
      reason: field.target === 'unknown' ? 'Leave the field unknown.' : 'Keep the stated address text.' })) };
}

test('a generated test_only 200,000-row CSV goes from large original to profile, windows, mapping and pages',
  async t => {
    const bytes = generatedCsv(200_000);
    assert.ok(bytes.length > TABULAR_LIMITS.bytes, 'the register is above the whole-file bound');
    const store = new Store(bytes);
    store.install();
    const started = performance.now();

    // D7: the large original becomes a table source; its row, bytes and object stay the same.
    const request = { requestKey: randomUUID(), expectedWorkspaceRevision: 0, selection };
    const service = new ManualIngestionService();
    const queued = TableProfileJobSchema.parse(await service.tableFromOriginal(store.caseId, store.sourceId, request));
    assert.equal(queued.status, 'queued');
    await runTableProfileJob(queued.jobId);
    const profile = TabularSourceProfileSchema.parse(await service.inspectAny(store.caseId, store.sourceId));
    assert.equal(profile.records, 200_000);
    assert.deepEqual(profile.headers, ['Building Address', 'Record', 'Area (sq m)', 'Note']);
    assert.equal(store.source.profile, 'large-original-v1');
    assert.equal(store.source.object_key, `large-originals/${store.sourceId}`);
    assert.deepEqual(await service.tableFromOriginal(store.caseId, store.sourceId, request),
      { ...queued, status: 'succeeded' }, 'replayed');
    assert.equal(store.caseRevision, 1);
    assert.deepEqual(validate('POST_ingestion_cases_caseId_sources_Response_201_application_json',
      profile), []);

    // D6: the raw job writes one row per window of 10,000 records, each window hashing its own bytes.
    const attempt = { number: 1, fence: 1, inputSha256: store.raw.input_sha256 } as UspJobAttempt;
    const rawInput = { jobId: store.rawJobId, caseId: store.caseId, sourceId: store.sourceId, sourceRevision: 1,
      subject } as AnyStreamingInput;
    await readTabularWindows(store.stream(), async (window, headers) => {
      await transaction(client => writeTableWindowTx(client, rawInput, attempt, window, headers));
    });
    assert.equal(store.windows.length, 20);
    assert.equal(store.raw.records, 200_000);
    for (const window of store.windows) {
      assert.equal(window.records, 10_000);
      assert.equal(window.window_sha256, sha(bytes.subarray(window.byte_start, window.byte_end)));
    }
    const first = JSON.parse(store.windows[0]!.rows)[12];
    assert.deepEqual(first.cells, ['Plot 13, Ward 13', 'G-13', null, null], 'an absent cell stays absent, not 0');
    assert.equal(bytes.subarray(first.byteStart, first.byteEnd).toString(), '"Plot 13, Ward 13",G-13');
    assert.deepEqual(JSON.parse(store.windows[0]!.rows)[8].cells.slice(2, 3), [''], 'an empty cell stays empty');

    // D8: the approved recipe is checked on the first window, then applied to every window in order.
    const plan = approvedPlan(profile);
    const head = await transaction(client => readTableWindowTx(client, store.rawJobId, 0));
    validateStreamedTabularRecipe(plan, profile, { headers: profile.headers,
      rows: head!.rows.map(row => row.cells.map(cell => cell ?? undefined)) });
    const mappingInput = { jobId: store.mappingJobId, rawJobId: store.rawJobId, caseId: store.caseId,
      sourceId: store.sourceId, sourceRevision: 1, subject } as ChunkMappingInput;
    for (let index = 0; index < store.windows.length; index++) {
      const window = (await transaction(client => readTableWindowTx(client, store.rawJobId, index)))!;
      // One window's stored layout is changed here, to show a failed window is reported rather than skipped.
      const stored = index === 7 ? { ...window, rows: window.rows.map((row, offset) =>
        offset ? row : { ...row, cells: row.cells.slice(0, 2) }) } : window;
      const outcome = mapTableWindow(plan, profile, stored, store.sourceId);
      await transaction(client => publishTableWindowTx(client as PoolClient, mappingInput, attempt, window, outcome));
    }
    assert.deepEqual(store.mapping, { state: 'running', next_publish_index: 20, records: 200_000,
      unresolved: 190_000, quarantined: 10_000 });
    assert.deepEqual(store.mappings.filter(row => row.status === 'failed').map(row => [row.window_index,
      row.issue_code]), [[7, 'TABLE_WINDOW_LAYOUT']]);
    const address = JSON.parse(store.mappings[0]!.rows!)[0].cells
      .find((cell: { target: string }) => cell.target === 'building.addressLiteral');
    assert.equal(address.value, 'Plot 1, Ward 1');

    // D9: keyset pages by record number, across a window boundary, with the record count from the profile.
    const rows = new TableRowsService();
    const opening = await rows.page(store.caseId, store.sourceId, {});
    assert.equal(opening.records, 200_000);
    assert.deepEqual([opening.rows.length, opening.rows[0]!.record, opening.next], [100, 0, 99]);
    const across = await rows.page(store.caseId, store.sourceId, { after: '9989', limit: '20' });
    assert.deepEqual(across.rows.map(row => row.record), Array.from({ length: 20 }, (_, i) => 9990 + i));
    assert.deepEqual([across.rows[9]!.window, across.rows[10]!.window, across.next], [0, 1, 10009]);
    assert.ok(across.rows.every(row => row.mapped?.length));
    const failed = await rows.page(store.caseId, store.sourceId, { after: '69999', limit: '500' });
    assert.ok(failed.rows.every(row => row.window === 7 && row.mapped === null));
    assert.deepEqual(failed.windows.failed.map(item => [item.window, item.firstRecord, item.lastRecord,
      item.issueCode]), [[7, 70000, 79999, 'TABLE_WINDOW_LAYOUT']]);
    const last = await rows.page(store.caseId, store.sourceId, { after: '199989', limit: '500' });
    assert.deepEqual([last.rows.length, last.rows.at(-1)!.record, last.next], [10, 199_999, null]);
    assert.deepEqual(validate('GET_ingestion_cases_caseId_sources_sourceId_rows_Response_200_application_json',
      across), []);
    await assert.rejects(rows.page(store.caseId, store.sourceId, { limit: '501' }));
    assert.deepEqual([...new Set(store.events)], ['source.retained', 'job.succeeded', 'streaming-vector.window',
      'chunk-mapping.window']);
    t.diagnostic(JSON.stringify({ records: profile.records, bytes: bytes.length, windows: store.windows.length,
      elapsedMs: Math.round(performance.now() - started) }));
  });

const tableJob = (value: unknown) => TableProfileJobSchema.parse(value);

test('TP1: a large CSV request queues one job and returns; a replay queues none; the job attaches the receipt',
  async () => {
    const store = new Store(generatedCsv(200_000));
    store.install();
    const service = new ManualIngestionService();
    const request = { requestKey: randomUUID(), expectedWorkspaceRevision: 0, selection };
    const queued = tableJob(await service.tableFromOriginal(store.caseId, store.sourceId, request));
    assert.deepEqual([queued.status, queued.issueCode, store.jobs.length], ['queued', null, 1]);
    assert.equal(store.source.inspection.manualProfile, undefined, 'the request did not read the original');
    assert.deepEqual(validate('POST_ingestion_cases_caseId_sources_sourceId_table_Response_202_application_json',
      queued), []);
    assert.deepEqual(await service.tableFromOriginal(store.caseId, store.sourceId, request), queued, 'replayed');
    assert.equal(store.jobs.length, 1, 'a replay queues none');
    await assert.rejects(service.tableFromOriginal(store.caseId, store.sourceId,
      { ...request, requestKey: randomUUID() }), {
      status: 409, code: 'STALE_REVISION',
      message: 'This original is already being read as a table; follow that read.',
      details: { existingTable: { caseId: store.caseId, sourceId: store.sourceId, jobId: queued.jobId } },
    }, 'one read of an original at a time, naming that read');
    assert.equal(store.jobs.length, 1, 'the conflict queues no second read');
    await runTableProfileJob(queued.jobId);
    assert.equal(store.source.inspection.manualProfile.records, 200_000);
    assert.equal(store.caseRevision, 1);
    assert.equal(tableJob(await service.tableFromOriginal(store.caseId, store.sourceId, request)).status,
      'succeeded');
  });

test('TP1: a malformed large CSV stops its job with the reader\'s code and words; the source is unchanged',
  async () => {
    // test_only: a generated register whose last record opens a quote that never closes.
    const store = new Store(Buffer.concat([generatedCsv(200_000), Buffer.from('"Plot open,G-0,1\n')]));
    store.install();
    const service = new ManualIngestionService();
    const request = { requestKey: randomUUID(), expectedWorkspaceRevision: 0, selection };
    const queued = tableJob(await service.tableFromOriginal(store.caseId, store.sourceId, request));
    await assert.rejects(runTableProfileJob(queued.jobId), { code: 'TABULAR_CSV_MALFORMED' });
    const stopped = tableJob(await service.tableFromOriginal(store.caseId, store.sourceId, request));
    assert.deepEqual([stopped.status, stopped.issueCode], ['failed', 'TABULAR_CSV_MALFORMED']);
    assert.match(stopped.message!, /^Record 200002 of this table has a quote that does not close where a cell ends\.$/);
    assert.equal(store.source.inspection.manualProfile, undefined);
    assert.equal(store.caseRevision, 0);
  });

test('TP1: another file kept in the workspace while the job reads does not stop it', async () => {
  const store = new Store(generatedCsv(200_000));
  store.install();
  const service = new ManualIngestionService();
  const request = { requestKey: randomUUID(), expectedWorkspaceRevision: 0, selection };
  const queued = tableJob(await service.tableFromOriginal(store.caseId, store.sourceId, request));
  store.whileReading = () => { store.caseRevision++; };
  await runTableProfileJob(queued.jobId);
  assert.equal(store.source.inspection.manualProfile.records, 200_000);
  assert.equal(store.caseRevision, 2);
  assert.equal(tableJob(await service.tableFromOriginal(store.caseId, store.sourceId, request)).status,
    'succeeded');
});

test('TP1: a new revision of the same source while the job reads makes the job stale', async () => {
  const store = new Store(generatedCsv(200_000));
  store.install();
  const service = new ManualIngestionService();
  const request = { requestKey: randomUUID(), expectedWorkspaceRevision: 0, selection };
  const queued = tableJob(await service.tableFromOriginal(store.caseId, store.sourceId, request));
  store.whileReading = () => { store.familyRevision = 2; store.caseRevision++; };
  await assert.rejects(runTableProfileJob(queued.jobId), { code: 'STALE_REVISION' });
  const stale = tableJob(await service.tableFromOriginal(store.caseId, store.sourceId, request));
  assert.deepEqual([stale.status, stale.issueCode, stale.message],
    ['stale', 'STALE_REVISION', 'This source revision has been superseded.']);
  assert.equal(store.source.inspection.manualProfile, undefined);
  assert.equal(store.caseRevision, 1);
});

test('TPB: a new table read names the bytes of its original in the payload it fingerprints', async () => {
  const bytes = generatedCsv(200_000), store = new Store(bytes);
  store.install();
  const request = { requestKey: randomUUID(), expectedWorkspaceRevision: 0, selection };
  const queued = tableJob(await new ManualIngestionService().tableFromOriginal(store.caseId, store.sourceId, request));
  const [job] = store.jobs, payload = TableProfileInputSchema.parse(job!.payload);
  assert.deepEqual([payload.sourceBytes, job!.input_fingerprint], [bytes.length, fingerprint(payload)]);
  assert.equal(store.metadata.get(queued.jobId)!.input_sha256, fingerprint(payload));
});

test('TPB: a table read queued before its payload named the bytes still parses and runs', async () => {
  const store = new Store(generatedCsv(200_000));
  store.install();
  const service = new ManualIngestionService();
  const request = { requestKey: randomUUID(), expectedWorkspaceRevision: 0, selection };
  const queued = tableJob(await service.tableFromOriginal(store.caseId, store.sourceId, request));
  // The job as TP1 queued it: the same payload without sourceBytes, fingerprinted as it was.
  const [job] = store.jobs, { sourceBytes: _bytes, ...legacy } = job!.payload;
  const digest = fingerprint(legacy);
  Object.assign(job!, { payload: legacy, input_fingerprint: digest });
  store.metadata.get(queued.jobId)!.input_sha256 = digest;
  assert.deepEqual(TableProfileInputSchema.parse(legacy), legacy, 'parsed without a field added');
  await runTableProfileJob(queued.jobId);
  assert.equal(store.source.inspection.manualProfile.records, 200_000);
  assert.equal(tableJob(await service.tableFromOriginal(store.caseId, store.sourceId, request)).status,
    'succeeded');
});

/** A real table kept through the batch (large-original/1) becomes a table in the request, with no job. */
async function keptTable(file: string, chosen: typeof selection | typeof workbook) {
  const store = new Store(readFileSync(`fixtures/usp/D8-messy-india/dev/d1b/${file}`));
  store.install();
  const service = new ManualIngestionService();
  const request = { requestKey: randomUUID(), expectedWorkspaceRevision: 0, selection: chosen };
  const profile = TabularSourceProfileSchema.parse(
    await service.tableFromOriginal(store.caseId, store.sourceId, request));
  assert.ok(profile.records > 0, file);
  const expectedSelection = chosen.format === 'csv'
    ? { ...chosen, delimiter: ',', encoding: 'utf-8', encodingBasis: 'bom' } : chosen;
  assert.deepEqual(profile.tabular.selection, expectedSelection);
  assert.deepEqual([store.jobs.length, store.caseRevision, store.source.profile], [0, 1, 'large-original-v1']);
  assert.deepEqual(await service.tableFromOriginal(store.caseId, store.sourceId, request), profile, 'replayed');
  assert.deepEqual(validate('POST_ingestion_cases_caseId_sources_Response_201_application_json', profile), []);
  mock.method(S3Client.prototype, 'send', async () => { throw new Error('The table must not be read twice.'); });
  await assert.rejects(service.tableFromOriginal(store.caseId, store.sourceId,
    { ...request, requestKey: randomUUID(), expectedWorkspaceRevision: store.caseRevision }),
  (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 409);
    assert.deepEqual(error.details, { existingTable: {
      caseId: store.caseId, sourceId: store.sourceId, tableId: store.sourceId,
    } });
    assert.deepEqual(validate('GET_demo_assets_real_nyc_asset_Response_400_application_json', {
      error: { code: error.code, message: error.message, details: error.details, requestId: randomUUID() },
    }), [], 'the table route uses this common error envelope for its 409');
    return true;
  });
  assert.deepEqual([store.source.sha256, store.jobs.length, store.caseRevision], [sha(store.bytes), 0, 1]);
}
test('officer-stated encoding re-reads the same kept table through its existing route', async () => {
  const bytes = Buffer.from('key;note\r\nA;\x80é\r\n', 'latin1'), store = new Store(bytes);
  store.install();
  const service = new ManualIngestionService();
  const first = TabularSourceProfileSchema.parse(await service.tableFromOriginal(store.caseId, store.sourceId,
    { requestKey: randomUUID(), expectedWorkspaceRevision: 0, selection }));
  const stated = { ...first.tabular.selection, encoding: 'iso-8859-1', encodingBasis: 'officer_stated' };
  const request = { requestKey: randomUUID(), expectedWorkspaceRevision: store.caseRevision, selection: stated };
  const reread = TabularSourceProfileSchema.parse(await service.tableFromOriginal(store.caseId, store.sourceId,
    request));
  assert.deepEqual(reread.tabular.selection, stated);
  assert.equal(reread.profile.encodingBasis, 'officer_stated');
  assert.notEqual(reread.source.schemaFingerprint, first.source.schemaFingerprint);
  assert.deepEqual([reread.source.sourceId, reread.source.sourceRevision, reread.source.sourceSha256],
    [first.source.sourceId, first.source.sourceRevision, sha(bytes)]);
  assert.deepEqual(await service.tableFromOriginal(store.caseId, store.sourceId, request), reread);
  assert.equal(store.caseRevision, 2);
  assert.equal(store.jobs.length, 0);
  assert.deepEqual(validate('POST_ingestion_cases_caseId_sources_Response_201_application_json', reread), []);
  // Older standalone tables have the same re-read path, not another retained original.
  store.source.profile = 'tabular-manual-v1';
  store.source.inspection.tabularProvenance.licence = 'restricted';
  store.source.inspection.tabularProvenance.issuer = 'test_only source';
  const older = TabularSourceProfileSchema.parse(await service.tableFromOriginal(store.caseId, store.sourceId,
    { ...request, requestKey: randomUUID(), expectedWorkspaceRevision: store.caseRevision }));
  assert.ok('admission' in older.tabular);
  assert.equal(older.tabular.admission.licence, 'restricted');
  assert.equal(older.tabular.admission.issuer, 'test_only source');
  assert.equal(older.source.sourceSha256, sha(bytes));
});

test('a refused officer-stated re-read leaves the current profile and original unchanged', async () => {
  const store = new Store(Buffer.from('key;note\nA;é\n', 'latin1'));
  store.install();
  const service = new ManualIngestionService();
  await service.tableFromOriginal(store.caseId, store.sourceId,
    { requestKey: randomUUID(), expectedWorkspaceRevision: 0, selection });
  const original = structuredClone(store.source);
  for (const encoding of ['utf-8', 'utf-16le', 'ISCII']) {
    await assert.rejects(service.tableFromOriginal(store.caseId, store.sourceId,
      { requestKey: randomUUID(), expectedWorkspaceRevision: store.caseRevision,
        selection: { ...selection, encoding, encodingBasis: 'officer_stated' } }),
    /invalid|BOM|Unsupported table encoding/);
    assert.deepEqual(store.source, original);
    assert.equal(store.caseRevision, 1);
  }
});

test('a streamed officer-stated re-read pins the previous reading and refuses a concurrent replacement', async () => {
  const store = new Store(Buffer.from('key;note\n' + 'A;é\n'.repeat(2_001), 'latin1'));
  store.install();
  const service = new ManualIngestionService();
  const first = tableJob(await service.tableFromOriginal(store.caseId, store.sourceId,
    { requestKey: randomUUID(), expectedWorkspaceRevision: 0, selection }));
  await runTableProfileJob(first.jobId);
  const stated = { ...selection, encoding: 'iso-8859-1', encodingBasis: 'officer_stated' };
  const request = { requestKey: randomUUID(), expectedWorkspaceRevision: store.caseRevision, selection: stated };
  const queued = tableJob(await service.tableFromOriginal(store.caseId, store.sourceId, request));
  await runTableProfileJob(queued.jobId);
  assert.equal(store.source.inspection.manualProfile.profile.encoding, 'iso-8859-1');
  assert.equal(store.source.inspection.manualProfile.profile.encodingBasis, 'officer_stated');
  const next = tableJob(await service.tableFromOriginal(store.caseId, store.sourceId,
    { ...request, requestKey: randomUUID(), expectedWorkspaceRevision: store.caseRevision }));
  store.source.inspection.manualProfile.schemaFingerprint = 'f'.repeat(64);
  await assert.rejects(runTableProfileJob(next.jobId), { code: 'STALE_REVISION' });
  assert.equal(store.source.sha256, sha(store.bytes));
});

const workbook = { format: 'xlsx' as const, sheet: 'T_18', table: null, headerRows: [4, 5] };

test('TP1: a real CSV kept through the batch becomes a table in the request', () =>
  keptTable('mi-d10-02.csv', selection));

// The native workbook reader runs the geo package; it needs an interpreter that has its dependencies.
test('TP1: a real workbook kept through the batch becomes a table in the request',
  { skip: !process.env.ULPIN_PROFILE_PYTHON && 'ULPIN_PROFILE_PYTHON names no geo-compatible interpreter' },
  () => keptTable('mi-d19-01.xlsx', workbook));

test('XW1, TP1: a generated test_only workbook above 16 MiB goes 202, then the job, the windows, the mapping and '
  + 'the rows page',
  { skip: existsSync(process.env.ULPIN_PROFILE_PYTHON ?? geoPython) ? false : 'needs ULPIN_PROFILE_PYTHON' },
  async t => {
    process.env.ULPIN_PROFILE_PYTHON ??= geoPython;
    process.env.ULPIN_DOCUMENT_OCR_SCRATCH ??= join(tmpdir(), 'ulpin-table-scratch-windows');
    const control = controlWorkbook(180_000), register = { ...selection, format: 'xlsx' as const,
      sheet: 'Register', headerRows: [2] };
    assert.ok(control.bytes.length > TABULAR_LIMITS.bytes, 'the workbook is above the whole-file bound');
    const store = new Store(control.bytes);
    store.source.mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    store.install();
    const started = performance.now();

    // D5, TP1: the request queues TP1's job (202) and reads nothing; the job reads the officer's sheet and header
    // rows as a stream and attaches the table receipt to the same source row; its object stays the same.
    const service = new ManualIngestionService();
    const request = { requestKey: randomUUID(), expectedWorkspaceRevision: 0, selection: register };
    const queued = TableProfileJobSchema.parse(await service.tableFromOriginal(store.caseId, store.sourceId, request));
    assert.deepEqual([queued.status, store.jobs.length], ['queued', 1]);
    assert.equal(store.source.inspection.manualProfile, undefined, 'the request did not read the original');
    assert.deepEqual(validate('POST_ingestion_cases_caseId_sources_sourceId_table_Response_202_application_json',
      queued), []);
    await runTableProfileJob(queued.jobId);
    assert.equal(TableProfileJobSchema.parse(await service.tableFromOriginal(store.caseId, store.sourceId, request))
      .status, 'succeeded');
    const profile = TabularSourceProfileSchema.parse(await service.inspectAny(store.caseId, store.sourceId));
    assert.deepEqual([profile.records, profile.tabular.sourceBytes, profile.headers],
      [180_000, control.bytes.length, ['Ward', 'Plot', 'Area', 'Doubled', 'Tripled', 'Note', 'Hash']]);
    assert.ok(profile.limitations.some(line => line.startsWith('180000 formula cells keep their cached text')));
    assert.deepEqual(validate('POST_ingestion_cases_caseId_sources_Response_201_application_json', profile), []);

    // D4: the raw job writes each window as it arrives; a window cites the sheet member, each record its row.
    const attempt = { number: 1, fence: 1, inputSha256: store.raw.input_sha256 } as UspJobAttempt;
    const rawInput = { jobId: store.rawJobId, caseId: store.caseId, sourceId: store.sourceId, sourceRevision: 1,
      subject } as AnyStreamingInput;
    const tableSource = { selection: register, bytes: control.bytes.length };
    await readTableWindows(store.stream(), tableSource, async (window, headers) => {
      await transaction(client => writeTableWindowTx(client, rawInput, attempt, window, headers));
    });
    // Every stored range is a real range of the original with that range's SHA-256: the sheet's stored bytes.
    const [byteStart, byteEnd] = control.ranges.get(CONTROL_SHEET)!;
    const stored = createHash('sha256').update(control.bytes.subarray(byteStart, byteEnd)).digest('hex');
    assert.deepEqual([store.windows.length, store.raw.records], [18, 180_000]);
    assert.ok(store.windows.every(window => window.byte_start === byteStart && window.byte_end === byteEnd
      && window.window_sha256 === stored));
    const seventh = JSON.parse(store.windows[0]!.rows)[4];
    assert.deepEqual(seventh, { record: 4, sourceRow: 7, byteStart, byteEnd, sha256: stored, sheet: 'Register',
      sheetSha256: control.sheetSha256, marks: [{ column: 3, mark: 'formula_cached' },
        { column: 4, mark: 'formula_uncached' }], cells: seventh.cells });
    assert.deepEqual([seventh.cells[4], seventh.cells[5]], [null, null], 'no formula is calculated, no cell is 0');
    // A recovered job reads the same first window again; the stored window matches it exactly.
    const enough = new Error('first window replayed');
    await assert.rejects(readTableWindows(store.stream(), tableSource, async (window, headers) => {
      await transaction(client => writeTableWindowTx(client, rawInput, attempt, window, headers));
      throw enough;
    }), error => error === enough);
    assert.equal(store.windows.length, 18);

    // D4: G13's recipe check, mapping and keyset pages work unchanged.
    const plan = approvedPlan(profile, 'Ward');
    const head = await transaction(client => readTableWindowTx(client, store.rawJobId, 0));
    validateStreamedTabularRecipe(plan, profile, { headers: profile.headers,
      rows: head!.rows.map(row => row.cells.map(cell => cell ?? undefined)) });
    const mappingInput = { jobId: store.mappingJobId, rawJobId: store.rawJobId, caseId: store.caseId,
      sourceId: store.sourceId, sourceRevision: 1, subject } as ChunkMappingInput;
    for (let index = 0; index < store.windows.length; index++) {
      const window = (await transaction(client => readTableWindowTx(client, store.rawJobId, index)))!;
      const outcome = mapTableWindow(plan, profile, window, store.sourceId);
      await transaction(client => publishTableWindowTx(client as PoolClient, mappingInput, attempt, window, outcome));
    }
    assert.deepEqual([store.mapping.next_publish_index, store.mapping.records], [18, 180_000]);
    assert.deepEqual(store.mappings.filter(row => row.status !== 'mapped'), []);
    // A formula cell with a cached value (Doubled) and one without (Tripled) map as unknown, as in the whole read.
    const formulas = JSON.parse(store.mappings[0]!.rows!)[0].cells
      .filter((cell: { sourceField: string }) => ['4|Doubled', '5|Tripled'].includes(cell.sourceField));
    assert.deepEqual(formulas.map(({ target: _target, ...cell }: { target: string }) => cell), [
      { value: null, state: 'unknown', sourceField: '4|Doubled', issueCode: 'TABULAR_CELL_UNAVAILABLE' },
      { value: null, state: 'unknown', sourceField: '5|Tripled', issueCode: 'TABULAR_CELL_UNAVAILABLE' }]);
    const across = await new TableRowsService().page(store.caseId, store.sourceId, { after: '9997', limit: '4' });
    assert.deepEqual(across.rows.map(row => [row.record, row.window, row.sourceRow]),
      [[9998, 0, 10_001], [9999, 0, 10_002], [10_000, 1, 10_003], [10_001, 1, 10_004]]);
    assert.ok(across.rows.every(row => row.sheet === 'Register' && row.byteStart === byteStart
      && row.sha256 === stored && row.mapped));
    assert.deepEqual(validate('GET_ingestion_cases_caseId_sources_sourceId_rows_Response_200_application_json',
      across), []);
    t.diagnostic(JSON.stringify({ records: profile.records, bytes: control.bytes.length,
      windows: store.windows.length, elapsedMs: Math.round(performance.now() - started) }));
  });

test('TB2: a CSV under 16 MiB with more than 2,000 records is read by the stream job, every record kept', async () => {
  const bytes = generatedCsv(2_500);
  assert.ok(bytes.length < TABULAR_LIMITS.bytes, 'the register is within the whole-file byte bound');
  const store = new Store(bytes);
  store.install();
  const service = new ManualIngestionService();
  const request = { requestKey: randomUUID(), expectedWorkspaceRevision: 0, selection };
  const queued = tableJob(await service.tableFromOriginal(store.caseId, store.sourceId, request));
  assert.deepEqual([queued.status, store.jobs.length], ['queued', 1], 'the row bound promotes the read to a job');
  assert.deepEqual(store.jobs[0]!.payload.request.selection, selection, 'the officer\'s selection is pinned');
  assert.equal(store.source.inspection.manualProfile, undefined, 'nothing is attached before the job reads');
  assert.deepEqual(validate('POST_ingestion_cases_caseId_sources_sourceId_table_Response_202_application_json',
    queued), []);
  assert.deepEqual(await service.tableFromOriginal(store.caseId, store.sourceId, request), queued, 'replayed');
  assert.equal(store.jobs.length, 1, 'a replay queues none');
  await runTableProfileJob(queued.jobId);
  const profile = TabularSourceProfileSchema.parse(await service.inspectAny(store.caseId, store.sourceId));
  assert.equal(profile.records, 2_500, 'no record is cut to fit the whole-file bound');
  assert.deepEqual(profile.tabular.selection,
    { ...selection, delimiter: ',', encoding: 'utf-8', encodingBasis: 'utf8_valid' });
  assert.deepEqual([store.source.profile, store.source.object_key, store.caseRevision],
    ['large-original-v1', `large-originals/${store.sourceId}`, 1], 'the same kept original, read once');
  assert.equal(tableJob(await service.tableFromOriginal(store.caseId, store.sourceId, request)).status,
    'succeeded');
});

test('an ODS below 16 MiB with 2,500 rows takes the profile job and raw windows, not the whole read',
  { skip: existsSync(process.env.ULPIN_PROFILE_PYTHON ?? geoPython) ? false : 'needs ULPIN_PROFILE_PYTHON' },
  async () => {
    process.env.ULPIN_PROFILE_PYTHON ??= geoPython;
    process.env.ULPIN_DOCUMENT_OCR_SCRATCH ??= join(tmpdir(), 'ulpin-table-scratch-windows');
    // test_only: repeatable literal rows keep the package small while crossing the whole reader's record bound.
    const bytes = odsWorkbook('Register', [['key', 'note'], ...Array.from({ length: 2500 }, () => ['K', 'kept'])]).bytes;
    const chosen = { format: 'ods' as const, sheet: 'Register', table: null, headerRows: [1] };
    const store = new Store(bytes);
    store.source.mime_type = 'application/vnd.oasis.opendocument.spreadsheet';
    store.install();
    const service = new ManualIngestionService();
    const request = { requestKey: randomUUID(), expectedWorkspaceRevision: 0, selection: chosen };
    const queued = tableJob(await service.tableFromOriginal(store.caseId, store.sourceId, request));
    assert.equal(queued.status, 'queued');
    await runTableProfileJob(queued.jobId);
    const profile = TabularSourceProfileSchema.parse(await service.inspectAny(store.caseId, store.sourceId));
    assert.equal(profile.records, 2500);
    assert.ok(isWindowedTable({ framing: 'tabular', tabular: profile.tabular, sourceBytes: bytes.length }));
    const attempt = { number: 1, fence: 1, inputSha256: store.raw.input_sha256 } as UspJobAttempt;
    const input = { jobId: store.rawJobId, caseId: store.caseId, sourceId: store.sourceId, sourceRevision: 1,
      subject } as AnyStreamingInput;
    await readTableWindows(store.stream(), { selection: chosen, bytes: bytes.length }, async (window, headers) => {
      await transaction(client => writeTableWindowTx(client, input, attempt, window, headers));
    });
    assert.equal(store.raw.records, 2500);
    const page = await new TableRowsService().page(store.caseId, store.sourceId, { after: -1, limit: 10 });
    assert.equal(page.rows[0]!.rowElement, 2);
    assert.match(page.rows[0]!.rowSha256!, /^[a-f0-9]{64}$/);
    assert.deepEqual(validate('GET_ingestion_cases_caseId_sources_sourceId_rows_Response_200_application_json',
      page), []);
  });

test('a small XLSX below 2,000 rows but above 2,000 cells profiles and uses the raw/mapping window gate',
  { skip: existsSync(process.env.ULPIN_PROFILE_PYTHON ?? geoPython) ? false : 'needs ULPIN_PROFILE_PYTHON' },
  async () => {
    process.env.ULPIN_PROFILE_PYTHON ??= geoPython;
    process.env.ULPIN_DOCUMENT_OCR_SCRATCH ??= join(tmpdir(), 'ulpin-table-scratch-windows');
    // test_only: 201 populated rows (one header), 40 styled empty rows, 2,291 cell elements, one selected sheet.
    const columns = [...'ABCDEFGHIJK'];
    const rows = Array.from({ length: 201 }, (_, index) => `<row r="${index + 1}">` + columns.map(column =>
      `<c r="${column}${index + 1}" t="inlineStr"><is><t>${column}</t></is></c>`).join('') + '</row>');
    const empty = Array.from({ length: 40 }, (_, index) => `<row r="${index + 202}">`
      + `<c r="A${index + 202}" s="0"/><c r="B${index + 202}" s="0"/></row>`);
    const xml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + `<dimension ref="A1:K241"/><sheetData>${rows.join('')}${empty.join('')}</sheetData></worksheet>`;
    const { bytes } = controlWorkbook(0, xml);
    const chosen = { format: 'xlsx' as const, sheet: 'Register', table: null, headerRows: [1] };
    assert.ok(bytes.length < TABULAR_LIMITS.bytes);
    assert.throws(() => readTabularSource(bytes, chosen), { code: 'TABULAR_ROW_LIMIT' },
      'the unchanged whole reader counts cells, not just the 241 XML rows');
    const store = new Store(bytes);
    store.install();
    const service = new ManualIngestionService();
    const queued = tableJob(await service.tableFromOriginal(store.caseId, store.sourceId,
      { requestKey: randomUUID(), expectedWorkspaceRevision: 0, selection: chosen }));
    await runTableProfileJob(queued.jobId);
    const profile = TabularSourceProfileSchema.parse(await service.inspectAny(store.caseId, store.sourceId));
    assert.equal(profile.records, 240, 'the stream retains marked empty rows as well as populated rows');
    const gate = { framing: 'tabular', tabular: profile.tabular, sourceBytes: bytes.length };
    assert.equal(isWindowedTable(gate), true, 'both jobs must use windows for this case-original XLSX');
    const { admission: _admission, ...pin } = profile.tabular as typeof profile.tabular & { admission: unknown };
    assert.equal(isWindowedTable({ ...gate, tabular: { ...pin, developmentAssetId: 'test_only',
      developmentFamily: 'test_only' } }), false, 'development workbooks keep their existing path');
    assert.equal(isWindowedTable({ ...gate, framing: 'feature-collection' }), false);
    const attempt = { number: 1, fence: 1, inputSha256: store.raw.input_sha256 } as UspJobAttempt;
    const input = { jobId: store.rawJobId, caseId: store.caseId, sourceId: store.sourceId, sourceRevision: 1,
      subject } as AnyStreamingInput;
    await readTableWindows(store.stream(), { selection: chosen, bytes: bytes.length }, async (window, headers) => {
      await transaction(client => writeTableWindowTx(client, input, attempt, window, headers));
    });
    assert.deepEqual([store.windows.length, store.raw.records], [1, 240]);
    const window = await transaction(client => readTableWindowTx(client, store.rawJobId, 0));
    assert.equal(window!.rows.at(-1)!.sourceRow, 241);
    assert.deepEqual(window!.rows[0]!.cells, columns);
    assert.ok(window!.rows.at(-1)!.cells.every(cell => cell === null), 'styled empties never become zero');
    assert.equal(sha(bytes), store.source.sha256, 'the original is unchanged');
  });

test('TB2: a small CSV refused for its text, not its length, stays refused and queues no job', async () => {
  // test_only: a generated register whose second record opens a quote that never closes.
  const store = new Store(Buffer.from('Key,Note\nK-1,generated\n"K-2,open\n'));
  store.install();
  const request = { requestKey: randomUUID(), expectedWorkspaceRevision: 0, selection };
  await assert.rejects(new ManualIngestionService().tableFromOriginal(store.caseId, store.sourceId, request),
    { status: 422, code: 'TABULAR_HEADER_OR_READER' });
  assert.deepEqual([store.jobs.length, store.source.inspection.manualProfile], [0, undefined]);
});

test('TB2: a small workbook sheet with more than 2,000 records is read by the stream job with its sheet and headers',
  { skip: existsSync(process.env.ULPIN_PROFILE_PYTHON ?? geoPython) ? false : 'needs ULPIN_PROFILE_PYTHON' },
  async () => {
    process.env.ULPIN_PROFILE_PYTHON ??= geoPython;
    process.env.ULPIN_DOCUMENT_OCR_SCRATCH ??= join(tmpdir(), 'ulpin-table-scratch-windows');
    const control = controlWorkbook(3_000), register = { ...selection, format: 'xlsx' as const,
      sheet: 'Register', headerRows: [2] };
    assert.ok(control.bytes.length < TABULAR_LIMITS.bytes, 'the workbook is within the whole-file byte bound');
    const store = new Store(control.bytes);
    store.install();
    const service = new ManualIngestionService();
    const request = { requestKey: randomUUID(), expectedWorkspaceRevision: 0, selection: register };
    const queued = tableJob(await service.tableFromOriginal(store.caseId, store.sourceId, request));
    assert.deepEqual([queued.status, store.jobs[0]!.payload.request.selection], ['queued', register]);
    await runTableProfileJob(queued.jobId);
    const profile = TabularSourceProfileSchema.parse(await service.inspectAny(store.caseId, store.sourceId));
    assert.deepEqual([profile.records, profile.tabular.selection], [3_000, register]);
  });

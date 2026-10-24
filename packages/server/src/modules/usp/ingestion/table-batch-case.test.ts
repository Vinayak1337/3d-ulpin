import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';
import type { Pool } from 'pg';
import { TabularSourceProfileSchema } from '@ulpin/contracts/usp';
import { settings } from '../../../infrastructure/config';
import { ManualIngestionService } from './service';

const subject = 'tj1-batch-table-control';
const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };
const globals = globalThis as unknown as { ulpinPool?: Pool };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const refusal = /associated with a package or property/;
// test_only: a generated two-row register; no real record or identifier.
const csv = Buffer.from('Key,Note\nK-1,generated test_only row\nK-2,generated test_only row');
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

/**
 * One batch case bound to a site (its buildings drafted into an area), holding a CSV kept through the large upload.
 * `packaged`: a package names the case; `item`: the batch keeps the source as one of its items; `property`: the case
 * is linked to registry records. It answers only the statements of the table read and the profile read.
 */
class Batch {
  caseId = randomUUID(); sourceId = randomUUID(); siteId = randomUUID();
  caseRevision = 4; sequence = 0; written = 0;
  operations = new Map<string, { payload_hash: unknown; result: unknown }>();
  source: Record<string, any>;
  constructor(readonly state: { packaged: boolean; item: boolean; property: boolean }) {
    this.source = { id: this.sourceId, case_id: this.caseId, family_id: this.sourceId, revision: 1,
      profile: 'large-original-v1', mime_type: 'text/csv', bytes: String(csv.length), sha256: sha(csv),
      object_key: `large-originals/${this.sourceId}`,
      inspection: { largeOriginal: { operatorSubject: subject, objectEtag: '"tj1-control"' } } };
  }
  query = async (text: string, args: any[] = []) => {
    const rows = this.answer(text.replace(/\s+/g, ' ').trim(), args);
    return { rows, rowCount: rows.length };
  };
  private answer(sql: string, args: any[]): any[] {
    if (sql.startsWith('BEGIN') || sql === 'COMMIT' || sql === 'ROLLBACK') return [];
    if (sql.startsWith('SELECT id,revision FROM cases') || sql.startsWith('SELECT revision FROM cases'))
      return [{ id: this.caseId, revision: this.caseRevision, site_id: this.siteId }];
    if (sql.includes('FROM registry_case_feature_mappings')) return this.state.property ? [{ case_id: args[0] }] : [];
    if (sql.includes('FROM import_packages')) return this.state.packaged ? [{ id: randomUUID() }] : [];
    if (sql.startsWith('SELECT 1 FROM usp_intake_items WHERE case_id=$1 AND source_id=$2'))
      return this.state.item && args[0] === this.caseId && args[1] === this.sourceId ? [{ '?column?': 1 }] : [];
    if (sql.startsWith('SELECT id,family_id,revision,sha256 FROM sources')) {
      const { id, family_id, revision, sha256 } = this.source;
      return [{ id, family_id, revision, sha256 }];
    }
    if (sql.startsWith('SELECT * FROM sources WHERE id=$1 AND case_id=$2'))
      return args[0] === this.sourceId && args[1] === this.caseId ? [structuredClone(this.source)] : [];
    if (sql.includes('max(revision)')) return [{ revision: this.source.revision }];
    if (sql.startsWith('SELECT payload_hash,result FROM operations')) {
      const prior = this.operations.get(String(args[1]));
      return prior ? [prior] : [];
    }
    if (sql.startsWith('INSERT INTO operations')) {
      this.operations.set(String(args[1]), { payload_hash: args[2], result: structuredClone(args[3]) });
      return [];
    }
    if (sql.startsWith('UPDATE sources SET inspection=inspection||$2::jsonb')) {
      this.written++;
      this.source.inspection = { ...this.source.inspection, ...JSON.parse(args[1]) };
      return [];
    }
    if (sql.startsWith('UPDATE cases SET revision=revision+1')) { this.caseRevision++; return []; }
    if (sql.startsWith('INSERT INTO usp_outbox_streams') || sql.startsWith('INSERT INTO usp_outbox(')) return [];
    if (sql.startsWith('UPDATE usp_outbox_streams')) return [{ sequence: String(++this.sequence) }];
    throw new Error(`Unexpected statement: ${sql.slice(0, 120)}`);
  }
  install() {
    globals.ulpinPool = { query: this.query, connect: async () => ({ query: this.query, release() {} }) } as never;
    for (const [name, value] of [['s3Endpoint', 'http://127.0.0.1:1'], ['s3Region', 'us-east-1'],
      ['s3Bucket', 'tj1-control'], ['s3AccessKey', 'tj1-control'], ['s3SecretKey', 'tj1-control']] as const)
      mock.getter(settings, name, () => value);
    mock.method(S3Client.prototype, 'send', async () =>
      ({ Body: Readable.from([csv]), ContentLength: csv.length, ETag: '"tj1-control"' }));
    return this;
  }
}

const read = (batch: Batch) => new ManualIngestionService().tableFromOriginal(batch.caseId, batch.sourceId,
  { requestKey: randomUUID(), expectedWorkspaceRevision: batch.caseRevision, selection });

test('TJ1: a table kept as an item of a site-bound batch case is read there although its drafts made packages',
  async () => {
    const batch = new Batch({ packaged: true, item: true, property: false }).install();
    const profile = TabularSourceProfileSchema.parse(await read(batch));
    assert.deepEqual(profile.headers, ['Key', 'Note']);
    assert.equal(profile.caseId, batch.caseId);
    assert.deepEqual([batch.written, batch.caseRevision], [1, 5], 'one table receipt; nothing else is written');
    const back = TabularSourceProfileSchema.parse(await new ManualIngestionService()
      .inspectAny(batch.caseId, batch.sourceId));
    assert.deepEqual(back.headers, ['Key', 'Note'], 'the read table is read back in the batch case');
  });

test('TJ1: a packaged case that does not keep the source as a batch item still refuses the table read', async () => {
  const batch = new Batch({ packaged: true, item: false, property: false }).install();
  await assert.rejects(read(batch), refusal);
  assert.equal(batch.written, 0);
});

test('TJ1: a case linked to a recorded property refuses the table read, even for a batch item', async () => {
  const batch = new Batch({ packaged: false, item: true, property: true }).install();
  await assert.rejects(read(batch), refusal);
  assert.equal(batch.written, 0);
});

test('TJ1: only a table is read back past the package rule; another kept source of the batch is refused', async () => {
  const batch = new Batch({ packaged: true, item: true, property: false }).install();
  batch.source = { ...batch.source, profile: 'geojson-manual-v1',
    inspection: { manualProfile: { version: 'manual-geojson/1' }, actor: subject } };
  await assert.rejects(new ManualIngestionService().inspectAny(batch.caseId, batch.sourceId), refusal);
});

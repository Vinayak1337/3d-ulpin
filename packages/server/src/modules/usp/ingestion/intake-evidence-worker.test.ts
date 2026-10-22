import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { TABULAR_LIMITS, type IntakeEvidenceCandidate, type IntakeTableRowLocator } from '@ulpin/contracts/usp';
import { settings } from '../../../infrastructure/config';
import { closeStorageClient, readObject, readRetainedOriginal, sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { citedRowTx } from '../../registry/registry-table-evidence';
import { ingestionBinding } from './events';
import { NOT_READ, readIntakeEvidence, type IntakeEvidenceInput } from './intake-evidence';
import { runIntakeEvidenceJob } from './intake-evidence-worker';
import { stableUuid } from './intake-run';

// Protocol-only stores and identities. Real public NYC bytes stay test_only, in their foreign geography.
const require = createRequire(new URL('../../../../package.json', import.meta.url));
const { S3Client } = require('@aws-sdk/client-s3');
const globals = globalThis as unknown as { ulpinPool?: Pool };
const ids = (name: string) => stableUuid(`test_only:evf1:${name}`);
const caseId = ids('case'), itemId = ids('item'), sourceId = ids('source'), jobId = ids('job');
const at = '2026-10-21T00:00:00.000Z';
const registerPath = 'E:/BhuAayam-data/datasets/nyc-10013-linked/'
  + 'nyc-landmarks-preservation-commission/gpmc-yuvp.csv';
const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };
type Row = Record<string, any>;

class EvidenceStore {
  readonly original: Buffer;
  readonly source: Row;
  readonly profile: Row;
  readonly job: Row;
  readonly meta: Row;
  readonly coverage: Row;
  attempt: Row | undefined;
  candidates: IntakeEvidenceCandidate[] = [];
  streamBytes: Buffer;
  advertisedBytes: number;
  requests = 0;
  anchorLiteral = '1002421';

  constructor(bytes: Buffer) {
    this.original = bytes;
    this.streamBytes = bytes;
    this.advertisedBytes = bytes.length;
    const binding = ingestionBinding(caseId);
    const hash = sha256(bytes);
    this.source = { id: sourceId, case_id: caseId, family_id: sourceId, revision: 1, bytes: bytes.length,
      sha256: hash, object_key: `large-originals/${ids('upload')}/${hash}`, name: 'gpmc-yuvp.csv',
      profile: 'large-original-v1', status: 'needs_input', inspection: { largeOriginal: {
        uploadId: ids('upload'), operatorSubject: binding.subject, objectEtag: 'protocol-etag',
        verifiedSha256: hash, verifiedBytes: bytes.length, provenance: { state: 'not_stated', origin: 'not_stated',
          acquiredAt: at }, conversion: 'unsupported',
        bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed' } } };
    this.profile = { profile_id: ids('profile'), case_id: caseId, profile_sha256: fingerprint('test_only:profile'),
      subject: binding.subject, created_at: at, profile: { version: 'exact-key/1', requestKey: ids('request'),
        namespace: 'NYC building identification number', kind: 'integer',
        map: { anchorItemId: ids('map'), sourcePath: '/features/*/properties/bin' },
        tables: [{ itemId, selection, columnIndex: 0 }], documents: [] } };
    const input: IntakeEvidenceInput = { version: 'intake-evidence-read/1', jobId, caseId, caseRevision: 1,
      profileId: this.profile.profile_id, profileSha256: this.profile.profile_sha256, itemId, sourceId,
      sourceRevision: 1, sourceSha256: hash, subject: binding.subject, accessSha256: binding.access };
    this.job = { id: jobId, case_id: caseId, status: 'queued', operation: 'intake-evidence', payload: input,
      family: 'table', error: null };
    this.meta = { input_sha256: fingerprint(input), logical_state: 'queued' };
    this.coverage = { profile_id: this.profile.profile_id, item_id: itemId, family: 'table', job_id: jobId,
      state: 'reading', result_sha256: null, read_count: null, eligible_count: null, keyless_count: null,
      unread_count: null, failed_count: null };
  }

  query = async (text: string, args: any[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    const rows = this.read(sql) ?? this.write(sql, args);
    if (!rows) throw new Error(`Unexpected EVF1 protocol query: ${sql}`);
    return { rows: structuredClone(rows), rowCount: rows.length };
  };

  private read(sql: string): Row[] | null {
    if (sql.includes('FROM cases')) return [{ id: caseId, revision: 1, archived: false }];
    if (sql.startsWith('SELECT * FROM sources') || sql.startsWith('SELECT name FROM sources'))
      return [this.source];
    if (sql.startsWith('SELECT * FROM usp_intake_key_profiles')) return [this.profile];
    if (sql.startsWith('SELECT source_id FROM usp_intake_items')) return [{ source_id: sourceId }];
    if (sql.startsWith('SELECT t.target_id,t.package_id')) return [{ target_id: ids('target'),
      package_id: ids('package'), revision: 1 }];
    if (sql.startsWith('SELECT target_id,anchor_item_id')) return [{ target_id: ids('target'),
      anchor_item_id: ids('map'), package_id: ids('package'), feature_id: ids('feature'),
      locator: 'test_only:feature' }];
    if (sql.startsWith('SELECT id,body FROM import_packages')) return [{ id: ids('package'), body: { revision: 1,
      features: [{ id: ids('feature'), sourceRevisionId: ids('map-source'),
        properties: { bin: this.anchorLiteral } }] } }];
    if (sql.startsWith('SELECT id,revision,sha256 FROM sources')) return [{ id: ids('map-source'), revision: 1,
      sha256: fingerprint('test_only:map') }];
    if (sql.startsWith('SELECT j.id FROM jobs j')) return [];
    if (sql.startsWith('SELECT j.*,i.family') || sql.startsWith('SELECT * FROM jobs')
      || sql.startsWith('SELECT status FROM jobs')) return [this.job];
    if (sql.startsWith('SELECT * FROM usp_job_metadata') || sql.startsWith('SELECT accepted_fence'))
      return [this.meta];
    if (sql.startsWith('SELECT * FROM usp_job_attempts')) return this.attempt ? [this.attempt] : [];
    if (sql.startsWith('SELECT job_id FROM usp_intake_evidence_coverage')) return [this.coverage];
    if (sql.startsWith('SELECT item_id AS')) return [{ itemId, state: 'probed', family: 'table', format: 'csv',
      sizeClass: 'M', wave: 3, pinnedByOfficer: false }];
    if (sql.startsWith('SELECT c.*,s.id source_id')) return [{ ...this.coverage, source_id: sourceId,
      source_revision: 1, source_sha256: this.source.sha256, source_bytes: this.source.bytes,
      job_status: this.job.status, job_error: this.job.error }];
    if (sql.startsWith('SELECT * FROM usp_intake_evidence_confirmations')) return [];
    if (sql.startsWith('SELECT candidate FROM')) return this.candidates.slice(0, 200).map(candidate => ({ candidate }));
    if (sql.startsWith('SELECT outcome,count')) return [...new Set(this.candidates.map(row => row.outcome))]
      .map(outcome => ({ outcome, n: this.candidates.filter(row => row.outcome === outcome).length }));
    return null;
  }

  private write(sql: string, args: any[]): Row[] | null {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('SET TRANSACTION')) return [];
    const jobRows = this.writeJob(sql, args);
    if (jobRows) return jobRows;
    if (sql.startsWith('DELETE FROM usp_intake_evidence_candidates')) {
      this.candidates = [];
      return [];
    }
    if (sql.startsWith('INSERT INTO usp_intake_evidence_candidates')) {
      this.candidates = JSON.parse(args[3]).map((row: Row) => row.candidate);
      return [];
    }
    if (sql.startsWith('UPDATE usp_intake_evidence_coverage')) {
      const fields = ['state', 'result_sha256', 'read_count', 'eligible_count', 'keyless_count',
        'unread_count', 'failed_count'];
      fields.forEach((field, index) => { this.coverage[field] = args[index + 2]; });
      return [];
    }
    if (sql.startsWith('INSERT INTO operations')) {
      assert.equal(args[2], 'intake-evidence-anchors');
      assert.deepEqual(args[4], { anchorsSha256: fingerprint([{ targetId: ids('target'),
        packageId: ids('package'), packageRevision: 1 }]) });
      return [];
    }
    if (sql.startsWith('INSERT INTO usp_outbox')) return [];
    if (sql.startsWith('UPDATE usp_outbox_streams')) return [{ sequence: '1' }];
    return null;
  }

  private writeJob(sql: string, args: any[]): Row[] | null {
    if (sql.startsWith('INSERT INTO usp_job_attempts')) {
      this.attempt = { number: args[1], fence: args[2], owner: args[3], input_sha256: args[4], state: 'active',
        lease_until: new Date(Date.now() + 180_000) };
      return [this.attempt];
    }
    if (sql.startsWith('UPDATE usp_job_attempts')) {
      this.attempt!.state = sql.includes("state='accepted'") ? 'accepted' : 'fenced';
      return [];
    }
    if (sql.startsWith('UPDATE usp_job_metadata')) {
      this.meta.logical_state = 'failed';
      if (sql.includes("logical_state='succeeded'")) this.meta.logical_state = 'succeeded';
      else if (sql.includes("logical_state='running'")) this.meta.logical_state = 'running';
      if (this.meta.logical_state === 'succeeded') Object.assign(this.meta, { result_ref: args[1],
        accepted_fence: args[2] });
      return [];
    }
    if (sql.startsWith('UPDATE jobs')) {
      if (sql.includes("status='succeeded'")) this.job.status = 'succeeded';
      else if (sql.includes("status='running'")) this.job.status = 'running';
      else Object.assign(this.job, { status: args[1], error: args[2] });
      return [];
    }
    return null;
  }

  send = async (command: { constructor: { name: string }; input: { Key: string } }) => {
    assert.equal(command.constructor.name, 'GetObjectCommand');
    assert.equal(command.input.Key, this.source.object_key);
    this.requests += 1;
    const middle = Math.floor(this.streamBytes.length / 2);
    return { Body: Readable.from([this.streamBytes.subarray(0, middle), this.streamBytes.subarray(middle)]),
      ContentLength: this.advertisedBytes, ETag: 'protocol-etag' };
  };
}

async function isolated(bytes: Buffer, work: (store: EvidenceStore) => Promise<void>) {
  const pool = globals.ulpinPool, send = S3Client.prototype.send;
  const subject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  const names = ['s3Endpoint', 's3AccessKey', 's3SecretKey'] as const;
  const descriptors = names.map(name => Object.getOwnPropertyDescriptor(settings, name)!);
  names.forEach(name => Object.defineProperty(settings, name, { configurable: true,
    get: () => name === 's3Endpoint' ? 'http://127.0.0.1:1' : 'protocol-only-control' }));
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'evf1-protocol';
  const store = new EvidenceStore(bytes);
  globals.ulpinPool = { query: store.query, connect: async () => ({ query: store.query, release() {} }) } as never;
  S3Client.prototype.send = store.send;
  try { await work(store); }
  finally {
    globals.ulpinPool = pool;
    S3Client.prototype.send = send;
    closeStorageClient();
    names.forEach((name, index) => Object.defineProperty(settings, name, descriptors[index]));
    if (subject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = subject;
  }
}

// Minimal parser control, not an operational record or a claimed source fact.
const control = Buffer.from('bin,label\n1002421,test_only\n');
const codeIs = (code: string) => (error: any) => error.code === code;

test('the evidence worker reads a small large-originals CSV and its row can be quoted again by the registry',
  async () => isolated(control, async store => {
    await assert.rejects(readObject(store.source.object_key), codeIs('STREAMING_ORIGINAL_REQUIRED'));
    await runIntakeEvidenceJob(jobId);
    assert.equal(store.job.status, 'succeeded');
    assert.equal(store.coverage.state, 'closed');
    assert.equal(store.coverage.read_count, 1);
    assert.equal(store.candidates[0].outcome, 'matched');
    const row = store.candidates[0].evidence as IntakeTableRowLocator;
    const cited = await citedRowTx({ query: store.query } as unknown as PoolClient, ids('site'), row,
      { source: async () => ({ ...store.source, accessSha256: fingerprint('test_only:access') }) });
    assert.equal(cited.excerpt, 'bin: 1002421\nlabel: test_only');
    assert.equal(store.requests, 2, 'one streamed download for the read, one for its citation');
    assert.equal(sha256(store.original), store.source.sha256, 'processing never mutates the original');
  }));

test('a pinned SHA-256 mismatch fails the job and its read exposes the state, code and words', async () => {
  await isolated(control, async store => {
    store.streamBytes = Buffer.from(control);
    store.streamBytes[store.streamBytes.length - 2] ^= 1;
    await assert.rejects(runIntakeEvidenceJob(jobId), codeIs('INTAKE_SOURCE_INTEGRITY'));
    assert.equal(store.job.status, 'failed');
    assert.equal(store.candidates.length, 0);
    const page = await readIntakeEvidence(caseId, {});
    const coverage = page.sources[0].coverage!;
    assert.deepEqual({ ...coverage, failure: undefined }, { ...NOT_READ, failure: undefined });
    assert.deepEqual(coverage.failure, { state: 'failed', code: 'INTAKE_SOURCE_INTEGRITY',
      message: 'The retained original differs from its pinned byte count or SHA-256. Nothing was read.' });
  });
});

test('the retained-original helper refuses a pin above the caller limit before opening storage', async () => {
  await isolated(control, async store => {
    await assert.rejects(readRetainedOriginal(store.source.object_key, control.length, store.source.sha256,
      control.length - 1), (error: any) => error.code === 'INTAKE_SOURCE_LIMIT'
        && error.message.includes(`at most ${control.length - 1} bytes`));
    assert.equal(store.requests, 0);
    const exact = await readRetainedOriginal(store.source.object_key, control.length, store.source.sha256,
      control.length);
    assert.deepEqual(Buffer.from(exact), control);
  });
});

test('metadata mismatch, truncated streams and excess bytes refuse with source integrity', async () => {
  await isolated(control, async store => {
    const read = () => readRetainedOriginal(store.source.object_key, control.length, store.source.sha256,
      TABULAR_LIMITS.bytes);
    store.advertisedBytes += 1;
    await assert.rejects(read(), codeIs('INTAKE_SOURCE_INTEGRITY'));
    store.advertisedBytes = control.length;
    store.streamBytes = control.subarray(0, -1);
    await assert.rejects(read(), codeIs('INTAKE_SOURCE_INTEGRITY'));
    store.streamBytes = Buffer.concat([control, Buffer.from('\n')]);
    await assert.rejects(read(), codeIs('INTAKE_SOURCE_INTEGRITY'));
  });
});

test('the first two real LPC register records read through the large-originals worker path',
  { skip: !existsSync(registerPath) && 'the real data drive register is unavailable' }, async () => {
    const original = readFileSync(registerPath);
    let end = -1;
    for (let line = 0; line < 3; line += 1) end = original.indexOf(10, end + 1);
    const prefix = original.subarray(0, end + 1);
    await isolated(prefix, async store => {
      await runIntakeEvidenceJob(jobId);
      assert.equal(store.coverage.state, 'closed');
      assert.equal(store.coverage.read_count, 2);
      assert.equal(store.candidates.length, 2);
      assert.equal(sha256(store.original), store.source.sha256);
    });
  });

test('the real retained LPC register reads all 753 rows; duplicate BINs remain conflicting',
  { skip: !existsSync(registerPath) && 'the real data drive register is unavailable' }, async () => {
    await isolated(readFileSync(registerPath), async store => {
      store.anchorLiteral = '1002123';
      await runIntakeEvidenceJob(jobId);
      assert.equal(store.job.status, 'succeeded');
      assert.equal(store.coverage.read_count, 753);
      assert.equal(store.candidates.length, 753);
      assert.equal(store.candidates.filter(row => row.key.literal === '1002123').length, 2);
      assert(store.candidates.filter(row => row.key.literal === '1002123')
        .every(row => row.outcome === 'conflicting'));
      assert.equal(store.requests, 1);
    });
  });

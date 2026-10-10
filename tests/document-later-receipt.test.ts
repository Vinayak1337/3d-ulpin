import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Pool } from 'pg';
import { DocumentIngestionService } from '../packages/server/src/modules/usp/ingestion/documents';
import { runDocumentJob } from '../packages/server/src/modules/usp/ingestion/document-worker';
import { documentInput, documentSourceTx } from '../packages/server/src/modules/usp/ingestion/document-context';
import { fingerprint } from '../packages/server/src/modules/cases/domain';
import { closeStorageClient } from '../packages/server/src/infrastructure/storage';
import { settings } from '../packages/server/src/infrastructure/config';

// Same in-process pool/S3 substitution as the native-authority tests. These are
// protocol controls, not operational originals, records or extraction truth.
const require = createRequire(new URL('../packages/server/package.json', import.meta.url));
const { S3Client } = require('@aws-sdk/client-s3');
type Row = Record<string, any>;
const globals = globalThis as unknown as { ulpinPool?: Pool };

class DocumentControl {
  readonly current = { id: randomUUID(), revision: 0, archived: false, frame: null, context: [], site_id: null };
  readonly sources = new Map<string, Row>();
  readonly jobs = new Map<string, Row>();
  readonly operations = new Map<string, Row>();
  readonly objects = new Map<string, Buffer>();
  readonly events: object[] = [];
  readonly calls: string[] = [];
  objectReads = 0;

  query = async (sql: string, args: any[] = []) => {
    this.calls.push(sql);
    let rows: Row[] = [];
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('SET TRANSACTION') ||
      sql.includes('pg_advisory_xact_lock')) return { rows, rowCount: 0 };
    if (sql.includes('FROM cases')) rows = [this.current];
    else if (sql.startsWith('UPDATE cases SET revision=')) this.current.revision++;
    else if (sql.includes('FROM sources') || sql.startsWith('INSERT INTO sources') ||
      sql.startsWith('UPDATE sources')) rows = this.sourceQuery(sql, args);
    else if (sql.includes('FROM operations')) {
      const operation = this.operations.get(args[1]);
      rows = operation ? [operation] : [];
    }
    else if (sql.startsWith('INSERT INTO operations'))
      this.operations.set(args[1], { payload_hash: args[3], result: args[4] });
    else if (sql.includes('count(*)::int n')) rows = [{ n: 0 }];
    else if (sql.includes('usp_job_attempts')) rows = this.attemptQuery(sql, args);
    else if (sql.includes('usp_job_metadata')) rows = this.metadataQuery(sql, args);
    else if (sql.includes('FROM jobs') || sql.startsWith('INSERT INTO jobs') || sql.startsWith('UPDATE jobs'))
      rows = this.jobQuery(sql, args);
    else if (sql.startsWith('INSERT INTO usp_outbox_streams')) rows = [];
    else if (sql.startsWith('UPDATE usp_outbox_streams')) rows = [{ sequence: String(this.events.length + 1) }];
    else if (sql.startsWith('INSERT INTO usp_outbox')) this.events.push(args[2]);
    else throw new Error('Unexpected document protocol query: ' + sql);
    return { rows: structuredClone(rows), rowCount: rows.length };
  };

  private sourceQuery(sql: string, args: any[]): Row[] {
    if (sql.startsWith('INSERT INTO sources')) {
      this.sources.set(args[0], { id: args[0], case_id: args[1], family_id: args[2], revision: args[3],
        name: args[4], profile: args[5], bytes: args[6], sha256: args[7], object_key: args[8],
        inspection: args[9], mime_type: args[10], status: 'received' });
      return [];
    }
    if (sql.startsWith('UPDATE sources')) {
      const source = this.sources.get(args[0])!;
      source.status = args[1];
      source.inspection = { ...source.inspection, ...args[2] };
      return [];
    }
    if (sql.includes('max(revision)')) return [{ revision: Math.max(0, ...[...this.sources.values()]
      .filter(source => source.family_id === args[1]).map(source => source.revision)) }];
    if (sql.includes('sha256=$2')) return [...this.sources.values()].filter(source => source.sha256 === args[1]);
    const source = this.sources.get(args[1] ?? args[0]);
    return source ? [source] : [];
  }

  private jobQuery(sql: string, args: any[]): Row[] {
    if (sql.startsWith('INSERT INTO jobs')) {
      this.jobs.set(args[0], { id: args[0], case_id: args[1], source_id: args[2], operation: 'document-extraction',
        case_revision: args[3], input_fingerprint: args[4], payload: args[5], status: 'queued', error: null });
      return [];
    }
    if (sql.includes('ORDER BY created_at'))
      return [...this.jobs.values()].filter(job => job.source_id === args[1]);
    const job = this.jobs.get(args[0]);
    if (sql.startsWith('UPDATE jobs')) {
      assert(job);
      if (sql.includes("status='succeeded'")) job.status = 'succeeded';
      else if (sql.includes("status='running'")) job.status = 'running';
      else job.status = args[1];
      job.error = sql.includes('error=NULL') ? null : args[2] ?? null;
      return [];
    }
    return job ? [job] : [];
  }

  private metadataQuery(sql: string, args: any[]): Row[] {
    // Status's jobs/metadata join is read through this branch too.
    const job = this.jobs.get(args[0]);
    if (sql.startsWith('INSERT INTO usp_job_metadata')) {
      Object.assign(job!, { input_sha256: args[2], logical_state: 'queued', scope: args[3] });
      return [];
    }
    if (sql.startsWith('UPDATE usp_job_metadata')) {
      assert(job);
      if (sql.includes("logical_state='succeeded'")) {
        Object.assign(job, { logical_state: 'succeeded', result_ref: args[1], accepted_fence: args[2] });
      } else if (sql.includes("logical_state='running'")) job.logical_state = 'running';
      else job.logical_state = 'failed';
      return [];
    }
    return job?.input_sha256 ? [job] : [];
  }

  private attemptQuery(sql: string, args: any[]): Row[] {
    const job = this.jobs.get(args[0]);
    if (sql.startsWith('INSERT INTO usp_job_attempts')) {
      assert(job);
      job.attempt = { number: args[1], fence: args[2], owner: args[3], input_sha256: args[4],
        lease_until: new Date(Date.now() + 180000), state: 'active' };
      return [{ lease_until: job.attempt.lease_until }];
    }
    if (sql.startsWith('UPDATE usp_job_attempts')) {
      if (job?.attempt) {
        job.attempt.state = sql.includes("state='accepted'") ? 'accepted' : 'fenced';
        job.attempt.completion_sha256 = args[1];
      }
      return [];
    }
    if (sql.includes('lease_until>now()') && job?.attempt?.state !== 'active') return [];
    return job?.attempt ? [job.attempt] : [];
  }

  send = async (command: { constructor: { name: string }; input: { Key: string; Body?: Uint8Array } }) => {
    const { Key: key, Body: body } = command.input;
    if (command.constructor.name === 'PutObjectCommand') {
      assert(!this.objects.has(key), 'Originals and results are immutable.');
      this.objects.set(key, Buffer.from(body!));
      return {};
    }
    assert.equal(command.constructor.name, 'GetObjectCommand', 'No network, cleanup or other storage operation.');
    const bytes = this.objects.get(key)!;
    assert(bytes);
    this.objectReads++;
    return { Body: { transformToByteArray: async () => bytes } };
  };
}

async function isolated(work: (control: DocumentControl) => Promise<void>) {
  const priorPool = globals.ulpinPool;
  const priorSubject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  const priorSend = S3Client.prototype.send;
  const control = new DocumentControl();
  const storageSettings = ['s3Endpoint', 's3AccessKey', 's3SecretKey'] as const;
  const descriptors = storageSettings.map(name => Object.getOwnPropertyDescriptor(settings, name)!);
  storageSettings.forEach(name => Object.defineProperty(settings, name, {
    configurable: true, get: () => name === 's3Endpoint' ? 'http://127.0.0.1:1' : 'memory-only-control',
  }));
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'document-later-receipt-control';
  const pool = { query: control.query, connect: async () => ({ query: control.query, release() {} }) };
  globals.ulpinPool = pool as unknown as Pool;
  S3Client.prototype.send = control.send;
  try { await work(control); }
  finally {
    globals.ulpinPool = priorPool;
    S3Client.prototype.send = priorSend;
    closeStorageClient();
    storageSettings.forEach((name, index) => Object.defineProperty(settings, name, descriptors[index]));
    if (priorSubject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = priorSubject;
  }
}

async function retain(control: DocumentControl, count: number) {
  const service = new DocumentIngestionService();
  const receipts = [];
  for (let index = 0; index < count; index++) {
    // Distinct non-text bytes; the final job honestly completes as unsupported.
    receipts.push(await service.retain(control.current.id, { requestKey: randomUUID(),
      expectedCaseRevision: control.current.revision, mode: 'native_only' },
    { name: `protocol-${index}.bin`, bytes: Uint8Array.from([0, index + 1]) }));
  }
  return { service, receipts };
}

function changedFields(before: Row, after: Row) {
  return Object.keys(before).filter(field => fingerprint(before[field]) !== fingerprint(after[field]));
}

test('a read queued before another file was added ends stale today, with only caseRevision moved', async () => {
  await isolated(async control => {
    const { service, receipts } = await retain(control, 2);
    const first = receipts[0];
    const input = control.jobs.get(first.jobId)!.payload;
    const client = { query: control.query } as any;
    const now = documentInput(await documentSourceTx(client, first.caseId, first.sourceId), first.jobId, 'native_only');
    assert.deepEqual(changedFields(input, now), ['caseRevision']);
    const receiptReads = control.objectReads;
    await runDocumentJob(first.jobId);
    assert.equal(control.jobs.get(first.jobId)!.status, 'stale');
    assert.equal(control.jobs.get(first.jobId)!.error, 'DOCUMENT_INPUT_STALE');
    assert.equal(control.jobs.get(first.jobId)!.logical_state, 'failed');
    assert.equal(control.jobs.get(first.jobId)!.attempt, undefined, 'Refused before claiming an attempt.');
    assert.equal(control.objectReads, receiptReads, 'Claim refusal performs no original or derivative I/O.');
    const status = await service.status(first.caseId, first.sourceId, first.jobId);
    assert.equal(status.status, 'stale');
    assert.equal(status.code, 'DOCUMENT_INPUT_STALE');
    assert.deepEqual(control.jobs.get(first.jobId)!.payload, input, 'Never rewrite stored pins.');
  });
});

test('four files retained in a row leave the first three reads stale today', async () => {
  await isolated(async control => {
    const { service, receipts } = await retain(control, 4);
    for (const receipt of receipts) await runDocumentJob(receipt.jobId);
    const statuses = [];
    for (const receipt of receipts) {
      statuses.push(await service.status(receipt.caseId, receipt.sourceId, receipt.jobId));
    }
    assert.deepEqual(statuses.map(status => status.status), ['stale', 'stale', 'stale', 'completed']);
    assert.deepEqual(statuses.map(status => status.code),
      ['DOCUMENT_INPUT_STALE', 'DOCUMENT_INPUT_STALE', 'DOCUMENT_INPUT_STALE', null]);
    assert.equal(statuses[3].native?.status, 'unsupported', 'Job completion is not extracted-text success.');
    assert.deepEqual(receipts.map(receipt => control.jobs.get(receipt.jobId)!.payload.caseRevision), [1, 2, 3, 4]);
  });
});

test('all four queued reads must survive later unrelated receipts', {
  todo: 'K13 Step 0 stop: no complete revision-change history exists; keep the failing repair regression.',
}, async () => {
  await isolated(async control => {
    const { receipts } = await retain(control, 4);
    for (const receipt of receipts) await runDocumentJob(receipt.jobId);
    assert.deepEqual(receipts.map(receipt => control.jobs.get(receipt.jobId)!.status),
      ['succeeded', 'succeeded', 'succeeded', 'succeeded']);
  });
});

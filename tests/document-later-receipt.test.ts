import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Pool } from 'pg';
import { DocumentIngestionService } from '../packages/server/src/modules/usp/ingestion/documents';
import { runDocumentJob } from '../packages/server/src/modules/usp/ingestion/document-worker';
import {
  assertDocumentInputTx, documentInput, documentInputFreshness, documentSourceTx, locateDocumentInputTx,
} from '../packages/server/src/modules/usp/ingestion/document-context';
import { extractSourceDocument } from '../packages/server/src/modules/usp/ingestion/document-native';
import { documentOcrConfigSha } from '../packages/server/src/modules/usp/ingestion/document-ocr';
import { AppError } from '../packages/server/src/infrastructure/errors';
import type { DocumentInput } from '@ulpin/contracts/usp';
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
  const priorGatewayEnabled = process.env.ULPIN_MODEL_GATEWAY_ENABLED;
  const priorSend = S3Client.prototype.send;
  const control = new DocumentControl();
  const storageSettings = ['s3Endpoint', 's3AccessKey', 's3SecretKey'] as const;
  const descriptors = storageSettings.map(name => Object.getOwnPropertyDescriptor(settings, name)!);
  storageSettings.forEach(name => Object.defineProperty(settings, name, {
    configurable: true, get: () => name === 's3Endpoint' ? 'http://127.0.0.1:1' : 'memory-only-control',
  }));
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'document-later-receipt-control';
  process.env.ULPIN_MODEL_GATEWAY_ENABLED = '0';
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
    if (priorGatewayEnabled === undefined) delete process.env.ULPIN_MODEL_GATEWAY_ENABLED;
    else process.env.ULPIN_MODEL_GATEWAY_ENABLED = priorGatewayEnabled;
  }
}

async function retain(control: DocumentControl, count: number, mode: DocumentInput['mode'] = 'native_only') {
  const service = new DocumentIngestionService();
  const receipts = [];
  const offset = control.sources.size;
  for (let index = 0; index < count; index++) {
    // Distinct non-text bytes; completed jobs honestly report unsupported.
    receipts.push(await service.retain(control.current.id, { requestKey: randomUUID(),
      expectedCaseRevision: control.current.revision, mode },
    { name: `protocol-${offset + index}.bin`, bytes: Uint8Array.from([0, offset + index + 1]) }));
  }
  return { service, receipts };
}

function changedFields(before: Row, after: Row) {
  return Object.keys(before).filter(field => fingerprint(before[field]) !== fingerprint(after[field]));
}

const clientFor = (control: DocumentControl) => ({ query: control.query }) as any;
const refusal = (status: number, code: string) => (error: unknown) =>
  error instanceof AppError && error.status === status && error.code === code;

async function freshness(control: DocumentControl, input: DocumentInput) {
  const ctx = await documentSourceTx(clientFor(control), input.caseId, input.sourceId);
  return documentInputFreshness(ctx, input);
}

function pinJob(control: DocumentControl, jobId: string, fields: Partial<DocumentInput>) {
  const job = control.jobs.get(jobId)!;
  job.payload = { ...job.payload, ...fields };
  job.input_fingerprint = fingerprint(job.payload);
  job.input_sha256 = job.input_fingerprint;
  return job.payload as DocumentInput;
}

async function staleRead(control: DocumentControl, jobId: string) {
  const reads = control.objectReads;
  await runDocumentJob(jobId);
  const job = control.jobs.get(jobId)!;
  assert.equal(job.status, 'stale');
  assert.equal(job.error, 'DOCUMENT_INPUT_STALE');
  assert.equal(job.attempt, undefined, 'Refused before claim.');
  assert.equal(control.objectReads, reads, 'Refused claim performs no original or derivative I/O.');
}

test('a read queued before another file was added succeeds with only caseRevision moved', async () => {
  await isolated(async control => {
    const { service, receipts } = await retain(control, 2);
    const first = receipts[0];
    const job = control.jobs.get(first.jobId)!;
    const input = structuredClone(job.payload);
    const digest = job.input_fingerprint;
    const now = documentInput(await documentSourceTx(clientFor(control), first.caseId, first.sourceId),
      first.jobId, 'native_only');
    assert.deepEqual(changedFields(input, now), ['caseRevision']);
    await runDocumentJob(first.jobId);
    assert.equal(job.status, 'succeeded');
    const status = await service.status(first.caseId, first.sourceId, first.jobId);
    assert.equal(status.status, 'completed');
    assert.equal(status.code, null);
    assert.deepEqual(await freshness(control, input), { current: true, reasons: [] });
    assert.deepEqual(job.payload, input, 'Never rewrite stored pins.');
    assert.equal(job.input_fingerprint, digest);
    const result = JSON.parse(control.objects.get(`document-results/${first.jobId}/${job.result_ref.sha256}.json`)!);
    assert.deepEqual(result.input, input, 'Result retains its queued revision.');
  });
});

test('all four queued reads survive later unrelated receipts, without rewriting their revisions', async () => {
  await isolated(async control => {
    const { service, receipts } = await retain(control, 4);
    for (const receipt of receipts) await runDocumentJob(receipt.jobId);
    assert.deepEqual(receipts.map(receipt => control.jobs.get(receipt.jobId)!.status),
      ['succeeded', 'succeeded', 'succeeded', 'succeeded']);
    for (const receipt of receipts) {
      const status = await service.status(receipt.caseId, receipt.sourceId, receipt.jobId);
      assert.equal(status.status, 'completed');
      assert.equal(status.code, null);
      assert.equal(status.native?.status, 'unsupported', 'Completion is not extracted-text success.');
      assert.deepEqual(await freshness(control, control.jobs.get(receipt.jobId)!.payload),
        { current: true, reasons: [] });
    }
    assert.deepEqual(receipts.map(receipt => control.jobs.get(receipt.jobId)!.payload.caseRevision), [1, 2, 3, 4]);
  });
});

test('another receipt between claim and completion, and after completion, keeps the reading current', async () => {
  await isolated(async control => {
    const { service, receipts: [first] } = await retain(control, 1);
    const input = structuredClone(control.jobs.get(first.jobId)!.payload);
    await runDocumentJob(first.jobId, { extract: async (pinned, bytes) => {
      assert.equal(control.jobs.get(first.jobId)!.status, 'running');
      await retain(control, 1);
      return extractSourceDocument(pinned, bytes);
    } });
    const status = () => service.status(first.caseId, first.sourceId, first.jobId);
    assert.equal((await status()).status, 'completed');
    const result = structuredClone(control.jobs.get(first.jobId)!.result_ref);
    await retain(control, 1);
    assert.equal((await status()).status, 'completed');
    assert.deepEqual(await freshness(control, input), { current: true, reasons: [] });
    assert.deepEqual(control.jobs.get(first.jobId)!.result_ref, result);
    assert.deepEqual(control.jobs.get(first.jobId)!.payload, input);
  });
});

test('a unit-edit counter advance without a receipt does not invalidate a source read', async () => {
  await isolated(async control => {
    const { receipts: [first] } = await retain(control, 1);
    control.current.revision++;
    await runDocumentJob(first.jobId);
    assert.equal(control.jobs.get(first.jobId)!.status, 'succeeded');
    assert.equal(control.sources.size, 1);
    assert.deepEqual(await freshness(control, control.jobs.get(first.jobId)!.payload), { current: true, reasons: [] });
  });
});

test('a newer receipt in this source family still stales the queued read as source_superseded', async () => {
  await isolated(async control => {
    const { service, receipts: [first] } = await retain(control, 1);
    await service.retain(first.caseId, { requestKey: randomUUID(), expectedCaseRevision: 1,
      familyId: first.sourceId, expectedSourceRevision: 1, mode: 'native_only' },
    { name: 'revised-protocol.bin', bytes: Uint8Array.from([0, 2]) });
    await staleRead(control, first.jobId);
    assert.equal((await service.status(first.caseId, first.sourceId, first.jobId)).status, 'stale');
    assert.deepEqual(await freshness(control, control.jobs.get(first.jobId)!.payload),
      { current: false, reasons: ['source_superseded'] });
  });
});

test('archived cases and changed subjects still deny document authority', async () => {
  await isolated(async control => {
    const { service, receipts: [first] } = await retain(control, 1);
    const status = () => service.status(first.caseId, first.sourceId, first.jobId);
    control.current.archived = true;
    await assert.rejects(status, refusal(403, 'DOCUMENT_DENIED'));
    control.current.archived = false;
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'different-control-subject';
    await assert.rejects(status, refusal(403, 'DOCUMENT_DENIED'));
    assert.equal(control.jobs.get(first.jobId)!.attempt, undefined);
  });
});

test('retained access drift denies disclosure and still refuses current derivation', async () => {
  await isolated(async control => {
    const { receipts: [first] } = await retain(control, 1);
    const input = pinJob(control, first.jobId, { accessSha256: '0'.repeat(64) });
    await assert.rejects(() => locateDocumentInputTx(clientFor(control), input), refusal(403, 'DOCUMENT_DENIED'));
    await assert.rejects(() => assertDocumentInputTx(clientFor(control), input), refusal(409, 'STALE_REVISION'));
    await staleRead(control, first.jobId);
  });
});

for (const field of ['frame', 'context'] as const) {
  test(`a changed case ${field} still stales the source read as case_advanced`, async () => {
    await isolated(async control => {
      const { receipts: [first] } = await retain(control, 1);
      // Missing vs explicit empty frame; changed context contains no invented feature.
      if (field === 'frame') Object.assign(control.current, { frame: {} });
      else Object.assign(control.current, { context: null });
      await staleRead(control, first.jobId);
      assert.deepEqual(await freshness(control, control.jobs.get(first.jobId)!.payload),
        { current: false, reasons: ['case_advanced'] });
    });
  });
}

for (const [field, reason, mode] of [
  ['readerSha256', 'reader_changed', 'native_only'],
  ['gatewayPolicySha256', 'policy_changed', 'propose'],
] as const) {
  test(`a moved ${field} still refuses despite a later case revision`, async () => {
    await isolated(async control => {
      const { receipts: [first] } = await retain(control, 1, mode);
      const input = pinJob(control, first.jobId, { [field]: '0'.repeat(64) });
      control.current.revision++;
      await staleRead(control, first.jobId);
      assert.deepEqual(await freshness(control, input), { current: false, reasons: [reason] });
    });
  });
}

test('a changed OCR configuration still refuses before any OCR worker or object I/O', async () => {
  await isolated(async control => {
    const { receipts: [first] } = await retain(control, 1);
    const input = pinJob(control, first.jobId, { ocrSelection: { page: 1 }, ocrConfigSha256: documentOcrConfigSha() });
    const prior = process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
    try {
      process.env.ULPIN_DOCUMENT_OCR_SCRATCH = 'memory-only-changed-control';
      await staleRead(control, first.jobId);
      assert.deepEqual(await freshness(control, input), { current: false, reasons: ['policy_changed'] });
    } finally {
      if (prior === undefined) delete process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
      else process.env.ULPIN_DOCUMENT_OCR_SCRATCH = prior;
    }
  });
});

test('an archive selection differing from the registered job remains a conflict after a case advance', async () => {
  await isolated(async control => {
    const { receipts: [first] } = await retain(control, 2);
    const input = control.jobs.get(first.jobId)!.payload;
    const selected = { ...input, archiveSelection: { ordinal: 0, memberSha256: '0'.repeat(64), memberBytes: 1 } };
    await assert.rejects(() => assertDocumentInputTx(clientFor(control), selected), (error: unknown) =>
      refusal(409, 'STALE_REVISION')(error) && (error as AppError).message.includes('registered document job input'));
    assert.equal(control.jobs.get(first.jobId)!.attempt, undefined);
    assert.deepEqual(control.jobs.get(first.jobId)!.payload, input);
  });
});

test('a missing source never grants document authority or discloses a derivative', async () => {
  await isolated(async control => {
    const { service, receipts: [first] } = await retain(control, 1);
    control.sources.delete(first.sourceId);
    await assert.rejects(() => service.status(first.caseId, first.sourceId, first.jobId), refusal(404, 'NOT_FOUND'));
    assert.equal(control.jobs.get(first.jobId)!.attempt, undefined);
  });
});

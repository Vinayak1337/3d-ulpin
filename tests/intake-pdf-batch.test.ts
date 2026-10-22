import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import type { Pool } from 'pg';
import { DOCUMENT_LIMITS, documentScannedPages, DocumentStatusSchema }
  from '../packages/contracts/src/usp/document-ingestion';
import type { IntakeCard } from '@ulpin/contracts/usp';
import { DocumentIngestionService } from '../packages/server/src/modules/usp/ingestion/documents';
import { batchPdfSettlement, queueIntakeDraftTx, pageWords }
  from '../packages/server/src/modules/usp/ingestion/intake-draft';
import type { IntakeSourceRow } from '../packages/server/src/modules/usp/ingestion/intake-context';
import { failDocumentJob, runDocumentJob } from '../packages/server/src/modules/usp/ingestion/document-worker';
import { extractSourceDocument } from '../packages/server/src/modules/usp/ingestion/document-native';
import { closeStorageClient, sha256 } from '../packages/server/src/infrastructure/storage';
import { settings } from '../packages/server/src/infrastructure/config';

// G10 protocol controls, test_only: an in-process pool and object store as in document-later-receipt.test.ts.
// The PDF reader's reply mirrors the page structure the repository's native reader gave for the real Magnolia
// layout and Tower 3 section PDFs (docs/evidence/gf1/g10/result.json); their text stays outside Git, so the
// passages here are neutral control lines generated in this test, not values from any drawing.
const require = createRequire(new URL('../packages/server/package.json', import.meta.url));
const { S3Client } = require('@aws-sdk/client-s3');
type Row = Record<string, any>;
const globals = globalThis as unknown as { ulpinPool?: Pool };
const subject = 'g10-batch-pdf-control';

class BatchControl {
  readonly current = { id: randomUUID(), revision: 3, archived: false, frame: null, context: [], site_id: null };
  readonly sources = new Map<string, Row>();
  readonly jobs = new Map<string, Row>();
  readonly objects = new Map<string, Buffer>();
  readonly events: Row[] = [];
  readonly operations = new Map<string, Row>();
  item: Row | null = null;

  query = async (sql: string, args: any[] = []) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('SET TRANSACTION')
      || sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
    const rows = this.itemQuery(sql, args) ?? this.sourceQuery(sql, args) ?? this.jobQuery(sql, args)
      ?? this.operationQuery(sql, args) ?? this.outboxQuery(sql, args);
    if (!rows) throw new Error(`Unexpected G10 protocol query: ${sql}`);
    return { rows: structuredClone(rows), rowCount: rows.length };
  };

  private itemQuery(sql: string, args: any[]): Row[] | null {
    const item = this.item!;
    if (sql.startsWith('SELECT * FROM usp_intake_items')) return item.source_id === args[0] ? [item] : [];
    if (sql.startsWith('SELECT state,placement,plan_ref')) return [item];
    if (sql.startsWith('SELECT item_id AS')) return [{ itemId: item.item_id, state: item.state, family: item.family,
      format: 'pdf', sizeClass: 'M', wave: 4, pinnedByOfficer: false }];
    if (!sql.startsWith('UPDATE usp_intake_items SET state=')) return null;
    Object.assign(item, { state: args[2], placement: args[3], plan_ref: args[4], records_seen: args[5],
      limit_reason: args[6] });
    return [];
  }

  private sourceQuery(sql: string, args: any[]): Row[] | null {
    if (sql.includes('FROM cases')) return [this.current];
    const source = this.sources.get(args[1] ?? args[0]) ?? this.sources.get(args[0]);
    if (sql.startsWith('UPDATE sources SET inspection=COALESCE')) {
      source!.inspection = { ...source!.inspection, ...args[1] };
      return [];
    }
    if (sql.startsWith('UPDATE sources SET status')) {
      Object.assign(source!, { status: args[1], inspection: { ...source!.inspection, ...args[2] } });
      return [];
    }
    if (!sql.includes('FROM sources')) return null;
    if (sql.includes('max(revision)')) return [{ revision: 1 }];
    return source ? [source] : [];
  }

  private jobQuery(sql: string, args: any[]): Row[] | null {
    if (sql.includes('count(*)::int n')) return [{ n: 0 }];
    if (sql.includes('usp_job_attempts')) return this.attemptQuery(sql, args);
    if (sql.includes('usp_job_metadata')) return this.metadataQuery(sql, args);
    const jobs = sql.includes('FROM jobs') || sql.startsWith('INSERT INTO jobs') || sql.startsWith('UPDATE jobs');
    if (!jobs) return null;
    if (sql.startsWith('INSERT INTO jobs')) {
      this.jobs.set(args[0], { id: args[0], case_id: args[1], source_id: args[2], operation: 'document-extraction',
        case_revision: args[3], input_fingerprint: args[4], payload: args[5], status: 'queued', error: null });
      return [];
    }
    if (sql.includes('ORDER BY created_at')) return [...this.jobs.values()].filter(job => job.source_id === args[1]);
    const job = this.jobs.get(args[0]);
    if (sql.startsWith('UPDATE jobs')) {
      if (sql.includes("status='succeeded'")) job!.status = 'succeeded';
      else if (sql.includes("status='running'")) job!.status = 'running';
      else Object.assign(job!, { status: args[1], error: args[2] });
      return [];
    }
    return job ? [job] : [];
  }

  private metadataQuery(sql: string, args: any[]): Row[] {
    const job = this.jobs.get(args[0]);
    if (sql.startsWith('INSERT INTO usp_job_metadata')) {
      Object.assign(job!, { input_sha256: args[2], logical_state: 'queued', scope: args[3] });
      return [];
    }
    if (sql.startsWith('UPDATE usp_job_metadata')) {
      if (sql.includes("logical_state='succeeded'")) {
        Object.assign(job!, { logical_state: 'succeeded', result_ref: args[1], accepted_fence: args[2] });
      } else job!.logical_state = sql.includes("logical_state='running'") ? 'running' : 'failed';
      return [];
    }
    return job?.input_sha256 ? [job] : [];
  }

  private attemptQuery(sql: string, args: any[]): Row[] {
    const job = this.jobs.get(args[0]);
    if (sql.startsWith('INSERT INTO usp_job_attempts')) {
      job!.attempt = { number: args[1], fence: args[2], owner: args[3], input_sha256: args[4],
        lease_until: new Date(Date.now() + 180000), state: 'active' };
      return [{ lease_until: job!.attempt.lease_until }];
    }
    if (sql.startsWith('UPDATE usp_job_attempts')) {
      if (job?.attempt) Object.assign(job.attempt, { state: sql.includes("state='accepted'") ? 'accepted' : 'fenced',
        completion_sha256: args[1] });
      return [];
    }
    if (sql.includes('lease_until>now()') && job?.attempt?.state !== 'active') return [];
    return job?.attempt ? [job.attempt] : [];
  }

  private operationQuery(sql: string, args: any[]): Row[] | null {
    if (sql.includes('FROM operations')) {
      const prior = this.operations.get(args[1]);
      return prior ? [prior] : [];
    }
    if (!sql.startsWith('INSERT INTO operations')) return null;
    this.operations.set(args[1], { payload_hash: args[3], result: args[4] });
    return [];
  }

  private outboxQuery(sql: string, args: any[]): Row[] | null {
    if (sql.startsWith('INSERT INTO usp_outbox_streams')) return [];
    if (sql.startsWith('UPDATE usp_outbox_streams')) return [{ sequence: String(this.events.length + 1) }];
    if (!sql.startsWith('INSERT INTO usp_outbox')) return null;
    this.events.push(args[2]);
    return [];
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
    const stream = Readable.from([bytes]);
    return { Body: Object.assign(stream, { transformToByteArray: async () => bytes }),
      ContentLength: bytes.length, ETag: 'protocol-only-etag' };
  };

  /** A PDF kept through the uploads route and probed into the batch: a large original, not a document receipt. */
  retainPdf(bytes: Buffer, declaredBytes = bytes.length): IntakeSourceRow {
    const id = randomUUID();
    const source = { id, case_id: this.current.id, family_id: id, revision: 1, name: 'control.pdf',
      profile: 'large-original-v1', bytes: declaredBytes, sha256: sha256(bytes),
      object_key: `large-originals/${id}/${sha256(bytes)}`,
      status: 'needs_input', inspection: { profile: 'large-original-v1' } };
    this.sources.set(id, source);
    this.objects.set(source.object_key, bytes);
    this.item = { item_id: id, source_id: id, case_id: this.current.id, parent_item_id: null, state: 'probed',
      placement: 'undecided', family: 'document', card, plan_ref: null, records_seen: 0, limit_reason: null };
    return source;
  }
}

const card = { format: 'pdf', family: 'document' } as IntakeCard;
const clientOf = (control: BatchControl) => ({ query: control.query }) as any;
// test_only control bytes: a PDF header, so the reader's own byte check names the format.
const pdfBytes = (label: string) => Buffer.from(`%PDF-1.7\n% test_only ${label}\n%%EOF\n`);

async function isolated(work: (control: BatchControl) => Promise<void>) {
  const priorPool = globals.ulpinPool;
  const priorSubject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  const priorSend = S3Client.prototype.send;
  const control = new BatchControl();
  const storageSettings = ['s3Endpoint', 's3AccessKey', 's3SecretKey'] as const;
  const descriptors = storageSettings.map(name => Object.getOwnPropertyDescriptor(settings, name)!);
  storageSettings.forEach(name => Object.defineProperty(settings, name, {
    configurable: true, get: () => name === 's3Endpoint' ? 'http://127.0.0.1:1' : 'memory-only-control',
  }));
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = subject;
  globals.ulpinPool = { query: control.query, connect: async () => ({ query: control.query, release() {} }) } as any;
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

type Reply = { parts: { text: string; locator: Record<string, unknown> }[]; warnings: string[] };
const noText = (page: number) => `PDF page ${page} has no native text; image interpretation/OCR remains unresolved.`;
const lines = (page: number, line: number, text: string) => ({ text,
  locator: { page, line, lineEnd: line + 7, label: `PDF page ${page}, lines ${line}–${line + 7}` } });
/** The Magnolia layout's structure: text on pages 1 and 2, pages 3 to 6 drawn without a text layer. */
const twoTextPages: Reply = { parts: [lines(1, 1, 'Control sheet title\nControl scale line\n'),
  lines(1, 9, 'Control first floor outline\n'), lines(2, 1, 'Control room label\nControl area line\n'),
  lines(2, 9, 'Control legend line\n')], warnings: [3, 4, 5, 6].map(noText) };
/** The Tower 3 section's structure: one page and no text layer at all. */
const scannedSheet: Reply = { parts: [], warnings: [noText(1)] };

async function readWith(control: BatchControl, jobId: string, reply: Reply) {
  await runDocumentJob(jobId, { extract: (input, bytes) => extractSourceDocument(input, bytes,
    async () => ({ format: 'pdf', status: 'ready', sourceSha256: input.sourceSha256, ...reply })) });
  return control.jobs.get(jobId)!;
}

test('a batch PDF is read by the document reader on its text layer, and its item says what was found', async () => {
  await isolated(async control => {
    const source = control.retainPdf(pdfBytes('two text pages'));
    const jobId = await queueIntakeDraftTx(clientOf(control), source, card);
    assert.ok(jobId);
    const job = control.jobs.get(jobId)!;
    assert.equal(job.payload.mode, 'native_only', 'A batch PDF never goes to a provider.');
    assert.equal(job.payload.gatewayPolicySha256, null);
    assert.deepEqual({ ...control.sources.get(source.id)!.inspection.documentOriginal, receivedAt: null },
      { version: 'source-document/1', subject, format: 'pdf', sha256: source.sha256, bytes: Number(source.bytes),
        receivedAt: null });
    assert.deepEqual([control.item!.state, control.item!.placement, control.item!.limit_reason], ['reading',
      'undecided', 'Reading the text layer of each page. Nothing is recorded until you confirm it.']);
    control.item!.state = 'probed';
    const again = await queueIntakeDraftTx(clientOf(control), source, card);
    assert.equal(again, jobId, 'A later probe reads nothing again.');
    assert.equal(control.jobs.size, 1);

    const done = await readWith(control, jobId, twoTextPages);
    assert.equal(done.status, 'succeeded');
    assert.deepEqual([control.item!.state, control.item!.placement], ['read', 'undecided']);
    assert.equal(control.item!.limit_reason, '6 pages read. Text was found on pages 1–2. Pages 3–6 have no text '
      + 'layer (scanned). Open the PDF reading to request bounded OCR. 2 passages on pages 1–2 name floors, '
      + 'storeys, levels or rooms: candidates cited to their page and lines, for your review. Nothing is '
      + 'recorded until you confirm it.');
    const accepted = control.sources.get(source.id)!.inspection.documentAccepted;
    assert.deepEqual([accepted.nativeStatus, accepted.modelStatus], ['extracted', 'not_requested']);
    assert.ok(control.events.some(event => event?.change?.kind === 'intake.item' && event.change.state === 'read'));
  });
});

test('a scanned PDF with no text layer is said to be unread, and nothing is proposed from it', async () => {
  await isolated(async control => {
    const source = control.retainPdf(pdfBytes('one scanned sheet'));
    const jobId = (await queueIntakeDraftTx(clientOf(control), source, card))!;
    await readWith(control, jobId, scannedSheet);
    assert.deepEqual([control.item!.state, control.item!.placement, control.item!.limit_reason], ['read',
      'not_understood', '1 page read. Page 1 has no text layer (scanned). Open the PDF reading to request '
        + 'bounded OCR. Nothing is recorded until you confirm it.']);
  });
});

test('a PDF above the reader bound rests kept in words, and a stopped read says so', async () => {
  await isolated(async control => {
    const large = control.retainPdf(pdfBytes('declared large'), 16 * 1024 * 1024 + 1);
    assert.equal(await queueIntakeDraftTx(clientOf(control), large, card), null);
    assert.equal(control.jobs.size, 0);
    assert.deepEqual([control.item!.state, control.item!.placement, control.item!.limit_reason], ['probed',
      'not_understood', 'Kept as a PDF document (16 MB). The page reader in a batch reads a PDF of at most 16 MB, '
        + 'so this one is not read; the original is kept with its SHA-256.']);
    const source = control.retainPdf(pdfBytes('stopped'));
    const jobId = (await queueIntakeDraftTx(clientOf(control), source, card))!;
    await failDocumentJob(jobId, 'DOCUMENT_WORKER_FAILED');
    assert.deepEqual([control.item!.state, control.item!.placement, control.item!.limit_reason], ['failed_part',
      'not_understood',
      'The page reader stopped before it finished; the original is kept unchanged with its SHA-256.']);
  });
});

test('a PDF above the page reader byte bound says its text layer was not read, and OCR when the original allows', () => {
  const native = { status: 'tool_error', format: 'pdf', readerSha256: 'a'.repeat(64),
    code: 'NATIVE_READER_BYTE_LIMIT', warnings: [], parts: [] } as const;
  const unread = 'The page reader reads a PDF of at most 10 MB, so the text layer of this one was not read; the '
    + 'original is kept with its SHA-256.';
  assert.deepEqual(batchPdfSettlement(native, DOCUMENT_LIMITS.originalBytes), { state: 'failed_part',
    placement: 'not_understood', limitReason: `${unread} Its pages can be read by OCR from the PDF reading, for a `
      + 'PDF of at most 8 pages. Nothing read is a fact until you confirm it.' });
  assert.deepEqual(batchPdfSettlement(native, DOCUMENT_LIMITS.originalBytes + 1), { state: 'failed_part',
    placement: 'not_understood', limitReason: unread });
});

test('the officer can OCR a batch PDF through the existing retry route, without a second active job', async () => {
  await isolated(async control => {
    const source = control.retainPdf(pdfBytes('scanned selection'));
    const nativeJob = (await queueIntakeDraftTx(clientOf(control), source, card))!;
    await readWith(control, nativeJob, twoTextPages);
    const service = new DocumentIngestionService();
    const reading = DocumentStatusSchema.parse(await service.status(control.current.id, source.id, nativeJob));
    const scanned = documentScannedPages(reading.native!);
    assert.deepEqual(scanned, [3, 4, 5, 6]);
    const request = { requestKey: randomUUID(), expectedCaseRevision: reading.currentCaseRevision,
      expectedSourceRevision: reading.sourceRevision, sourceSha256: reading.sourceSha256,
      mode: 'native_only', ocrSelection: { page: scanned[0] } };
    const first = await service.retry(control.current.id, source.id, request);
    const job = control.jobs.get(first.jobId)!;
    assert.deepEqual(job.payload.ocrSelection, { page: 3 });
    assert.equal(job.payload.mode, 'native_only');
    assert.equal(job.payload.gatewayPolicySha256, null);
    for (const state of ['queued', 'running']) {
      job.status = state;
      const again = await service.retry(control.current.id, source.id, { ...request, requestKey: randomUUID() });
      assert.equal(again.jobId, first.jobId);
      assert.equal(control.jobs.size, 2, 'One native job and one OCR job, even with a second request key.');
    }
    await runDocumentJob(first.jobId, {
      extract: (input, bytes) => extractSourceDocument(input, bytes, async () => ({
        format: 'pdf', status: 'ready', sourceSha256: input.sourceSha256, ...twoTextPages,
      })),
      ocr: async input => ({ sourceSha256: input.sourceSha256, sourceRevision: input.sourceRevision,
        sourcePage: 3, requestedRegion: null,
        sourcePageFrame: { kind: 'pdf_display_page_top_left_points', rotation: 0, width: 612, height: 792 },
        method: 'ocr:tesseract-cli-5.5.1:sparse-tsv-v1', toolStatus: 'complete', outputStatus: 'complete',
        textCompleteness: 'unverified', issues: [], items: [{ text: 'test_only control passage', label: 'line',
          method: 'ocr:tesseract-cli-sparse-tsv', sourcePageBoxes: [{ pageNumber: 3,
            frame: 'pdf_display_page_top_left_points', box: [10, 20, 80, 40],
            derivedFrom: 'tesseract_tsv_pixels_via_mupdf_pixel_origin' }] }] }),
    });
    const result = DocumentStatusSchema.parse(await service.status(control.current.id, source.id, first.jobId));
    assert.equal(result.status, 'completed');
    assert.equal(result.ocr?.sourcePage, 3);
    assert.equal(result.ocrItems?.length, 1);
    assert.deepEqual(result.ocrItems?.[0].sourcePageBoxes[0].box, [10, 20, 80, 40]);
    assert.equal(control.sources.get(source.id)!.sha256, source.sha256);
    assert.equal(control.item!.records_seen, 0, 'OCR text never becomes a record field or a room.');
  });
});

test('only native no-text PDF warnings identify scanned pages, sorted and without duplicates', () => {
  const native = { format: 'pdf', status: 'extracted', warnings: [noText(9), noText(3), noText(3), 'other'] };
  assert.deepEqual(documentScannedPages(native), [3, 9]);
  assert.deepEqual(documentScannedPages({ ...native, warnings: [] }), []);
  assert.deepEqual(documentScannedPages({ ...native, status: 'encrypted' }), []);
  assert.deepEqual(documentScannedPages({ ...native, format: 'text' }), []);
});

test('page numbers read as runs', () => {
  assert.equal(pageWords([3]), 'page 3');
  assert.equal(pageWords([1, 2]), 'pages 1–2');
  assert.equal(pageWords([1, 3, 5, 6]), 'pages 1, 3 and 5–6');
});

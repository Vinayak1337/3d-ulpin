import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { access, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { zipSync } from 'fflate';
import { DOCUMENT_LIMITS, documentScannedPages, DocumentStatusSchema, type DocumentInput, type DocumentResult }
  from '../packages/contracts/src/usp/document-ingestion';
import type { IntakeCard } from '@ulpin/contracts/usp';
import { DocumentIngestionService } from '../packages/server/src/modules/usp/ingestion/documents';
import { batchPdfSettlement, queueIntakeDraftTx, pageWords, stopBatchPdfTx }
  from '../packages/server/src/modules/usp/ingestion/intake-draft';
import type { IntakeSourceRow } from '../packages/server/src/modules/usp/ingestion/intake-context';
import { failDocumentJob, runDocumentJob } from '../packages/server/src/modules/usp/ingestion/document-worker';
import { extractSourceDocument } from '../packages/server/src/modules/usp/ingestion/document-native';
import { closeStorageClient, sha256, streamRetainedOriginal } from '../packages/server/src/infrastructure/storage';
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
      format: item.card.format, sizeClass: 'M', wave: 4, pinnedByOfficer: false }];
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

  /** A document kept through uploads and probed into the batch: a large original, not a document receipt. */
  retainPdf(bytes: Buffer, declaredBytes = bytes.length, format: 'pdf' | 'docx' = 'pdf'): IntakeSourceRow {
    const id = randomUUID();
    const source = { id, case_id: this.current.id, family_id: id, revision: 1, name: `control.${format}`,
      profile: 'large-original-v1', bytes: declaredBytes, sha256: sha256(bytes),
      object_key: `large-originals/${id}/${sha256(bytes)}`,
      status: 'needs_input', inspection: { profile: 'large-original-v1' } };
    this.sources.set(id, source);
    this.objects.set(source.object_key, bytes);
    this.item = { item_id: id, source_id: id, case_id: this.current.id, parent_item_id: null, state: 'probed',
      placement: 'undecided', family: 'document', card: { ...card, format }, plan_ref: null,
      records_seen: 0, limit_reason: null };
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
    const large = control.retainPdf(pdfBytes('declared large'), 1024 ** 3 + 1);
    assert.equal(await queueIntakeDraftTx(clientOf(control), large, card), null);
    assert.equal(control.jobs.size, 0);
    assert.deepEqual([control.item!.state, control.item!.placement, control.item!.limit_reason], ['probed',
      'not_understood', 'Kept as a PDF document (1 GB). The page reader in a batch reads a PDF of at most 1 GiB, '
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
  const unread = 'Its text layer is not read above 10 MiB; the original is kept with its SHA-256.';
  assert.deepEqual(batchPdfSettlement(native, DOCUMENT_LIMITS.originalBytes), { state: 'failed_part',
    placement: 'not_understood', limitReason: `${unread} Open its pages to view them or read one page by OCR `
      + '(up to 400 pages). Nothing read is a fact until you confirm it.' });
  assert.deepEqual(batchPdfSettlement(native, DOCUMENT_LIMITS.originalBytes + 1), { state: 'failed_part',
    placement: 'not_understood', limitReason: `${unread} Page opening is limited to 1 GiB.` });
});

function ocrPage(input: DocumentInput, page: number): NonNullable<DocumentResult['ocr']> {
  return { sourceSha256: input.sourceSha256, sourceRevision: input.sourceRevision,
    sourcePage: page, requestedRegion: null,
    sourcePageFrame: { kind: 'pdf_display_page_top_left_points', rotation: 0, width: 612, height: 792 },
    method: 'ocr:tesseract-cli-5.5.1:sparse-tsv-v1', toolStatus: 'complete', outputStatus: 'complete',
    textCompleteness: 'unverified', issues: [], items: [{ text: 'test_only control passage', label: 'line',
      method: 'ocr:tesseract-cli-sparse-tsv', sourcePageBoxes: [{ pageNumber: page,
        frame: 'pdf_display_page_top_left_points', box: [10, 20, 80, 40],
        derivedFrom: 'tesseract_tsv_pixels_via_mupdf_pixel_origin' }] }] };
}

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
      ocr: async input => ocrPage(input, 3),
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

/** A literal test_only PDF, not a record or a claimed scan transcription. */
function twelvePagePdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count 12 /Kids [${Array.from({ length: 12 }, (_, at) => `${at + 3} 0 R`).join(' ')}] >>`,
    ...Array.from({ length: 12 }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>')];
  let text = '%PDF-1.4\n% test_only twelve-page control\n';
  const offsets = [0];
  objects.forEach((object, at) => {
    offsets.push(Buffer.byteLength(text));
    text += `${at + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(`${text}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

test('a literal 12-page test_only PDF queues one selected OCR page with unchanged source pins and frame', async () => {
  await isolated(async control => {
    const original = twelvePagePdf();
    const source = control.retainPdf(original);
    const nativeJob = (await queueIntakeDraftTx(clientOf(control), source, card))!;
    const reply = { parts: [], warnings: Array.from({ length: 12 }, (_, at) => noText(at + 1)) };
    await readWith(control, nativeJob, reply);
    const service = new DocumentIngestionService();
    const request = { requestKey: randomUUID(), expectedCaseRevision: control.current.revision,
      expectedSourceRevision: 1, sourceSha256: source.sha256, mode: 'native_only',
      ocrSelection: { page: 11, singlePage: true } };
    await assert.rejects(service.retry(control.current.id, source.id, { ...request, ocrSelection: { page: 0 } }));
    const queued = await service.retry(control.current.id, source.id, request);
    assert.deepEqual(control.jobs.get(queued.jobId)!.payload.ocrSelection, { page: 11, singlePage: true });
    const pages: number[] = [];
    await runDocumentJob(queued.jobId, {
      extract: async () => { throw new Error('A selected-page OCR job must not read native text on other pages.'); },
      ocr: async (input, bytes) => {
        pages.push(input.ocrSelection!.page);
        assert.deepEqual(bytes, original);
        return ocrPage(input, 11);
      },
    });
    const result = await service.status(control.current.id, source.id, queued.jobId);
    assert.equal(result.status, 'completed');
    assert.deepEqual(pages, [11]);
    assert.equal(result.ocr?.sourceSha256, sha256(original));
    assert.equal(result.ocr?.sourceRevision, 1);
    assert.equal(result.ocrItems?.[0].sourcePageBoxes[0].pageNumber, 11);
    assert.deepEqual(result.ocr?.sourcePageFrame,
      { kind: 'pdf_display_page_top_left_points', rotation: 0, width: 612, height: 792 });
    assert.deepEqual(control.objects.get(source.object_key), original);
    assert.equal(result.native?.code, 'NATIVE_TEXT_NOT_REQUESTED');
    assert.equal(control.jobs.size, 2);
    assert.equal(control.item!.records_seen, 0);
  });
});

test('only native no-text PDF warnings identify scanned pages, sorted and without duplicates', () => {
  const native = { format: 'pdf', status: 'extracted', warnings: [noText(9), noText(3), noText(3), 'other'] };
  assert.deepEqual(documentScannedPages(native), [3, 9]);
  assert.deepEqual(documentScannedPages({ ...native, warnings: [] }), []);
  assert.deepEqual(documentScannedPages({ ...native, status: 'encrypted' }), []);
  assert.deepEqual(documentScannedPages({ ...native, format: 'text' }), []);
});

// test_only OOXML, as in services/geo/tests/test_area.py: no external document or package is acquired.
const docxCard = { format: 'docx', family: 'document' } as IntakeCard;
const docxReply: Reply = { parts: [
  { text: 'Control letter', locator: { paragraph: 1, label: 'DOCX paragraph 1' } },
  { text: 'Control two floors', locator: { paragraph: 2, label: 'DOCX paragraph 2' } },
  { text: 'Control closing', locator: { paragraph: 3, label: 'DOCX paragraph 3' } },
  { text: 'Control cell', locator: { table: 1, row: 1, column: 1, label: 'DOCX table 1, row 1, column 1' } },
], warnings: ['DOCX extraction covers native body paragraphs and direct table cells; drawings, headers, '
  + 'footnotes, nested tables, tracked deletions and text boxes require separate review.'] };
function docxBytes() {
  const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const body = docxReply.parts.slice(0, 3).map(part => paragraph(part.text)).join('')
    + `<w:tbl><w:tr><w:tc>${paragraph(docxReply.parts[3].text)}</w:tc></w:tr></w:tbl>`;
  return Buffer.from(zipSync({ 'word/document.xml': Buffer.from('<w:document '
    + `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}`
    + '</w:body></w:document>') }));
}
async function queueDocx(control: BatchControl, declaredBytes?: number) {
  const source = control.retainPdf(docxBytes(), declaredBytes, 'docx');
  const jobId = await queueIntakeDraftTx(clientOf(control), source, docxCard);
  return { source, jobId };
}
function noDocxPages(control: BatchControl) {
  assert.doesNotMatch(control.item!.limit_reason, /\bpages?\b|\bOCR\b/i);
  assert.equal(control.item!.records_seen, 0);
}

test('a batch DOCX queues its own format and settles cited paragraphs and table cells, never values', async () => {
  await isolated(async control => {
    const { source, jobId } = await queueDocx(control);
    assert.ok(jobId);
    const original = control.objects.get(source.object_key)!;
    const receipt = control.sources.get(source.id)!.inspection.documentOriginal;
    assert.deepEqual([receipt.format, receipt.sha256, receipt.bytes], ['docx', source.sha256, source.bytes]);
    assert.equal(control.jobs.get(jobId)!.payload.mode, 'native_only');
    assert.match(control.item!.limit_reason, /Reading the paragraphs and table cells of this Word document/);
    noDocxPages(control);
    control.item!.state = 'probed';
    assert.equal(await queueIntakeDraftTx(clientOf(control), source, docxCard), jobId);
    await runDocumentJob(jobId, { extract: (input, bytes) => extractSourceDocument(input, bytes, async data => {
      assert.equal((data as { format: string }).format, 'archive', 'The native reader checks the OOXML container.');
      assert.deepEqual(Buffer.from(bytes), original);
      return { format: 'docx', status: 'ready', sourceSha256: input.sourceSha256, ...docxReply };
    }) });
    assert.equal(control.jobs.get(jobId)!.status, 'succeeded');
    assert.deepEqual([control.item!.state, control.item!.placement], ['read', 'undecided']);
    assert.match(control.item!.limit_reason, /^3 paragraphs and 1 table cell read\./);
    assert.match(control.item!.limit_reason,
      /paragraph 2 name floors.*candidates cited to their paragraph or table cell/);
    assert.match(control.item!.limit_reason, /Drawings, headers, footnotes.*need separate review/);
    assert.match(control.item!.limit_reason, /Nothing is recorded until you confirm it\.$/);
    noDocxPages(control);
    assert.equal(control.jobs.size, 1);
    assert.equal(control.sources.get(source.id)!.sha256, sha256(original));
    assert.deepEqual(control.objects.get(source.object_key), original);
  });
});

test('DOCX continuations count once and room passages cite their table cell', async () => {
  await isolated(async control => {
    const { source, jobId } = await queueDocx(control);
    const parts = docxReply.parts.map(part => ({ ...part, text: `${part.text} ${'control '.repeat(800)}` }));
    parts[3].text += ' room';
    await runDocumentJob(jobId!, { extract: (input, bytes) => extractSourceDocument(input, bytes,
      async () => ({ format: 'docx', sourceSha256: input.sourceSha256, parts, warnings: docxReply.warnings })) });
    assert.match(control.item!.limit_reason, /^3 paragraphs and 1 table cell read\./);
    assert.match(control.item!.limit_reason, /paragraph 2, table 1, row 1, column 1 name floors/);
    noDocxPages(control);
    control.item!.state = 'probed';
    await queueIntakeDraftTx(clientOf(control), source, docxCard);
    assert.match(control.item!.limit_reason, /Read earlier.*Word document.*paragraphs and table cells/);
    assert.equal(control.jobs.size, 1);
    noDocxPages(control);
  });
});

test('a large, stopped or stale batch DOCX keeps its original and uses Word document words', async () => {
  await isolated(async control => {
    assert.equal((await queueDocx(control, DOCUMENT_LIMITS.originalBytes + 1)).jobId, null);
    assert.match(control.item!.limit_reason, /^Kept as a Word document.*at most 16 MB.*not read/);
    assert.equal(control.jobs.size, 0);
    const { source, jobId } = await queueDocx(control);
    await failDocumentJob(jobId!, 'DOCUMENT_WORKER_FAILED');
    assert.equal(control.item!.state, 'failed_part');
    assert.match(control.item!.limit_reason, /Word document reader stopped.*original is kept unchanged/);
    noDocxPages(control);
    await stopBatchPdfTx(clientOf(control), control.current.id, source.id, true);
    assert.match(control.item!.limit_reason, /Word document or its batch changed.*nothing was kept from that read/);
    noDocxPages(control);
  });
});

test('an unsupported DOCX or a container read as something else settles plainly with its original kept', async () => {
  for (const format of ['unsupported', 'xlsx', 'missing Word part', 'byte limit'] as const) {
    await isolated(async control => {
      const bytes = format === 'byte limit'
        ? Buffer.concat([docxBytes(), Buffer.alloc(DOCUMENT_LIMITS.nativeBytes)]) : docxBytes();
      const source = control.retainPdf(bytes, bytes.length, 'docx');
      const jobId = await queueIntakeDraftTx(clientOf(control), source, docxCard);
      await runDocumentJob(jobId!, { extract: (input, original) => extractSourceDocument(input, original, async () => {
        if (format === 'missing Word part') throw new Error('no Word document part');
        const parts = format === 'xlsx' ? [{ text: 'Control workbook cell', locator: { label: 'Control!A1',
          row: 1, column: 1, sheet: 'Control', sheetIndex: 1, sheetId: 1, cell: 'A1', cellState: 'literal' } }] : [];
        return { format: format === 'xlsx' ? 'xlsx' : 'docx',
          status: format === 'unsupported' ? 'unsupported' : 'ready',
          sourceSha256: input.sourceSha256, parts, warnings: [] };
      }) });
      if (format === 'xlsx') assert.equal(control.sources.get(source.id)!.inspection.documentAccepted.nativeStatus,
        'extracted', 'Even successfully extracted text of another kind is not a DOCX reading.');
      assert.equal(control.item!.placement, 'not_understood');
      assert.match(control.item!.limit_reason, /(?:could not take this file as a Word document|at most 10 MB)/);
      assert.match(control.item!.limit_reason, /original is kept with its SHA-256/);
      noDocxPages(control);
      assert.equal(control.sources.get(source.id)!.sha256, source.sha256);
    });
  }
});

test('a 59 MB stated PDF queues without reading its text layer or whole original', async () => {
  await isolated(async control => {
    const source = control.retainPdf(pdfBytes('large declared scan'), 59_335_907);
    const jobId = (await queueIntakeDraftTx(clientOf(control), source, card))!;
    assert.ok(jobId);
    assert.match(control.item!.limit_reason, /text layer is not read above 10 MiB/);
    assert.match(control.item!.limit_reason, /Open its pages to view them or read one page by OCR/);
    const noRead = async (): Promise<never> => assert.fail('Whole-original memory read above nativeBytes.');
    await runDocumentJob(jobId, { read: noRead, extract: noRead });
    assert.equal(control.jobs.get(jobId)!.status, 'succeeded');
    assert.equal(control.sources.get(source.id)!.inspection.documentAccepted.nativeStatus, 'tool_error');
    const service = new DocumentIngestionService();
    const queued = await service.retry(control.current.id, source.id, { requestKey: randomUUID(),
      expectedCaseRevision: control.current.revision, expectedSourceRevision: 1, sourceSha256: source.sha256,
      mode: 'native_only', ocrSelection: { page: 1, singlePage: true } });
    let selections = 0;
    await runDocumentJob(queued.jobId, { read: noRead, extract: noRead, ocr: async (input, original) => {
      selections++; assert.equal(original, undefined);
      return ocrPage(input, 1);
    } });
    assert.equal(selections, 1);
    assert.equal(control.jobs.get(queued.jobId)!.status, 'succeeded');
    assert.equal(control.item!.records_seen, 0);
    const exactBound = control.retainPdf(pdfBytes('stated exact page bound'), 1024 ** 3);
    assert.ok(await queueIntakeDraftTx(clientOf(control), exactBound, card));
  });
});

test('streamed originals verify exact bytes and hash and remove only their own failed file', async () => {
  await isolated(async control => {
    const original = pdfBytes('streamed byte control'), source = control.retainPdf(original);
    const dir = await mkdtemp(join(tmpdir(), 's5-9a-stream-'));
    const path = join(dir, 'original.pdf');
    const copy = (bytes = original.length, hash = source.sha256) =>
      streamRetainedOriginal(source.object_key, bytes, hash, path, DOCUMENT_LIMITS.originalBytes);
    try {
      await copy(); assert.deepEqual(await readFile(path), original);
      await assert.rejects(copy(), { code: 'EEXIST' });
      assert.deepEqual(await readFile(path), original);
      await rm(path);
      await assert.rejects(copy(original.length, '0'.repeat(64)), { code: 'INTAKE_SOURCE_INTEGRITY' });
      await assert.rejects(access(path), { code: 'ENOENT' });
      for (const count of [original.length - 1, original.length + 1]) {
        S3Client.prototype.send = async () => ({ Body: Readable.from([original.subarray(0, 5),
          original.subarray(5)]), ContentLength: count, ETag: 'control' });
        await assert.rejects(copy(count), { code: 'INTAKE_SOURCE_INTEGRITY' });
        await assert.rejects(access(path), { code: 'ENOENT' });
      }
      await writeFile(path, original);
      await assert.rejects(copy(), { code: 'EEXIST' });
      assert.deepEqual(await readFile(path), original);
    } finally { await rm(path, { force: true }); await rmdir(dir); }
  });
});

test('page numbers read as runs', () => {
  assert.equal(pageWords([3]), 'page 3');
  assert.equal(pageWords([1, 2]), 'pages 1–2');
  assert.equal(pageWords([1, 3, 5, 6]), 'pages 1, 3 and 5–6');
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import real from '../../../../../docs/evidence/gf1/g10/result.json';
import { createContractValidator } from '../../local/contract';
import { readFileSync } from 'node:fs';
import { BatchPdfSection } from './BatchPdfSection';
import { createPdfOcrPress, createPdfOcrRun, docxReadingWords, pagesToRead, pdfNoReadingWords, pdfOcrOffer, readPdfJob,
  type OcrPageRun, type PdfReading } from './pdf-reading';
import { button, container, elements, propsOf, type FakeElement } from './fake-dom';
import { sizeWords } from './upload-model';
import type { IntakeItem } from './batch-model';
import { DOCUMENT_LIMITS } from '@ulpin/contracts/upload-reader-limits';

const openapi = JSON.parse(readFileSync(new URL('../../../../../docs/api/openapi.json', import.meta.url), 'utf8'));
const validate = createContractValidator(openapi);
const route = openapi.paths['/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/documents/retry'].post;
const requestSchema = route.requestBody.content['application/json'].schema.$ref.split('/').at(-1);
const statusRoute = openapi.paths['/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/documents/jobs/{jobId}'].get;
const statusSchema = statusRoute.responses['200'].content['application/json'].schema.$ref.split('/').at(-1);
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const caseId = id(1), sourceId = id(2), nativeJobId = id(3);
const ocrJob = (page: number) => id(10 + page);
const ocrLabel = 'Read the selected pages (OCR)';
const sha = 'a'.repeat(64);
const noText = (page: number) => `PDF page ${page} has no native text; image interpretation/OCR remains unresolved.`;
// Page coverage is the retained real-input reading; ids and OCR text below are test_only protocol controls.
const item = { ...captured.manifest.items[0], caseId, itemId: sourceId, sourceId, name: 'scanned-plan.pdf',
  format: 'pdf', family: 'document', state: 'read', plan: null } as unknown as IntakeItem;
const magnolia = real.real_inputs.good.no_text_pages;

function reading(scanned: number[] = real.real_inputs.difficult.no_text_pages): PdfReading {
  return { version: 'source-document/1', caseId, sourceId, jobId: nativeJobId, status: 'completed',
    currentCaseRevision: 7, sourceRevision: 1, sourceSha256: sha, resultSha256: 'b'.repeat(64),
    native: { status: 'needs_ocr', format: 'pdf', readerSha256: 'c'.repeat(64), code: null,
      warnings: scanned.map(noText) }, model: null, parts: [], page: 0, hasMore: false,
    ocr: null, ocrItems: [], ocrPage: 0, ocrHasMore: false, code: null };
}

/** A PDF above the page reader's byte bound: its text layer was never read. */
function unreadTextLayer(): PdfReading {
  const value = reading([]);
  return { ...value, native: { ...value.native!, status: 'tool_error', code: 'NATIVE_READER_BYTE_LIMIT' } };
}

function completedOcr(page: number, outputStatus: 'complete' | 'failed' = 'complete'): PdfReading {
  const failed = outputStatus === 'failed';
  const native = reading(magnolia).native!;
  if (page > 8) Object.assign(native, { code: 'NATIVE_TEXT_NOT_REQUESTED', status: 'needs_ocr', warnings: [] });
  return { ...reading(magnolia), native, jobId: ocrJob(page), ocr: {
    sourceSha256: sha, sourceRevision: 1, sourcePage: page, requestedRegion: null,
    sourcePageFrame: { kind: 'pdf_display_page_top_left_points', rotation: 0,
      width: 612, height: 792 }, method: 'ocr:tesseract-cli-5.5.1:sparse-tsv-v1', toolStatus: 'complete',
    outputStatus, textCompleteness: 'unverified', issues: failed ? ['OCR_RUNTIME_UNAVAILABLE'] : [] },
  ocrItems: failed ? [] : [{
    text: `test_only control passage ${page}`, label: 'line', method: 'ocr:tesseract-cli-sparse-tsv',
    sourcePageBoxes: [{ pageNumber: page, frame: 'pdf_display_page_top_left_points', box: [10, 20, 80, 40],
      derivedFrom: 'tesseract_tsv_pixels_via_mupdf_pixel_origin' }],
  }] };
}

const run = (value: PdfReading): OcrPageRun => ({ page: value.ocr!.sourcePage, reading: value,
  passages: value.ocrItems ?? [] });
const job = (jobId: string, at: number) => ({ id: jobId, sourceId, operation: 'document-extraction',
  status: 'succeeded', createdAt: `2026-10-22T00:00:0${at}Z` });
const receipt = (jobId: string) => ({ version: 'source-document/1', caseId, sourceId, jobId, caseRevision: 7,
  sourceRevision: 1, sourceSha256: sha, bytes: 100 });
const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 10)));
const press = (node: FakeElement) => act(async () => { await propsOf(node).onClick?.({}); });
const action = (root: FakeElement) => elements(root)
  .find(node => node.tagName === 'BUTTON' && node.textContent === ocrLabel);
const boxes = (root: FakeElement) => elements(root).filter(node => node.tagName === 'INPUT');
const pick = (node: FakeElement, checked: boolean) => act(async () => {
  propsOf(node).onChange?.({ target: { checked } });
});

interface Seed { pageCount?: number; runs?: OcrPageRun[]; jobs?: ReturnType<typeof job>[]; file?: IntakeItem }

async function render(value: PdfReading, seed: Seed = {}, staleListing = false) {
  const jobs = seed.jobs ?? [job(value.jobId, 0)];
  const detail = { case: { id: caseId, revision: 7, archived: false }, jobs };
  const previousFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (request: Request) => request.method === 'GET'
    && new URL(request.url).pathname === `/api/v1/cases/${caseId}`
    ? Promise.resolve(Response.json(detail)) : previousFetch(request));
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['source-case', caseId], staleListing ? { ...detail, jobs: [] } : detail);
  if (jobs.length) client.setQueryData(['intake', caseId, 'pdf', sourceId, jobs.at(-1)!.id],
    { status: value, passages: value.ocrItems ?? [] });
  if (seed.pageCount !== undefined) client.setQueryData(['intake', caseId, 'pdf-pages', sourceId, sha], seed.pageCount);
  client.setQueryData(['intake', caseId, 'pdf-ocr', sourceId, [...jobs].reverse().map(entry => entry.id).join(',')],
    seed.runs ?? []);
  const root = container();
  const view = createRoot(root as never);
  await act(async () => view.render(<QueryClientProvider client={client}>
    <BatchPdfSection caseId={caseId} item={seed.file ?? item} />
  </QueryClientProvider>));
  return { root, client, unmount: () => act(async () => { view.unmount(); client.clear(); }) };
}

afterEach(() => { vi.unstubAllGlobals(); });

/** A document runtime whose OCR jobs end at once; each job reads the page it was asked for. */
function stubOcrServer(pageCount: number, failing: number[] = []) {
  const bodies: { ocrSelection?: { page: number } }[] = [];
  const jobs = [job(nativeJobId, 0)];
  vi.stubGlobal('fetch', async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (request.method === 'POST') {
      const body = await request.json();
      bodies.push(body);
      jobs.push(job(ocrJob(body.ocrSelection.page), jobs.length));
      return Response.json(receipt(ocrJob(body.ocrSelection.page)), { status: 201 });
    }
    if (path.endsWith('/pages')) return Response.json({ pageCount,
      pages: [{ page: Number(new URL(request.url).searchParams.get('offset') ?? 0) + 1 }] });
    const page = [...Array(pageCount + 1).keys()].find(at => path.endsWith(`/jobs/${ocrJob(at)}`));
    if (page !== undefined && failing.includes(page)) {
      return Response.json({ ...reading(magnolia), jobId: ocrJob(page), status: 'failed', code: 'DOCUMENT_DEADLINE' });
    }
    if (page !== undefined) return Response.json(completedOcr(page));
    if (path.includes('/jobs/')) return Response.json(reading(magnolia));
    return Response.json({ case: { id: caseId, revision: 7, archived: false }, jobs });
  });
  return bodies;
}

it('reads the pages the officer picks, one job each, says per page whether it read, and reads a page once',
  async () => {
    const page = await render(reading(magnolia), { pageCount: 6 });
    const bodies = stubOcrServer(6);
    try {
      expect(validate(statusSchema, reading(magnolia))).toEqual([]);
      expect(boxes(page.root)).toHaveLength(magnolia.length);
      expect(page.root.textContent).toContain('Page 3: not read.');
      expect(page.root.textContent).toContain('4 pages will be read.');
      await pick(boxes(page.root).at(-1)!, false);
      expect(page.root.textContent).toContain('3 pages will be read.');
      await press(action(page.root)!);
      for (let at = 0; at < 10; at++) await flush();
      expect(bodies.map(body => body.ocrSelection?.page)).toEqual([3, 4, 5]);
      bodies.forEach(body => expect(validate(requestSchema, body)).toEqual([]));
      expect(bodies[0]).toMatchObject({ mode: 'native_only', expectedCaseRevision: 7, expectedSourceRevision: 1,
        sourceSha256: sha });
      expect(validate(statusSchema, completedOcr(3))).toEqual([]);
      expect(page.root.textContent).toContain('Page 3: read; 1 candidate passage, completeness unverified.');
      expect(page.root.textContent).toContain('Page 6: not read.');
      expect(page.root.textContent).toContain('test_only control passage 5');
      expect(page.root.textContent).toContain('Page 5 · region [10.00, 20.00, 80.00, 40.00] pt');
      expect(page.root.textContent).not.toContain('No rooms, levels or units are created');
      expect(page.root.textContent).toContain('Every selected page is read already.');
      expect(propsOf(action(page.root)!).disabled).toBe(true);
    } finally { await page.unmount(); }
  });

// test_only protocol passages and locators from tests/intake-pdf-batch.test.ts (S5.10).
function docxReading(): PdfReading {
  const parts = [
    { text: 'Control letter', locator: { paragraph: 1, label: 'DOCX paragraph 1' } },
    { text: 'Control two floors', locator: { paragraph: 2, label: 'DOCX paragraph 2' } },
    { text: 'Control closing', locator: { paragraph: 3, label: 'DOCX paragraph 3' } },
    { text: 'Control cell', locator: { table: 1, row: 1, column: 1, label: 'DOCX table 1, row 1, column 1' } },
  ].map((part, at) => ({ ...part, id: id(100 + at), sourceId, sourceRevision: 1, sourceSha256: sha,
    sha256: sha, method: 'native_text' as const,
    locator: { ...part.locator, characterStart: 0, characterEnd: part.text.length } }));
  return { ...reading([]), native: { ...reading([]).native!, format: 'docx', status: 'extracted' }, parts };
}

it('a batch DOCX lists its passages with paragraph and cell citations, counts units once, and has no PDF controls',
  async () => {
    const value = docxReading();
    value.parts.push({ ...value.parts[1]!, id: id(104) });
    expect(validate(statusSchema, value)).toEqual([]);
    const requests = vi.fn();
    vi.stubGlobal('fetch', requests);
    const page = await render(value, { file: { ...item, format: 'docx', name: 'control.docx' } });
    try {
      await flush();
      expect(page.root.textContent).toContain('3 paragraphs and 1 table cell read.');
      const passages = elements(page.root).filter(node => node.tagName === 'LI');
      expect(passages).toHaveLength(5);
      expect(passages[1]!.textContent).toBe('Control two floorsDOCX paragraph 2');
      expect(passages[3]!.textContent).toBe('Control cellDOCX table 1, row 1, column 1');
      expect(page.root.textContent).not.toMatch(/\bPDF\b|\bpages?\b|\bOCR\b/);
      expect(elements(page.root).filter(node => ['BUTTON', 'INPUT', 'CANVAS'].includes(node.tagName))).toEqual([]);
      expect(requests).not.toHaveBeenCalled();
    } finally { await page.unmount(); }
  });

it('reads DOCX native parts beyond the first 25 and refuses a changed result between reads', async () => {
  const value = docxReading();
  const first = Array.from({ length: 25 }, (_, at) => ({ ...value.parts[at % 3]!, id: id(200 + at) }));
  const requests: number[] = [];
  let changed = false;
  vi.stubGlobal('fetch', async (request: Request) => {
    const page = Number(new URL(request.url).searchParams.get('page') ?? 0);
    requests.push(page);
    return Response.json({ ...value, page, hasMore: page === 0, parts: page === 0 ? first : [value.parts[3]],
      resultSha256: changed && page === 1 ? 'd'.repeat(64) : value.resultSha256 });
  });
  const result = await readPdfJob(caseId, sourceId, nativeJobId);
  expect(requests).toEqual([0, 1]);
  expect(result.status.parts).toHaveLength(26);
  expect(docxReadingWords(result.status)).toBe('3 paragraphs and 1 table cell read.');
  expect(result.status.parts.at(-1)!.locator.label).toBe('DOCX table 1, row 1, column 1');
  changed = true;
  await expect(readPdfJob(caseId, sourceId, nativeJobId)).rejects.toThrow('The document reading changed');
});

it('does not mount a DOCX reading without a retained source', async () => {
  const page = await render(docxReading(), { file: { ...item, format: 'docx', sourceId: null } });
  try { expect(page.root.textContent).toBe(''); }
  finally { await page.unmount(); }
});

it('a press stops at a page whose job fails; later pages are not requested and earlier ones stay read',
  async () => {
    const bodies = stubOcrServer(6, [4]);
    const send = createPdfOcrRun(caseId, sourceId, async () => undefined);
    const seen: string[] = [];
    await expect(send(reading(magnolia), [3, 4, 5], new AbortController().signal,
      progress => seen.push(`${progress.page}:${progress.status}`)))
      .rejects.toThrow('OCR stopped on page 4 (DOCUMENT_DEADLINE); the pages after it were not requested.');
    expect(bodies.map(body => body.ocrSelection?.page)).toEqual([3, 4]);
    expect(seen).toEqual(['3:completed', '4:failed']);
  });

it('the same selection twice reads once', () => {
  const runs = [run(completedOcr(3)), run(completedOcr(4, 'failed'))];
  expect(pagesToRead([5, 3, 4, 5], runs)).toEqual([4, 5]);
  expect(pagesToRead([3], runs)).toEqual([]);
});

it('a PDF above the page reader byte bound offers every page to OCR, within the OCR page bound', async () => {
  const unread = unreadTextLayer();
  expect(validate(statusSchema, unread)).toEqual([]);
  expect(pdfOcrOffer(unread, 3)).toEqual({ pages: [1, 2, 3], refusal: '' });
  const page = await render(unread, { pageCount: 3 });
  try {
    expect(page.root.textContent).toContain('The text layer was not read: the PDF is above 10 MiB.');
    expect(page.root.textContent).not.toContain('1024 MiB');
    expect(boxes(page.root)).toHaveLength(3);
    expect(action(page.root)).toBeDefined();
  } finally { await page.unmount(); }
  const long = await render(unread, { pageCount: 12 });
  try {
    expect(long.root.textContent).toContain('Page number, 1 to 12');
    expect(long.root.textContent).not.toContain('1024 MiB');
    expect(boxes(long.root)).toHaveLength(1);
    expect(propsOf(action(long.root)!).disabled).toBe(true);
  } finally { await long.unmount(); }
});

it('offers one selected page of a long scan and refuses beyond the renderer page bound in words', async () => {
  expect(pdfOcrOffer(reading([9, 10]), 10)).toMatchObject({ pages: [9, 10], singlePage: true, refusal: '' });
  expect(pdfOcrOffer(unreadTextLayer(), 401).refusal).toContain('at most 400 pages');
  expect(pdfOcrOffer(reading([]), 4)).toEqual({ pages: [], refusal: '' });
  const textOnly = await render(reading([]), { pageCount: 4 });
  expect(action(textOnly.root)).toBeUndefined();
  await textOnly.unmount();
});

it('says a PDF above the document runtime byte bound is kept and not read, never that a reading is coming',
  async () => {
    // test_only stated size: one byte above the document original bound.
    const page = await render(reading(), { jobs: [], file: { ...item,
      sizeBytes: DOCUMENT_LIMITS.originalBytes + 1 } });
    try {
      expect(page.root.textContent).toContain('This PDF is 1,07,37,41,825 bytes, above the 1 GiB limit, so it is '
        + 'not read.');
      expect(page.root.textContent).not.toContain('1024 MiB');
      expect(page.root.textContent).not.toContain('yet');
      expect(action(page.root)).toBeUndefined();
    } finally { await page.unmount(); }
    // test_only stated size: one and a half times the bound, stated in GiB.
    expect(pdfNoReadingWords(DOCUMENT_LIMITS.originalBytes * 1.5)).toContain('This PDF is 1.5 GiB, above the 1 GiB');
    expect(sizeWords(DOCUMENT_LIMITS.originalBytes)).toBe('1 GiB');
    expect(sizeWords(Math.round(17.3 * 1024 ** 2))).toBe('17.3 MiB');
  });

it('refreshes a cached case listing that predates the batch PDF job', async () => {
  const page = await render(reading(), { pageCount: 1 }, true);
  try {
    await flush();
    expect(action(page.root)).toBeDefined();
    expect(page.root.textContent).not.toContain('No document reading is available');
  } finally { await page.unmount(); }
});

it('refuses visibly when the private document runtime is missing, without offering or enqueueing', async () => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    calls.push(request.method);
    return Response.json({ error: { code: 'DOCUMENT_PAGES_RUNTIME_UNAVAILABLE',
      message: 'Configure the private local PDF runtime and scratch directory.' } }, { status: 503 });
  });
  const page = await render(reading());
  try {
    await flush();
    expect(calls).not.toContain('POST');
    expect(page.root.textContent).toContain('DOCUMENT_PAGES_RUNTIME_UNAVAILABLE');
    expect(page.root.textContent).toContain('Configure the private local PDF runtime and scratch directory.');
    expect(action(page.root)).toBeUndefined();
  } finally { await page.unmount(); }
});

it('shows a page OCR did not read rather than claiming an empty successful reading', async () => {
  const unavailable = completedOcr(1, 'failed');
  expect(validate(statusSchema, unavailable)).toEqual([]);
  const page = await render(reading(), { pageCount: 1, runs: [run(unavailable)] });
  try {
    expect(page.root.textContent).toContain('Page 1: OCR did not read it. OCR_RUNTIME_UNAVAILABLE');
    expect(page.root.textContent).toContain('Configure the document OCR runtime or resolve the stated limit, then '
      + 'retry.');
    expect(page.root.textContent).not.toContain('candidate passage with');
    expect(page.root.textContent).toContain('1 page will be read.');
  } finally { await page.unmount(); }
});

it('reads all three bounded OCR status pages so passages beyond the first 25 are not lost', async () => {
  const done = completedOcr(1);
  const requests: number[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    const page = Number(new URL(request.url).searchParams.get('ocrPage') ?? 0);
    requests.push(page);
    return Response.json({ ...done, ocrPage: page, ocrHasMore: page < 2,
      ocrItems: Array.from({ length: page < 2 ? 25 : 14 }, () => done.ocrItems![0]) });
  });
  const result = await readPdfJob(caseId, sourceId, ocrJob(1));
  expect(requests).toEqual([0, 1, 2]);
  expect(result.passages).toHaveLength(64);
});

it('queues only the chosen page of a 12-page scan with the original pins', async () => {
  const page = await render(reading(Array.from({ length: 12 }, (_, at) => at + 1)), { pageCount: 12 });
  const bodies = stubOcrServer(12);
  try {
    for (const value of ['0', '13']) {
      await act(async () => propsOf(boxes(page.root)[0]!).onChange?.({ target: { value } }));
      expect(propsOf(action(page.root)!).disabled).toBe(true);
      expect(propsOf(boxes(page.root)[0]!)['aria-invalid']).toBe(true);
    }
    await act(async () => propsOf(boxes(page.root)[0]!).onChange?.({ target: { value: '11' } }));
    await press(action(page.root)!);
    for (let at = 0; at < 10; at++) await flush();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ expectedSourceRevision: 1, sourceSha256: sha,
      ocrSelection: { page: 11, singlePage: true }, mode: 'native_only' });
    expect(validate(requestSchema, bodies[0])).toEqual([]);
    expect(page.root.textContent).toContain('Page 11 · region [10.00, 20.00, 80.00, 40.00] pt');
    expect(page.root.textContent).toContain('Page 11: read; 1 candidate passage');
    expect(page.root.textContent).toContain('The text layer was not read.');
    expect(validate(statusSchema, completedOcr(11))).toEqual([]);
  } finally { await page.unmount(); }
});

it('refuses page zero or past the actual end before enqueueing', async () => {
  const bodies = stubOcrServer(12);
  const send = createPdfOcrPress(caseId, sourceId);
  for (const page of [0, 13]) await expect(send(unreadTextLayer(), { page })).rejects.toThrow('page');
  expect(bodies).toEqual([]);
});

it('keeps the same request key after a lost enqueue response', async () => {
  const keys: string[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    if (request.method === 'GET') return Response.json({ case: { revision: 7, archived: false },
      pageCount: 1, pages: [{ page: 1 }] });
    keys.push((await request.json()).requestKey);
    if (keys.length === 1) throw new TypeError('Response lost');
    return Response.json(receipt(ocrJob(1)), { status: 201 });
  });
  const send = createPdfOcrPress(caseId, sourceId);
  await expect(send(reading(), { page: 1 })).rejects.toThrow('Response lost');
  await send(reading(), { page: 1 });
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

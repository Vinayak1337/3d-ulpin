import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import real from '../../../../../docs/evidence/gf1/g10/result.json';
import { createContractValidator } from '../../local/contract';
import { readFileSync } from 'node:fs';
import { BatchPdfSection } from './BatchPdfSection';
import { createPdfOcrPress, pdfOcrChoice, readPdfJob, type PdfReading } from './pdf-reading';
import { button, container, elements, propsOf, type FakeElement } from './fake-dom';
import type { IntakeItem } from './batch-model';

const openapi = JSON.parse(readFileSync(new URL('../../../../../docs/api/openapi.json', import.meta.url), 'utf8'));
const validate = createContractValidator(openapi);
const route = openapi.paths['/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/documents/retry'].post;
const requestSchema = route.requestBody.content['application/json'].schema.$ref.split('/').at(-1);
const statusRoute = openapi.paths['/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/documents/jobs/{jobId}'].get;
const statusSchema = statusRoute.responses['200'].content['application/json'].schema.$ref.split('/').at(-1);
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const caseId = id(1), sourceId = id(2), nativeJobId = id(3), ocrJobId = id(4);
const ocrLabel = 'Read the words on the scanned pages (OCR)';
const noText = (page: number) => `PDF page ${page} has no native text; image interpretation/OCR remains unresolved.`;
// Page coverage is the retained real-input reading; ids and OCR text below are test_only protocol controls.
const item = { ...captured.manifest.items[0], caseId, itemId: sourceId, sourceId, name: 'scanned-plan.pdf',
  format: 'pdf', family: 'document', state: 'read', plan: null } as unknown as IntakeItem;

function reading(scanned: number[] = real.real_inputs.difficult.no_text_pages): PdfReading {
  return { version: 'source-document/1', caseId, sourceId, jobId: nativeJobId, status: 'completed',
    currentCaseRevision: 7, sourceRevision: 1, sourceSha256: 'a'.repeat(64), resultSha256: 'b'.repeat(64),
    native: { status: 'needs_ocr', format: 'pdf', readerSha256: 'c'.repeat(64), code: null,
      warnings: scanned.map(noText) }, model: null, parts: [], page: 0, hasMore: false,
    ocr: null, ocrItems: [], ocrPage: 0, ocrHasMore: false, code: null };
}

function completedOcr(): PdfReading {
  return { ...reading(), jobId: ocrJobId, ocr: { sourceSha256: 'a'.repeat(64), sourceRevision: 1, sourcePage: 1,
    requestedRegion: null, sourcePageFrame: { kind: 'pdf_display_page_top_left_points', rotation: 0,
      width: 612, height: 792 }, method: 'ocr:tesseract-cli-5.5.1:sparse-tsv-v1', toolStatus: 'complete',
    outputStatus: 'complete', textCompleteness: 'unverified', issues: [] }, ocrItems: [{
    text: 'test_only control passage', label: 'line', method: 'ocr:tesseract-cli-sparse-tsv', sourcePageBoxes: [{
      pageNumber: 1, frame: 'pdf_display_page_top_left_points', box: [10, 20, 80, 40],
      derivedFrom: 'tesseract_tsv_pixels_via_mupdf_pixel_origin',
    }],
  }] };
}

const queryKey = (jobId: string) => ['intake', caseId, 'pdf', sourceId, jobId];
const response = (jobId: string) => ({ version: 'source-document/1', caseId, sourceId, jobId, caseRevision: 7,
  sourceRevision: 1, sourceSha256: 'a'.repeat(64), bytes: 100 });
const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 10)));
const press = (node: FakeElement) => act(async () => { await propsOf(node).onClick?.({}); });
const hasAction = (root: FakeElement) => elements(root)
  .some(node => node.tagName === 'BUTTON' && node.textContent === ocrLabel);

async function render(readingValue: PdfReading, value: IntakeItem = item, staleListing = false) {
  const detail = { case: { id: caseId, revision: 7, archived: false }, jobs: [{ id: readingValue.jobId, sourceId,
    operation: 'document-extraction', createdAt: '2026-10-22T00:00:00Z' }] };
  const previousFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (request: Request) => request.method === 'GET'
    && new URL(request.url).pathname === `/api/v1/cases/${caseId}`
    ? Promise.resolve(Response.json(detail)) : previousFetch(request));
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['source-case', caseId], staleListing ? { ...detail, jobs: [] } : detail);
  client.setQueryData(queryKey(readingValue.jobId), { status: readingValue, passages: readingValue.ocrItems ?? [] });
  const root = container();
  const view = createRoot(root as never);
  await act(async () => view.render(<QueryClientProvider client={client}>
    <BatchPdfSection caseId={caseId} item={value} />
  </QueryClientProvider>));
  return { root, client, unmount: () => act(async () => { view.unmount(); client.clear(); }) };
}

afterEach(() => { vi.unstubAllGlobals(); });

function stubOcrServer() {
  const bodies: unknown[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    if (request.method === 'POST') {
      bodies.push(await request.json());
      return Response.json(response(ocrJobId), { status: 201 });
    }
    const path = new URL(request.url).pathname;
    if (path.endsWith('/pages')) return Response.json({ pages: [{ page: 1 }] });
    if (path.endsWith(`/jobs/${ocrJobId}`)) {
      return Response.json({ ...reading(), jobId: ocrJobId, status: 'queued', native: null });
    }
    return Response.json({ case: { id: caseId, revision: 7, archived: false }, jobs: [] });
  });
  return bodies;
}

it('shows the scanned PDF action, sends the bounded selection once, and shows queued and cited result words',
  async () => {
    const bodies = stubOcrServer();
    const page = await render(reading());
    try {
      expect(validate(statusSchema, reading())).toEqual([]);
      expect(page.root.textContent).toContain('Read page 1. This OCR job reads at most 1 scanned page.');
      await press(button(page.root, ocrLabel));
      await flush();
      expect(bodies).toHaveLength(1);
      expect(validate(requestSchema, bodies[0])).toEqual([]);
      expect(bodies[0]).toMatchObject({ mode: 'native_only', ocrSelection: { page: 1 }, expectedCaseRevision: 7,
        expectedSourceRevision: 1, sourceSha256: 'a'.repeat(64) });
      expect(hasAction(page.root)).toBe(false);
      expect(page.root.textContent).toContain('OCR is queued');
      await act(async () => page.client.setQueryData(queryKey(ocrJobId), {
        status: { ...reading(), jobId: ocrJobId, status: 'running', native: null }, passages: [],
      }));
      await flush();
      expect(page.root.textContent).toContain('OCR is reading the scanned page.');
      expect(hasAction(page.root)).toBe(false);
      const done = completedOcr();
      expect(validate(statusSchema, done)).toEqual([]);
      await act(async () => page.client.setQueryData(queryKey(ocrJobId), { status: done, passages: done.ocrItems }));
      await flush();
      expect(page.root.textContent).toContain('OCR read 1 page (page 1); 1 candidate passage found');
      expect(page.root.textContent).toContain('Text completeness is unverified');
      expect(page.root.textContent).toContain('test_only control passage');
      expect(page.root.textContent).toContain('Page 1 · region [10.00, 20.00, 80.00, 40.00] pt');
      expect(page.root.textContent).toContain('No rooms, levels or units are created');
      expect(bodies).toHaveLength(1);
    } finally { await page.unmount(); }
  });

it('refreshes a cached case listing that predates the batch PDF job', async () => {
  const page = await render(reading(), item, true);
  try {
    await flush();
    expect(hasAction(page.root)).toBe(true);
    expect(page.root.textContent).not.toContain('No document reading is available');
  } finally { await page.unmount(); }
});

it('refuses the press visibly when the private document runtime is missing, without enqueueing', async () => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    calls.push(request.method);
    return Response.json({ error: { code: 'DOCUMENT_PAGES_RUNTIME_UNAVAILABLE',
      message: 'Configure the private local PDF runtime and scratch directory.' } }, { status: 503 });
  });
  const page = await render(reading());
  try {
    await press(button(page.root, ocrLabel));
    await flush();
    expect(calls).toEqual(['GET']);
    expect(page.root.textContent).toContain('DOCUMENT_PAGES_RUNTIME_UNAVAILABLE');
    expect(page.root.textContent).toContain('Configure the private local PDF runtime and scratch directory.');
    expect(elements(page.root).some(node => node.getAttribute('role') === 'status'
      && node.textContent.includes('DOCUMENT_PAGES_RUNTIME_UNAVAILABLE'))).toBe(true);
  } finally { await page.unmount(); }
});

it('offers only the first eligible scanned page, discloses the rest, and offers nothing for a text-only PDF',
  async () => {
    const scanned = real.real_inputs.good.no_text_pages;
    expect(pdfOcrChoice(reading(scanned))).toEqual({ scanned, selection: { page: 3 } });
    const page = await render(reading(scanned));
    expect(page.root.textContent).toContain('3 scanned pages are left unread by this request.');
    await page.unmount();
    const textOnly = await render(reading([]));
    expect(hasAction(textOnly.root)).toBe(false);
    await textOnly.unmount();
    const beyond = await render(reading([9, 10]));
    expect(hasAction(beyond.root)).toBe(false);
    expect(beyond.root.textContent).toContain('OCR supports pages 1–8 only.');
    await beyond.unmount();
  });

it('shows an unavailable OCR job result rather than claiming an empty successful reading', async () => {
  const completed = completedOcr();
  const unavailable = { ...completed, ocr: { ...completed.ocr!, toolStatus: 'unavailable' as const,
    outputStatus: 'failed' as const, issues: ['OCR_RUNTIME_UNAVAILABLE'] }, ocrItems: [] };
  expect(validate(statusSchema, unavailable)).toEqual([]);
  const page = await render(unavailable);
  try {
    expect(page.root.textContent).toContain('OCR did not read page 1. OCR_RUNTIME_UNAVAILABLE');
    expect(page.root.textContent).not.toContain('candidate passage found');
    expect(hasAction(page.root)).toBe(true);
  } finally { await page.unmount(); }
});

it('reads all three bounded OCR status pages so passages beyond the first 25 are not lost', async () => {
  const done = completedOcr();
  const requests: number[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    const page = Number(new URL(request.url).searchParams.get('ocrPage') ?? 0);
    requests.push(page);
    return Response.json({ ...done, ocrPage: page, ocrHasMore: page < 2,
      ocrItems: Array.from({ length: page < 2 ? 25 : 14 }, () => done.ocrItems![0]) });
  });
  const result = await readPdfJob(caseId, sourceId, ocrJobId);
  expect(requests).toEqual([0, 1, 2]);
  expect(result.passages).toHaveLength(64);
});

it('keeps the same request key after a lost enqueue response', async () => {
  const keys: string[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    if (request.method === 'GET') return Response.json({ case: { revision: 7, archived: false } });
    keys.push((await request.json()).requestKey);
    if (keys.length === 1) throw new TypeError('Response lost');
    return Response.json(response(ocrJobId), { status: 201 });
  });
  const send = createPdfOcrPress(caseId, sourceId);
  await expect(send(reading(), { page: 1 })).rejects.toThrow('Response lost');
  await send(reading(), { page: 1 });
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

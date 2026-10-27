import { api, ApiError, unwrap, type GetResponse, type paths } from '@ulpin/api-client';
import { DOCUMENT_LIMITS, DOCUMENT_PAGE_LIMITS, documentScannedPages } from '@ulpin/contracts/upload-reader-limits';
import { readBatchCase } from './table/retain';
import { sizeWords } from './upload-model';

export type PdfReading = GetResponse<
  '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/documents/jobs/{jobId}'
>;
type OcrPassage = NonNullable<PdfReading['ocrItems']>[number];
/** One page's newest OCR job and every passage it returned. */
export interface OcrPageRun { page: number; reading: PdfReading; passages: OcrPassage[] }
/** A page this press is waiting on; its result arrives as an `OcrPageRun` when its job ends. */
export interface OcrPageProgress { page: number; status: PdfReading['status'] }
type CaseJob = GetResponse<'/api/v1/cases/{caseId}'>['jobs'][number];
type RetryRoute = paths['/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/documents/retry'];
type RetryBody = RetryRoute['post']['requestBody']['content']['application/json'];

const active = (status: string) => status === 'queued' || status === 'running';

/** This source's document jobs, newest first. */
export function pdfJobs(jobs: readonly CaseJob[], sourceId: string) {
  return jobs.filter(job => job.sourceId === sourceId && job.operation === 'document-extraction')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function latestPdfJob(jobs: readonly CaseJob[], sourceId: string) {
  return pdfJobs(jobs, sourceId)[0] ?? null;
}

/** The server keeps at most `DOCUMENT_LIMITS.jobs` document jobs per source, so a press can ask for no more. */
export function pdfJobsLeft(jobs: readonly CaseJob[], sourceId: string) {
  return Math.max(0, DOCUMENT_LIMITS.jobs - pdfJobs(jobs, sourceId).length);
}

/** The page reader stopped on its own byte bound; the OCR runtime takes the larger original. */
function pdfTextLayerUnread(reading: PdfReading | undefined) {
  return reading?.native?.code === 'NATIVE_READER_BYTE_LIMIT';
}

/** A failed native reader has not identified which pages have text; the private renderer checks the original. */
function pdfPagesUnknown(reading: PdfReading) {
  return reading.native?.format === 'pdf' && (reading.native.status === 'tool_error'
    || reading.native.code === 'NATIVE_TEXT_NOT_REQUESTED');
}

/** Whether the page count must be known before OCR can be offered. */
export function pdfNeedsPageCount(reading: PdfReading | undefined) {
  if (reading?.status !== 'completed' || !reading.native) return false;
  return pdfPagesUnknown(reading) || documentScannedPages(reading.native).length > 0;
}

/** Short PDFs retain the multi-page press; longer originals require one explicit page number per press. */
export function pdfOcrOffer(reading: PdfReading | undefined, pageCount: number | undefined): {
  pages: number[]; refusal: string; singlePage?: boolean;
} {
  if (!reading?.native || pageCount === undefined) return { pages: [], refusal: '' };
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > DOCUMENT_PAGE_LIMITS.pages) {
    return { pages: [], refusal: `OCR opens a PDF of at most ${DOCUMENT_PAGE_LIMITS.pages} pages; this `
      + `one has ${pageCount}.` };
  }
  const pages = pdfPagesUnknown(reading) ? Array.from({ length: pageCount }, (_, at) => at + 1)
    : documentScannedPages(reading.native).filter(page => page <= pageCount);
  if (!pages.length || pageCount <= DOCUMENT_LIMITS.ocrBatchPages) return { pages, refusal: '' };
  return { pages, refusal: '', singlePage: true };
}

/** A press reads only selected pages without a usable reading, so the same selection twice reads once. */
export function pagesToRead(selected: readonly number[], runs: readonly OcrPageRun[]) {
  const read = new Set(runs.filter(run => run.reading.ocr?.outputStatus !== 'failed').map(run => run.page));
  return [...new Set(selected)].filter(page => !read.has(page)).sort((left, right) => left - right);
}

async function readPdfStatus(caseId: string, sourceId: string, jobId: string, ocrPage?: number, page?: number) {
  return unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/documents/jobs/{jobId}', {
    params: { path: { caseId, sourceId, jobId }, query: {
      ...(ocrPage === undefined ? {} : { ocrPage }), ...(page === undefined ? {} : { page }),
    } },
  })) as PdfReading;
}

/** Read bounded OCR pages and DOCX native parts, not just the first 25 returned by the status route. */
export async function readPdfJob(caseId: string, sourceId: string, jobId: string) {
  const status = await readPdfStatus(caseId, sourceId, jobId);
  if (status.native?.format === 'docx') {
    let more = status.hasMore;
    for (let page = 1; more && page < Math.ceil(DOCUMENT_LIMITS.parts / DOCUMENT_LIMITS.page); page++) {
      const next = await readPdfStatus(caseId, sourceId, jobId, undefined, page);
      if (next.resultSha256 !== status.resultSha256 || next.status !== status.status || next.page !== page
        || !next.parts.length) {
        throw new Error('The document reading changed while its passages were read. Open the reading again.');
      }
      status.parts.push(...next.parts);
      more = next.hasMore;
    }
  }
  const passages = [...(status.ocrItems ?? [])];
  let more = status.ocrHasMore;
  for (let ocrPage = 1; more && ocrPage < Math.ceil(DOCUMENT_LIMITS.ocrItems / DOCUMENT_LIMITS.page); ocrPage++) {
    const next = await readPdfStatus(caseId, sourceId, jobId, ocrPage);
    if (next.resultSha256 !== status.resultSha256 || next.status !== status.status) {
      throw new Error('The PDF reading changed while its passages were read. Open the reading again.');
    }
    passages.push(...(next.ocrItems ?? []));
    more = next.ocrHasMore;
  }
  return { status, passages };
}

/** Each page's newest finished OCR job of this source revision, read from the source's own job history. */
export async function readPdfOcrRuns(caseId: string, sourceId: string, jobIds: readonly string[], revision: number) {
  const runs = new Map<number, OcrPageRun>();
  for (const jobId of jobIds) {
    const { status, passages } = await readPdfJob(caseId, sourceId, jobId);
    const page = status.ocr?.sourcePage;
    if (status.status !== 'completed' || status.sourceRevision !== revision || !page || runs.has(page)) continue;
    runs.set(page, { page, reading: status, passages });
  }
  return [...runs.values()].sort((left, right) => left.page - right.page);
}

/** Read the source's page count from the existing private page metadata route. */
export async function readPdfPageCount(sourceId: string, reading: PdfReading) {
  return unwrap(await api.GET('/api/v1/sources/{sourceId}/pages', { params: { path: { sourceId }, query: {
    revision: reading.sourceRevision, sha256: reading.sourceSha256, offset: 0, limit: 1,
  } } })).pageCount;
}

/** Check the existing private PDF runtime before enqueueing. Lost retry responses keep the same request key. */
export function createPdfOcrPress(caseId: string, sourceId: string) {
  let body: RetryBody | null = null;
  return async (reading: PdfReading, selection: { page: number }) => {
    try {
      if (!Number.isSafeInteger(selection.page) || selection.page < 1 || selection.page > DOCUMENT_PAGE_LIMITS.pages) {
        throw new Error(`Choose a page number from 1 to ${DOCUMENT_PAGE_LIMITS.pages}.`);
      }
      if (!body || body.ocrSelection?.page !== selection.page || body.sourceSha256 !== reading.sourceSha256
        || body.expectedSourceRevision !== reading.sourceRevision) {
        const metadata = unwrap(await api.GET('/api/v1/sources/{sourceId}/pages', {
          params: { path: { sourceId }, query: {
            revision: reading.sourceRevision, sha256: reading.sourceSha256, offset: selection.page - 1, limit: 1,
          } },
        }));
        if (selection.page > metadata.pageCount || metadata.pages[0]?.page !== selection.page) {
          throw new Error('The selected page is not in this PDF. Choose an existing page number.');
        }
        body = { requestKey: crypto.randomUUID(), expectedCaseRevision: (await readBatchCase(caseId)).revision,
          expectedSourceRevision: reading.sourceRevision, sourceSha256: reading.sourceSha256,
          mode: 'native_only', ocrSelection: { ...selection,
            ...(metadata.pageCount > DOCUMENT_LIMITS.ocrBatchPages ? { singlePage: true } : {}) } };
      }
      const receipt = unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/documents/retry', {
        params: { path: { caseId, sourceId } }, body,
      }));
      body = null;
      return receipt;
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.status !== 429) body = null;
      throw error;
    }
  };
}

const pause = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

/** Follow one job until it ends, saying its state as it changes; leaving the page stops following, not the job. */
async function followPdfJob(caseId: string, sourceId: string, jobId: string, signal: AbortSignal,
  report: (status: PdfReading['status']) => void, wait: typeof pause) {
  for (;;) {
    const status = await readPdfStatus(caseId, sourceId, jobId);
    report(status.status);
    if (!active(status.status) || signal.aborted) return status;
    await wait(5000, signal);
  }
}

/**
 * One press reads the selected pages one after another: the OCR runtime reads one page per job and the server keeps
 * one active document job per source. The caller passes only pages not yet read (`pagesToRead`); a page whose job
 * does not complete stops the press, and the pages read before it stay read.
 */
export function createPdfOcrRun(caseId: string, sourceId: string, wait: typeof pause = pause) {
  const send = createPdfOcrPress(caseId, sourceId);
  return async (reading: PdfReading, pages: readonly number[], signal: AbortSignal,
    report: (progress: OcrPageProgress) => void) => {
    for (const page of pages) {
      if (signal.aborted) return;
      const receipt = await send(reading, { page });
      const status = await followPdfJob(caseId, sourceId, receipt.jobId, signal,
        value => report({ page, status: value }), wait);
      if (status.status !== 'completed' && !active(status.status)) {
        throw new Error(`OCR stopped on page ${page} (${status.code ?? 'reason unknown'}); the pages after it `
          + 'were not requested.');
      }
    }
  };
}

/** A PDF with no document job yet: above the document runtime's byte bound none is ever made. */
export function pdfNoReadingWords(sizeBytes: number | null | undefined) {
  if (!sizeBytes || sizeBytes <= DOCUMENT_LIMITS.originalBytes) return 'No document reading is available for this '
    + 'file yet.';
  const bound = sizeWords(DOCUMENT_LIMITS.originalBytes);
  // A size that rounds to the bound's words is stated in bytes, so the sentence never reads '1 GiB, above 1 GiB'.
  const size = sizeWords(sizeBytes) === bound ? `${sizeBytes.toLocaleString('en-IN')} bytes` : sizeWords(sizeBytes);
  return `This PDF is ${size}, above the ${bound} limit, so it is not read.`;
}

/** Count source paragraphs and cells once, even when a long unit has continuation parts. */
export function docxReadingWords(reading: PdfReading) {
  if (reading.status === 'queued') return 'The Word document reading is queued.';
  if (reading.status === 'running') return 'The Word document is being read.';
  if (reading.status === 'stale') return 'This Word document reading is out of date. Open the batch again.';
  if (reading.status === 'failed') return `The Word document reading stopped (${reading.code ?? 'reason unknown'}).`;
  if (reading.native?.status !== 'extracted' || reading.native.format !== 'docx') {
    return `The Word document was not read (${reading.native?.code ?? reading.native?.status ?? 'reason unknown'}).`;
  }
  const paragraphs = new Set<number>();
  const cells = new Set<string>();
  for (const { locator } of reading.parts) {
    if (locator.paragraph !== undefined) paragraphs.add(locator.paragraph);
    else if (locator.table !== undefined && locator.row !== undefined && locator.column !== undefined) {
      cells.add(`${locator.table}:${locator.row}:${locator.column}`);
    }
  }
  return `${paragraphs.size} ${paragraphs.size === 1 ? 'paragraph' : 'paragraphs'} and `
    + `${cells.size} ${cells.size === 1 ? 'table cell' : 'table cells'} read.`;
}

export function pdfOcrWords(reading: PdfReading) {
  if (reading.status === 'queued') return 'The PDF reading is queued.';
  if (reading.status === 'running') return 'The PDF is being read.';
  if (reading.status === 'stale') return 'This PDF reading is out of date. Open the batch again before retrying.';
  if (reading.status === 'failed') return `The PDF reading stopped before it finished (${reading.code
    ?? 'reason unknown'}).`;
  if (reading.native?.code === 'NATIVE_TEXT_NOT_REQUESTED') return 'The text layer was not read.';
  if (pdfTextLayerUnread(reading)) return `The text layer was not read: the PDF is above `
    + `${sizeWords(DOCUMENT_LIMITS.nativeBytes)}.`;
  if (pdfPagesUnknown(reading)) return 'The text-layer reading stopped.';
  return 'The text-layer reading is complete.';
}

/** What one press will do with the selected pages that are not yet read. */
export function pdfOcrPressWords(pages: number, left: number) {
  if (pages > left) return `This file can take ${left} more readings; pick at most ${left} pages.`;
  if (!pages) return 'Every selected page is read already.';
  return `${pages} ${pages === 1 ? 'page' : 'pages'} will be read.`;
}

/** What happened to one page, in an officer's words. */
export function pdfOcrPageWords(page: number, run: OcrPageRun | undefined, progress: OcrPageProgress | undefined) {
  if (progress?.status === 'queued') return `Page ${page}: waiting for the OCR worker.`;
  if (progress?.status === 'running') return `Page ${page}: OCR is reading it.`;
  const ocr = run?.reading.ocr;
  if (!run || !ocr) return `Page ${page}: not read.`;
  if (ocr.outputStatus === 'failed') return `Page ${page}: OCR did not read it. ${ocr.issues.join(' ')} Configure `
    + 'the document OCR runtime or resolve the stated limit, then retry.';
  const count = run.passages.length;
  return `Page ${page}: read; ${count} candidate ${count === 1 ? 'passage' : 'passages'}, completeness unverified`
    + `${ocr.outputStatus === 'partial' ? ', partial' : ''}.`;
}

import { api, ApiError, unwrap, type GetResponse, type paths } from '@ulpin/api-client';
import { DOCUMENT_LIMITS, documentScannedPages } from '@ulpin/contracts/upload-reader-limits';
import { readBatchCase } from './table/retain';

export type PdfReading = GetResponse<
  '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/documents/jobs/{jobId}'
>;
type CaseJob = GetResponse<'/api/v1/cases/{caseId}'>['jobs'][number];
type RetryRoute = paths['/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/documents/retry'];
type RetryBody = RetryRoute['post']['requestBody']['content']['application/json'];

export function latestPdfJob(jobs: readonly CaseJob[], sourceId: string) {
  return jobs.filter(job => job.sourceId === sourceId && job.operation === 'document-extraction')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

export function pdfOcrChoice(reading: PdfReading | undefined) {
  const scanned = reading?.native ? documentScannedPages(reading.native) : [];
  const page = scanned.find(number => number <= DOCUMENT_LIMITS.ocrMaxPage);
  return { scanned, selection: page === undefined ? null : { page } };
}

/** Read all bounded OCR passage pages, not just the first 25 returned by the status route. */
export async function readPdfJob(caseId: string, sourceId: string, jobId: string) {
  const path = { caseId, sourceId, jobId };
  const status = unwrap(await api.GET(
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/documents/jobs/{jobId}', { params: { path } },
  )) as PdfReading;
  const passages = [...(status.ocrItems ?? [])];
  let more = status.ocrHasMore;
  for (let ocrPage = 1; more && ocrPage < Math.ceil(DOCUMENT_LIMITS.ocrItems / DOCUMENT_LIMITS.page); ocrPage++) {
    const next = unwrap(await api.GET(
      '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/documents/jobs/{jobId}',
      { params: { path, query: { ocrPage } } },
    )) as PdfReading;
    if (next.resultSha256 !== status.resultSha256 || next.status !== status.status) {
      throw new Error('The PDF reading changed while its passages were read. Open the reading again.');
    }
    passages.push(...(next.ocrItems ?? []));
    more = next.ocrHasMore;
  }
  return { status, passages };
}

/** Check the existing private PDF runtime before enqueueing. Lost retry responses keep the same request key. */
export function createPdfOcrPress(caseId: string, sourceId: string) {
  let body: RetryBody | null = null;
  return async (reading: PdfReading, selection: { page: number }) => {
    try {
      if (!body) {
        unwrap(await api.GET('/api/v1/sources/{sourceId}/pages', { params: { path: { sourceId }, query: {
          revision: reading.sourceRevision, sha256: reading.sourceSha256, offset: selection.page - 1, limit: 1,
        } } }));
        body = { requestKey: crypto.randomUUID(), expectedCaseRevision: (await readBatchCase(caseId)).revision,
          expectedSourceRevision: reading.sourceRevision, sourceSha256: reading.sourceSha256,
          mode: 'native_only', ocrSelection: selection };
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

export function pdfOcrWords(reading: PdfReading, passages: number) {
  if (reading.status === 'queued') return 'OCR is queued; the scanned page is waiting to be read.';
  if (reading.status === 'running') return 'OCR is reading the scanned page.';
  if (reading.status === 'stale') return 'This PDF reading is out of date. Open the batch again before retrying.';
  if (reading.status === 'failed') return `OCR stopped before it finished (${reading.code ?? 'reason unknown'}).`;
  const ocr = reading.ocr;
  if (!ocr) return 'The text-layer reading is complete. OCR has not been requested.';
  if (ocr.outputStatus === 'failed') {
    return `OCR did not read page ${ocr.sourcePage}. ${ocr.issues.join(' ')} Configure the document OCR runtime `
      + 'or resolve the stated limit before retrying.';
  }
  return `OCR read 1 page (page ${ocr.sourcePage}); ${passages} candidate ${passages === 1 ? 'passage' : 'passages'} `
    + 'found with page-and-region citations. Text completeness is unverified.'
    + (ocr.outputStatus === 'partial' ? ' The reading is partial.' : '');
}

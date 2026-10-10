import { describe, expect, it } from 'vitest';
import { ApiError } from '@ulpin/api-client';
import { citedPageOf, OriginalChangedError, pageFailure } from './citedPage';
import type { PagesResponse } from './pageGeometry';

const pin = { revision: 1, sha256: 'a'.repeat(64) };
const pageOne = { page: 1, frame: { kind: 'pdf_display_page_top_left_points', rotation: 0, width: 612, height: 792 } };
const response = { sourceSha256: pin.sha256, sourceRevision: 1, name: 'plan.pdf', pages: [pageOne] } as PagesResponse;

describe('cited page', () => {
  it('returns the cited page of the pinned original', () => {
    expect(citedPageOf(response, 1, pin)).toMatchObject({ page: 1, name: 'plan.pdf' });
  });

  it('refuses a response for another hash or revision, and a page the server did not return', () => {
    expect(() => citedPageOf({ ...response, sourceSha256: 'b'.repeat(64) }, 1, pin)).toThrow(OriginalChangedError);
    expect(() => citedPageOf({ ...response, sourceRevision: 2 }, 1, pin)).toThrow(OriginalChangedError);
    expect(() => citedPageOf(response, 2, pin)).toThrow('no page 2');
  });
});

describe('page failure', () => {
  const refusal = (status: number, code: string) => new ApiError(status, '/pages', { error: { code, message: 'x' } });

  it('tells an unavailable runtime from a changed original and from other failures', () => {
    expect(pageFailure(refusal(503, 'DOCUMENT_PAGES_RUNTIME_UNAVAILABLE')))
      .toMatchObject({ kind: 'unavailable', code: 'DOCUMENT_PAGES_RUNTIME_UNAVAILABLE' });
    expect(pageFailure(refusal(409, 'SOURCE_STALE')).kind).toBe('changed');
    expect(pageFailure(new OriginalChangedError()).kind).toBe('changed');
    expect(pageFailure(refusal(422, 'DOCUMENT_PAGE_NOT_FOUND')).kind).toBe('other');
    expect(pageFailure(new Error('offline')).kind).toBe('other');
  });
});

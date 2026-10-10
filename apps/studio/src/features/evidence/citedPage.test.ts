import { describe, expect, it } from 'vitest';
import { ApiError } from '@ulpin/api-client';
import { citedPageOf, OriginalChangedError, pageFailure, pageViewState, retainedSourcePin } from './citedPage';
import type { BuildingRegister } from '../../api/queries';
import type { EvidenceRef } from './refs';
import type { PagesResponse } from './pageGeometry';

const pin = { revision: 1, sha256: 'a'.repeat(64) };
const pageOne = { page: 1, renderSupport: 'supported',
  frame: { kind: 'pdf_display_page_top_left_points', rotation: 0, width: 612, height: 792 } };
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

describe('whole-sheet listing state', () => {
  const supported = response.pages[0]!;
  const reduced = { ...supported, renderSupport: 'reduced' as const, reducedScalePxPerPt: 0.5413766434648105 };

  it('keeps supported pages as today without a reduced statement or region action', () => {
    expect(pageViewState(supported, true)).toEqual({ kind: 'supported', statement: null, offersRegion: false });
  });

  it('states the reduced scale from the listing and offers a cited region', () => {
    expect(pageViewState(reduced, true)).toEqual({ kind: 'reduced', offersRegion: true,
      statement: 'This sheet is shown whole at a reduced scale of 0.54 px per pt. ' +
        'Small text is not readable at this scale.' });
  });

  it('keeps unsupported sheets on the region path regardless of an image URL', () => {
    expect(pageViewState({ ...supported, renderSupport: 'unsupported', url: '/unexpected' }, true))
      .toEqual({ kind: 'unsupported', statement: null, offersRegion: true });
  });

  it('does not offer a region action for a reduced page-only citation', () => {
    expect(pageViewState(reduced, false)).toMatchObject({ kind: 'reduced', offersRegion: false });
  });

  it('refuses a missing scale and a scale on any page that is not reduced before returning the page', () => {
    const missing = { ...supported, renderSupport: 'reduced' as const };
    const unexpected = { ...supported, reducedScalePxPerPt: reduced.reducedScalePxPerPt };
    const unsupported = { ...unexpected, renderSupport: 'unsupported' as const };
    for (const page of [missing, unexpected, unsupported]) {
      expect(() => citedPageOf({ ...response, pages: [page] }, 1, pin)).toThrow('listing could not be read');
    }
  });
});

describe('retained source pins', () => {
  const evidence: EvidenceRef = { sourceId: 'source', label: 'Source', locator: { kind: 'page', page: 1, text: '' } };
  const source = { id: 'source', revision: 7, sha256: pin.sha256 } as BuildingRegister['sources'][number];

  it('uses the source revision the loaded register states, never a revision-1 default', () => {
    expect(retainedSourcePin(evidence, [source])).toEqual({ revision: 7, sha256: pin.sha256 });
    expect(retainedSourcePin(evidence, [])).toBeUndefined();
  });

  it('does not choose between conflicting loaded pins', () => {
    expect(retainedSourcePin(evidence, [source, { ...source, revision: 8 }])).toBeUndefined();
    expect(retainedSourcePin(evidence, [source, { ...source, sha256: 'b'.repeat(64) }])).toBeUndefined();
  });

  it('keeps an explicit citation pin even when the retained revision moved on', () => {
    expect(retainedSourcePin({ ...evidence, pin }, [source])).toEqual(pin);
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

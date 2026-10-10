import { useIsFetching, useQuery, useQueryClient, type Query } from '@tanstack/react-query';
import { api, ApiError, unwrap } from '@ulpin/api-client';
import type { PagesResponse } from './pageGeometry';
import type { EvidenceRef, SourcePin } from './refs';
import type { BuildingRegister } from '../../api/queries';

const SOURCE_READS = {
  predicate: ({ queryKey }: Query) => queryKey[0] === 'buildings' &&
    queryKey[2] === 'register' && queryKey.length === 3,
};

/** An unpinned citation can use the retained source's pins only when the loaded register reads agree. */
export function retainedSourcePin(evidence: EvidenceRef, sources: BuildingRegister['sources']): SourcePin | undefined {
  if (evidence.pin) return evidence.pin;
  const matching = sources.filter((source) => source.id === evidence.sourceId);
  const first = matching[0];
  if (!first || (evidence.sourceSha256 !== undefined && evidence.sourceSha256 !== first.sha256) ||
      matching.some((source) => source.revision !== first.revision || source.sha256 !== first.sha256)) {
    return undefined;
  }
  return { revision: first.revision, sha256: first.sha256 };
}

/** Reuses source metadata already read by the opening register; no revision-1 fallback or new read. */
export function useEvidencePin(evidence: EvidenceRef): SourcePin | undefined {
  const client = useQueryClient();
  // Subscribes only: the cache read below is not reactive, so this draws again when a register read settles.
  useIsFetching(SOURCE_READS);
  const sources = client.getQueriesData<BuildingRegister>(SOURCE_READS).flatMap(([, read]) => read?.sources ?? []);
  return retainedSourcePin(evidence, sources);
}

export type CitedPage = PagesResponse['pages'][number] & Pick<PagesResponse,
  'name' | 'sourceId' | 'sourceRevision' | 'sourceSha256' | 'revision'>;

export type PageViewState = {
  kind: 'supported' | 'reduced' | 'unsupported';
  statement: string | null;
  offersRegion: boolean;
};

/** Whole-sheet support comes from the listing, never the raster's dimensions or headers. */
export function pageViewState(page: PagesResponse['pages'][number], hasRegion: boolean): PageViewState {
  const scale = page.reducedScalePxPerPt;
  const reduced = page.renderSupport === 'reduced';
  if (reduced !== (scale !== undefined) ||
      (reduced && (!Number.isFinite(scale) || scale! <= 0 || scale! > 3))) {
    throw new Error('The page listing could not be read: a reduced page must state its scale, and only it may.');
  }
  switch (page.renderSupport) {
    case 'supported': return { kind: 'supported', statement: null, offersRegion: false };
    case 'reduced': return {
      kind: 'reduced',
      statement: `This sheet is shown whole at a reduced scale of ${scale!.toFixed(2)} px per pt. ` +
        'Small text is not readable at this scale.',
      offersRegion: hasRegion,
    };
    case 'unsupported': return { kind: 'unsupported', statement: null, offersRegion: hasRegion };
    default: throw new Error('The page listing could not be read: its render support is not stated.');
  }
}

/** The server holds another revision or hash of the original than the citation was recorded against. */
export class OriginalChangedError extends Error {
  constructor() {
    super('The retained original differs from the one this citation was recorded against.');
    this.name = 'OriginalChangedError';
  }
}

/** The page a citation names, from a response that must describe exactly the original the citation pins. */
export function citedPageOf(response: PagesResponse, page: number, pin: SourcePin): CitedPage {
  if (response.sourceSha256 !== pin.sha256 || response.sourceRevision !== pin.revision) {
    throw new OriginalChangedError();
  }
  const found = response.pages.find((item) => item.page === page);
  if (!found) throw new Error(`The server returned no page ${page} for this source.`);
  pageViewState(found, false);
  const { name, sourceId, sourceRevision, sourceSha256, revision } = response;
  return { ...found, name, sourceId, sourceRevision, sourceSha256, revision };
}

/** Reads one page's frame and raster URL with the citation's own pins; the server refuses a changed original. */
export function useCitedPage(sourceId: string, page: number, pin: SourcePin) {
  return useQuery({
    queryKey: ['cited-page', sourceId, pin.revision, pin.sha256, page],
    retry: false,
    staleTime: Infinity,
    queryFn: async () => {
      const query = { sha256: pin.sha256, revision: pin.revision, offset: page - 1, limit: 1 };
      const response = unwrap(await api.GET('/api/v1/sources/{sourceId}/pages', {
        params: { path: { sourceId }, query },
      }));
      // openapi-fetch's Readable helper drops null-only properties (calibration); restore the published type.
      return citedPageOf(response as PagesResponse, page, pin);
    },
  });
}

export type PageFailure = {
  kind: 'unavailable' | 'changed' | 'other';
  message: string;
  code: string | null;
};

function codeOf(error: ApiError): string | null {
  const wrapped = (error.body as { error?: { code?: unknown } } | null)?.error;
  return typeof wrapped?.code === 'string' ? wrapped.code : null;
}

/** What a failed page read means for the viewer: no runtime, a changed original, or anything else. */
export function pageFailure(error: Error): PageFailure {
  if (error instanceof OriginalChangedError) return { kind: 'changed', message: error.message, code: null };
  if (!(error instanceof ApiError)) return { kind: 'other', message: error.message, code: null };
  const code = codeOf(error);
  if (error.status === 503) return { kind: 'unavailable', message: error.message, code };
  if (error.status === 409) return { kind: 'changed', message: error.message, code };
  return { kind: 'other', message: error.message, code };
}

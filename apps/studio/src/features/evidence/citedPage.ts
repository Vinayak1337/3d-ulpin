import { useQuery } from '@tanstack/react-query';
import { api, ApiError, unwrap } from '@ulpin/api-client';
import type { PagesResponse } from './pageGeometry';
import type { SourcePin } from './refs';

export type CitedPage = PagesResponse['pages'][number] & { name: string };

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
  return { ...found, name: response.name };
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

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, type paths } from '@ulpin/api-client';
import { PACKET_REGION_LIMITS, PacketRegionProvenanceSchema } from
  '../../../../../packages/contracts/src/packet-region';
import type { CitedPage } from './citedPage';
import { OriginalChangedError } from './citedPage';
import { regionOutline } from './pageGeometry';
import type { Locator } from './refs';

const ROUTE = '/api/v1/usp/packets/sources/{sourceId}/pages/{page}/region';
type RegionRequest = paths[typeof ROUTE]['post']['requestBody']['content']['application/json'];
export type RegionProvenance = ReturnType<typeof PacketRegionProvenanceSchema.parse>;
type Place = Extract<Locator, { kind: 'page' | 'region' }>;
type RegionResult = { blob: Blob; sha256: string; provenance: RegionProvenance };

/** The crop body uses the listing's pins and frame, never defaults a missing revision. */
export function buildRegionRequest(page: CitedPage, place: Place): RegionRequest | null {
  if (place.kind !== 'region') return null;
  const outline = regionOutline(place.region, page.frame);
  if (!outline.drawn) return null;
  const { x, y, width, height } = outline.box;
  return {
    revision: page.revision,
    sha256: page.sourceSha256,
    purpose: 'private_source_preview',
    selection: {
      frame: page.frame,
      mediaBox: page.mediaBox,
      cropBox: page.cropBox,
      boxConvention: page.boxConvention,
      coordinates: 'displayed_cropbox_normalized_top_left/1',
      region: [x / page.frame.width, y / page.frame.height,
        (x + width) / page.frame.width, (y + height) / page.frame.height],
      selectionAcknowledged: true,
    },
  };
}

function windowAxis(start: number, size: number, padding: number, pageSize: number): [number, number] {
  const lower = Math.max(0, start - padding);
  const upper = Math.min(pageSize, start + size + padding);
  if (upper - lower <= PACKET_REGION_LIMITS.selectedSide) return [lower, upper];
  const half = PACKET_REGION_LIMITS.selectedSide / 2;
  const centre = start + size / 2;
  const clipped = Math.max(0, Math.min(centre - half, pageSize - 2 * half));
  return [clipped, clipped + 2 * half];
}

/** Widen by the citation's larger side on every edge; clip to the page and selected-region ceiling. */
export function citedWindow(page: CitedPage, place: Place): Place | null {
  if (place.kind !== 'region') return null;
  const outline = regionOutline(place.region, page.frame);
  if (!outline.drawn) return null;
  const { x, y, width, height } = outline.box;
  if (Math.min(width, height) <= 0 || Math.max(width, height) > PACKET_REGION_LIMITS.selectedSide) return null;
  const padding = Math.max(width, height);
  const [x0, x1] = windowAxis(x, width, padding, page.frame.width);
  const [y0, y1] = windowAxis(y, height, padding, page.frame.height);
  return { ...place, region: { x: x0, y: y0, width: x1 - x0, height: y1 - y0, unit: 'pt' } };
}

/** Pure viewer branch, including a refusal without ever substituting a placeholder. */
export function citedPageState(page: CitedPage, place: Place, refused = false) {
  if (refused) return 'refused';
  if (page.url) return 'whole';
  if (place.kind === 'page') return 'page-only';
  return 'region';
}

export function regionImageFrame(provenance: RegionProvenance) {
  const [a, b, c, d, e, f] = provenance.transform.pixelToDisplay;
  const [width, height] = provenance.output.pixels;
  const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) =>
    [a * x! + c * y! + e, b * x! + d * y! + f]);
  const xs = corners.map(([x]) => x!);
  const ys = corners.map(([, y]) => y!);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { viewBox: `${x} ${y} ${Math.max(...xs) - x} ${Math.max(...ys) - y}`,
    matrix: `matrix(${provenance.transform.pixelToDisplay.join(' ')})`, width, height };
}

async function readRegion(page: CitedPage, body: RegionRequest, signal: AbortSignal): Promise<RegionResult> {
  const result = await api.POST(ROUTE, {
    params: { path: { sourceId: page.sourceId, page: page.page } }, body, parseAs: 'blob', signal,
  });
  if (!result.response.ok) {
    // parseAs blob applies to successes; openapi-fetch reads JSON errors itself.
    throw new ApiError(result.response.status, ROUTE, result.error);
  }
  const encoded = result.response.headers.get('X-Region-Provenance');
  const sha256 = result.response.headers.get('X-Region-Sha256');
  if (!encoded || !sha256 || !result.data) throw new Error('The server returned no region provenance.');
  const decoded = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
  const provenance = PacketRegionProvenanceSchema.parse(JSON.parse(decoded));
  if (provenance.sourceId !== page.sourceId || provenance.sourceRevision !== page.sourceRevision ||
      provenance.sourceSha256 !== page.sourceSha256 || provenance.page !== page.page) {
    throw new OriginalChangedError();
  }
  if (sha256 !== provenance.output.sha256 || result.data.size !== provenance.output.bytes ||
      result.data.type !== 'image/png' || JSON.stringify(provenance.selection) !== JSON.stringify(body.selection)) {
    throw new Error('The region answer differs from its requested selection or PNG provenance.');
  }
  return { blob: result.data, sha256, provenance };
}

/** Query cancellation aborts the private read on close; each mounted viewer owns and revokes its object URL. */
export function useCitedRegion(page: CitedPage, place: Place, acknowledged: boolean) {
  const window = citedWindow(page, place);
  const body = window ? buildRegionRequest(page, window) : null;
  const query = useQuery({
    queryKey: ['cited-region', page.sourceId, page.revision, page.sourceSha256, page.page, body],
    enabled: acknowledged && Boolean(body),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    queryFn: ({ signal }) => readRegion(page, body!, signal),
  });
  const [image, setImage] = useState<{ result: RegionResult; href: string } | null>(null);
  useEffect(() => {
    if (!query.data) return;
    const href = URL.createObjectURL(query.data.blob);
    setImage({ result: query.data, href });
    return () => URL.revokeObjectURL(href);
  }, [query.data]);
  return { ...query, image: image?.result === query.data ? image : null, canRequest: Boolean(body) };
}

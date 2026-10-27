import { useEffect, useMemo, useState } from 'react';
import { api, unwrap } from '@ulpin/api-client';
import type { LocalXY, MultiPolygon, PreviewOutlineInput, SceneEngine } from '@ulpin/scene';
import { utmForward, utmZone, type AreaReference } from '../overlays';
import type { IntakeItem } from '../surface/parts';
import { ReadPreviews, type PreviewFeature, type PreviewFile, type PreviewIo } from './readPreview';

const NO_FRAME = 'Not drawn: the map has no WGS 84 UTM zone with a stated origin.';

/** One file's words beside the map. */
export interface PreviewLine {
  itemId: string;
  label: string;
  line: string;
}

const browserPreviewIo: PreviewIo = {
  page: async (item, after, signal) => unwrap(await api.GET(
    '/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/read-preview',
    { params: { path: { caseId: item.caseId, itemId: item.itemId }, query: { after } }, signal },
  )),
};

/**
 * Longitude and latitude into the area's local metres, as the imagery overlay places its corners: the area's WGS 84
 * UTM zone, minus its origin. Null when the area states no such frame.
 */
export function previewFrame(reference: AreaReference | null | undefined): ((xy: LocalXY) => LocalXY) | null {
  const zone = utmZone(reference?.analysisCrs);
  const origin = reference?.origin;
  if (!zone || !origin || !/^EPSG:32[67]\d{2}$/.test(reference?.analysisCrs ?? '')) return null;
  return ([lon, lat]) => {
    const [x, y] = utmForward(lon, lat, zone.zone, zone.south);
    return [x - origin[0], y - origin[1]];
  };
}

function polygonsOf(geometry: PreviewFeature['geometry'], local: (xy: LocalXY) => LocalXY): MultiPolygon {
  // The published schema widens each [x, y] pair to a number list; the route sends pairs.
  const ring = (points: number[][]) => points.map(([x, y]) => local([x!, y!]));
  if (geometry.type === 'Polygon') return [geometry.coordinates.map(ring)];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((polygon) => polygon.map(ring));
  return [];
}

/** Every file's outlines in the area's frame; none without a frame. */
export function previewOutlines(files: readonly PreviewFile[], reference: AreaReference | null | undefined) {
  const local = previewFrame(reference);
  const outlines: PreviewOutlineInput[] = [];
  if (!local) return outlines;
  for (const file of files) {
    for (const { featureIndex, geometry } of file.features) {
      outlines.push({ id: `${file.itemId}:${featureIndex}`, polygons: polygonsOf(geometry, local) });
    }
  }
  return outlines;
}

/** Each file's line, saying so when its outlines cannot be placed on this map. */
export function previewKeyLines(files: readonly PreviewFile[], framed: boolean): PreviewLine[] {
  return files.map((file) => ({ itemId: file.itemId, label: file.name,
    line: framed || !file.features.length ? file.line : `${file.line} ${NO_FRAME}` }));
}

/**
 * The outlines read so far of the large GeoJSON files of the area's batches, drawn on this map as a provisional
 * preview: no fill, no height, no picking. The items come from the batch reads the surface layer already keeps.
 */
export function useReadPreview(items: readonly IntakeItem[], engine: SceneEngine | null,
  reference: AreaReference | null | undefined): PreviewLine[] {
  const [files, setFiles] = useState<PreviewFile[]>([]);
  const [reader, setReader] = useState<ReadPreviews | null>(null);
  useEffect(() => {
    const previews = new ReadPreviews(browserPreviewIo, setFiles);
    setReader(previews);
    return () => previews.dispose();
  }, []);
  useEffect(() => { reader?.sync(items); }, [reader, items]);
  // A poll with nothing new, or an area read again with the same frame, keeps the drawn outlines.
  const frameKey = `${reference?.analysisCrs}:${reference?.origin?.join()}`;
  const drawnKey = files.map((file) => `${file.itemId}:${file.basis}:${file.features.length}`).join();
  const outlines = useMemo(() => previewOutlines(files, reference), [drawnKey, frameKey]);
  useEffect(() => { engine?.setPreviewOutlines(outlines); }, [engine, outlines]);
  const framed = previewFrame(reference) !== null;
  return useMemo(() => previewKeyLines(files, framed), [files, framed]);
}
